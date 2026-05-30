# Development Guide (L2)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = this file / L3 = [`/.claude/`](../.claude/).

## Tech stack

| Area | Choice |
|---|---|
| Framework | Tauri 2 (single native app for Mac/Windows) |
| Frontend | Vite + React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite`) + shadcn/ui (new-york, ASICS design tokens) + Radix |
| Backend | Rust, DDD layered (Cargo workspace: pure `simple-archiver-core` crate + `src-tauri` presentation crate) |
| zip creation | `async_zip` |
| rar extraction | `unrar` (extract-only; bundled C++ source for both Mac/Win) |
| Rust tests | cargo-nextest (runner) / mockall (port mocks) / loom (concurrency verification) |
| Parser / lexer | LALRPOP 0.20.x (parser codegen from `.lalrpop` grammar) + logos (lexer); both are build-time tooling inside `simple-archiver-core` |
| Frontend tests | Vitest + Testing Library (jsdom; native DOM assertions — jest-dom is intentionally not installed) |
| Frontend format / lint | Biome (`biome.json`; single formatter + linter, fills the ESLint/Prettier role) |

Technology choices are fixed. **Do not swap in alternative libraries on your own.** If a change is needed, propose it together with an update to the design (the source of truth).

## Development commands

Toolchain is pinned via `mise.toml` (rust / node / pnpm / cargo-nextest). The package manager is **pnpm**; run all commands from the repo root (the Cargo workspace lives there, not under `src-tauri/`).

```bash
# Rust — pure core (the TDD battleground; -p keeps Tauri out)
cargo nextest run -p simple-archiver-core   # run tests (use nextest, not `cargo test`)
cargo clippy -p simple-archiver-core --all-targets -- -D warnings  # lint, zero warnings
cargo fmt                                    # format (whole workspace)
cargo llvm-cov nextest -p simple-archiver-core --lcov --output-path lcov.info  # coverage (CI uploads to Codecov)

# loom concurrency verification (target tests only; kept separate from normal runs)
RUSTFLAGS="--cfg loom" cargo nextest run -p simple-archiver-core --features loom

# Frontend
pnpm check                 # Biome: format + lint with autofix (run before committing)
pnpm biome:ci              # Biome: CI gate — format + lint, no writes (mirrors CI)
pnpm test                  # Vitest one-shot (= vitest run)
pnpm test:watch            # Vitest watch mode
pnpm run test:coverage     # Vitest coverage -> coverage/lcov.info
pnpm knip                  # unused files / deps / exports gate
pnpm build                 # tsc + vite build

# App run / build
pnpm tauri dev
pnpm tauri build
```

> In non-TTY/CI contexts, invoke pnpm as `mise exec -- pnpm ...`: the mise pnpm shim swallows stdout/exit code in non-TTY, so a success can look like a failure.

## Testing policy (TDD)

This project is designed around TDD. **Write tests before implementation.**

- **Domain**: pure unit tests. Cover `NamingRule` resolution, `ArchiveJob.plan`/`reorder` invariants, and name-uniqueness boundary cases. For any **state machine** (e.g. `TaskStatus`), test every `(state × event)` pair: legal transitions assert the resulting state, illegal ones assert the typed error, and terminal states reject all events.
- **Application**: verify parallelism and error tallying **deterministically**. PR-5a uses **hand-written fakes** (`FakeArchiver` / `FixedClock` / `RecordingSink`), not `mockall`: the evolved `Archiver` returns `impl Future + Send` (RPITIT), which `mockall` cannot mock cleanly, and a purpose-built fake gives the control the timing assertions need — a `tokio::sync::Barrier(N)` + `timeout` proves N workers run concurrently, and the **cap** is proven by running *more* tasks than the limit and asserting peak liveness `== N` (sampled at the barrier rendezvous). `mockall` stays declared in dev-dependencies for a future PR that mocks the ports; PR-5b's cancel-path tests use the hand-written `FakeArchiver`, not mockall. `Clock` is faked with a fixed `Instant` so `elapsed` is deterministic.
- **Concurrency**: verify the **single-owner aggregator** (fed by an internal mpsc channel; single writer, no shared lock) with `loom`. `loom` is a normal `optional` dependency on `simple-archiver-core` gated behind the `loom` feature (Cargo cannot mark dev-dependencies optional). It is off by default, so normal builds never compile it; the verification run above flips the feature on. **loom is incompatible with `tokio::fs`**: under `RUSTFLAGS="--cfg loom"` tokio disables its IO modules (`fs`, net, …) because loom only model-checks concurrency primitives. Pure-domain modules (no IO/async) need **no** `#[cfg(not(loom))]` guard and must keep compiling and passing under the `loom` feature — only modules that use `tokio::fs` or other IO require the guard. So IO adapters that use `tokio::fs` (e.g. `ZipArchiver`) must be excluded from loom builds via `#[cfg(not(loom))]` (on the `infrastructure::zip_archiver` module declaration and on its integration test file), and the bare `cfg(loom)` name must be declared in `crates/core/Cargo.toml` under `[lints.rust] unexpected_cfgs = { check-cfg = ['cfg(loom)'] }` so `cargo clippy -D warnings` stays clean. PR-5a builds the engine but adds **no** loom tests; **PR-5b adds the loom nucleus** (`application/loom_nucleus.rs`, gated `#[cfg(loom)]`) which drives the real `Aggregator`/`WorkerMsg`/`ArchiveJob` under loom primitives — three concurrent loom-thread workers send terminal/progress messages over a loom mpsc channel into the single-writer aggregator. Under every loom interleaving it verifies that no message is lost and the summary partitions every task into exactly one of succeeded/cancelled/failed. This checks the **concurrency model** (single-writer aggregation), NOT the tokio runtime, and NOT `CancellationToken` propagation (that signal path is covered by the regular tokio cancel-path tests). Note: loom 0.7 models message count, not sender-drop/channel closure, so the production worker→channel-close→drain ordering is covered by the regular tokio tests, not loom. **Harness consequence:** because loom's `recv()` blocks forever on an empty channel (no "all senders dropped" signal), a `while let Ok(_) = rx.recv()` drain-to-closure *deadlocks* under loom — the loom model must instead drain an **exact, known message count** derived from named constants that mirror what the workers send (e.g. `SUCCESS_MSGS + CANCEL_MSGS + FAILURE_MSGS`). Over-draining hangs; under-draining leaves a non-terminal task. Keep the count constant-derived (not a magic literal) so it stays honest as the worker set changes. Two modules are gated `#[cfg(not(loom))]` — `application::run_archive_job` (uses the tokio runtime: `rt`/`sync`/`spawn`/`mpsc`/`Semaphore`) and `infrastructure::zip_archiver` (`tokio::fs`) — while every other new module (`progress`, `compress_context`, `progress_aggregator`, `ports`, `system_clock`) is pure/std and must keep compiling and passing under the `loom` feature. So the loom build now compiles down to the pure domain **plus** those std/pure application modules.
- **Infrastructure**: narrow integration tests against small real fixtures (small folder, small .rar). Few and slow, so isolate them with a marker.
  - **A test asserting absence must first prove presence (no vacuous side-effect tests).** A cleanup/cancel test that fires its trigger at the *first* checkpoint runs **before** the side-effect happens (e.g. the output file is not yet created), so an "artifact was removed" assertion passes vacuously and never exercises the real cleanup path. Fire the trigger *after* the side-effect and prove it occurred first — e.g. assert the progress reporter was called ≥2 times ⇒ ≥1 entry was written ⇒ the dest file genuinely existed — *then* assert it was cleaned up (`ZipArchiver`'s `cancels_after_a_write_removes_the_partial_output` is the canonical shape).
- **Presentation (Tauri commands)**: a `#[tauri::command] pub fn` is an ordinary Rust function; its `Result<_, String>` mapping can be asserted in a plain `#[cfg(test)]` unit test **without** constructing an `App` or `Window`. Integration-level coverage (command seam: argument names `src`/`out`, `ArchiveError`→`String` IPC mapping) can be added via `src-tauri/tests/*.rs` — the macro does not consume the original fn. Requires: the `presentation` module is `pub`, the lib crate is `simple_archiver_lib` with `[lib] crate-type` including `"rlib"`, and dev-deps `tokio` (macros, rt-multi-thread) + `zip` + `tempfile`.
- **Frontend**: Vitest on jsdom + Testing Library for preview computation, reordering, and progress rendering, including event-payload contract tests. Mock `@tauri-apps/api/core` (`invoke`) and `@tauri-apps/plugin-dialog` (`open`/`save`).
  - **Native DOM assertions only** — jest-dom is intentionally not installed. Use `el.className`, `classList.contains(…)`, `.textContent`, `.disabled`, etc. Never `toBeInTheDocument` / `toHaveClass`.
  - **CSS variables are not resolvable in jsdom.** Do not assert computed token values (colors, radii) in unit tests — those can only be verified visually or in a browser. Confirm token wiring compiles correctly via `pnpm build`.
  - Shared test helpers and stubs live in `src/test/` (e.g. `setup.ts` for cleanup, `stub-match-media.ts`). The knip entry point covers `src/components/ui/**` so shadcn primitives are not flagged unused.
  - `@testing-library/user-event` treats `{` as a special key sequence — type a literal brace as `{{` (e.g. `img_{{n:03}` produces `img_{n:03}`).
  - Combining `vi.useFakeTimers()` with `userEvent` can deadlock in jsdom. For debounce-timing tests, drive input with `fireEvent.change` + `vi.advanceTimersByTimeAsync`, and confirm the test fails when the debounce is removed as a correctness check.
- **E2E**: a folder → zip walking-skeleton smoke test.

## Coverage (Codecov)

Coverage is reported to Codecov **informationally** — it never blocks a PR. The
ubuntu `core` and `frontend` CI jobs upload lcov to Codecov under flags `rust`
and `frontend` (auth via the `CODECOV_TOKEN` repository secret). The
mac/windows `app` job is build-only and is not measured. The repository must be
activated on codecov.io for reports to appear. Coverage config lives in
`codecov.yml`; local lcov artifacts (`lcov.info`, `coverage/`) are git-ignored.

## Commit / PR rules

- Target **one PR ≤ 1000 lines**, with the walking skeleton (folder → zip e2e) going first. The line count includes co-located tests; a TDD-heavy, cohesive pure-domain PR can legitimately exceed 1000 lines (PR4 ran to ~1.5k, largely tests). When that happens, surface it explicitly and get maintainer approval rather than silently splitting interdependent code across stacked PRs.
- Stack PRs in order of high-impact × low-effort (follow the PR1–PR10 split and dependency graph in the design).
- Each PR has acceptance criteria in the design; do not mix in out-of-scope items.
- Before merge, `cargo clippy` / `cargo fmt` / `cargo nextest run` / `pnpm biome:ci` / `pnpm test` must all be green. CI builds on both Mac and Windows.
- Never run `git commit` / `git push` until the user explicitly asks.

## Build / scaffold notes (learnings)

- **`bitflags` pinned to `=2.8.0` (src-tauri).** dispatch2 (transitive via tao→wry→tauri) emits a large `bitflags!` block; bitflags 2.9+ expands it recursively and overflows the default `recursion_limit = 128`. 2.8.0 is non-recursive. Remove the pin once dispatch2 sets `#![recursion_limit]` or bitflags fixes the recursion. (See the comment in `src-tauri/Cargo.toml`.)
- **pnpm build-script approval lives in `pnpm-workspace.yaml`.** `onlyBuiltDependencies: [esbuild]` must sit there: pnpm 11 ignores `pnpm.onlyBuiltDependencies` in `package.json` and treats `allowBuilds` as a no-op. Without approval, esbuild's postinstall is skipped and `vite build` fails under CI's `--frozen-lockfile`.
- **Tailwind v4 + shadcn needs explicit theme glue.** The global CSS requires a `@theme inline { --color-*: var(--*) }` block plus `@custom-variant dark`. v4 does not auto-generate `bg-primary` / `border-ring` etc. from bare `:root` variables; without the glue the build passes but shadcn components render unstyled.
- **Follow-up (PR10 bundling):** the Tauri bundle identifier `com.simplearchiver.app` ends in `.app` and triggers a warning; change it before the bundling PR.
- **logos + LALRPOP build wiring.** The `core` crate uses a `build.rs` that calls `lalrpop::process_root()` to codegen the parser from `src/domain/template.lalrpop`. The generated file is referenced with `lalrpop_util::lalrpop_mod!(name, "/domain/template.rs")` — the path must mirror the `.lalrpop` file location. `lalrpop` (build-dep) and `lalrpop-util` (dep) **must be pinned to the same version** (0.20.x); version skew causes silent codegen mismatches. logos provides the lexer; its `SpannedIter` is adapted into `(start, token, end)` triples for LALRPOP's external-lexer mode.
- **A `#[cfg]`-gated test suite needs its own CI job or it silently bit-rots.** A `#[cfg(loom)]`-gated suite is compiled *out* of every normal CI job, so without a dedicated `RUSTFLAGS="--cfg loom" cargo nextest --features loom` job (plus a matching loom-clippy step) it never compiles or runs and rots unnoticed. The `loom` CI job exists for exactly this. Related tooling note: once a cfg-gated module contains `use loom::…`, cargo-machete (a text scan) counts the optional dep as *used*, so it can be removed from the machete `ignored` list (loom was; `mockall` stays ignored while still unreferenced).
- **clippy `-D warnings` gotchas (CI gate).** Two patterns tripped this PR:
  - Use `!(1..=N).contains(&x)` instead of `x < 1 || x > N`; the latter triggers `clippy::manual_range_contains`.
  - A `pub` / `pub(crate)` item is exempt from `dead_code`, but a non-public fn that is only consumed by tests until a later task wires real callers may need a temporary `#[allow(dead_code)]`; remove it once production code calls it.

For coding conventions (including the English-comment rule), see L3 [`/.claude/conventions.md`](../.claude/conventions.md).
