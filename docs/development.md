# Development Guide (L2)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = this file / L3 = [`/.claude/`](../.claude/).

## Tech stack

| Area | Choice |
|---|---|
| Framework | Tauri 2 (single native app for Mac/Windows) |
| Frontend | Vite + React + TypeScript + shadcn/ui (shadcn-admin layout / asics design tokens), state via zustand |
| Backend | Rust, DDD layered (Cargo workspace: pure `simple-archiver-core` crate + `src-tauri` presentation crate) |
| zip creation | `async_zip` |
| rar extraction | `unrar` (extract-only; bundled C++ source for both Mac/Win) |
| Rust tests | cargo-nextest (runner) / mockall (port mocks) / loom (concurrency verification) |
| Parser / lexer | LALRPOP 0.20.x (parser codegen from `.lalrpop` grammar) + logos (lexer); both are build-time tooling inside `simple-archiver-core` |
| Frontend tests | Vitest |

Technology choices are fixed. **Do not swap in alternative libraries on your own.** If a change is needed, propose it together with an update to the design (the source of truth).

## Development commands

Toolchain is pinned via `mise.toml` (rust / node / pnpm / cargo-nextest). The package manager is **pnpm**; run all commands from the repo root (the Cargo workspace lives there, not under `src-tauri/`).

```bash
# Rust — pure core (the TDD battleground; -p keeps Tauri out)
cargo nextest run -p simple-archiver-core   # run tests (use nextest, not `cargo test`)
cargo clippy -p simple-archiver-core --all-targets -- -D warnings  # lint, zero warnings
cargo fmt                                    # format (whole workspace)

# loom concurrency verification (target tests only; kept separate from normal runs)
RUSTFLAGS="--cfg loom" cargo nextest run -p simple-archiver-core --features loom

# Frontend
pnpm test                  # Vitest
pnpm build                 # tsc + vite build

# App run / build
pnpm tauri dev
pnpm tauri build
```

> In non-TTY/CI contexts, invoke pnpm as `mise exec -- pnpm ...`: the mise pnpm shim swallows stdout/exit code in non-TTY, so a success can look like a failure.

## Testing policy (TDD)

This project is designed around TDD. **Write tests before implementation.**

- **Domain**: pure unit tests. Cover `NamingRule` resolution, `ArchiveJob.plan`/`reorder` invariants, and name-uniqueness boundary cases. For any **state machine** (e.g. `TaskStatus`), test every `(state × event)` pair: legal transitions assert the resulting state, illegal ones assert the typed error, and terminal states reject all events.
- **Application**: verify parallelism and error tallying **deterministically**. PR-5a uses **hand-written fakes** (`FakeArchiver` / `FixedClock` / `RecordingSink`), not `mockall`: the evolved `Archiver` returns `impl Future + Send` (RPITIT), which `mockall` cannot mock cleanly, and a purpose-built fake gives the control the timing assertions need — a `tokio::sync::Barrier(N)` + `timeout` proves N workers run concurrently, and the **cap** is proven by running *more* tasks than the limit and asserting peak liveness `== N` (sampled at the barrier rendezvous). `mockall` (kept in deps) returns in PR-5b for the richer cancel-path doubles; `Clock` is faked with a fixed `Instant` so `elapsed` is deterministic.
- **Concurrency**: verify the shared progress aggregator and cancellation propagation with `loom`. `loom` is a normal `optional` dependency on `simple-archiver-core` gated behind the `loom` feature (Cargo cannot mark dev-dependencies optional). It is off by default, so normal builds never compile it; the verification run above flips the feature on. **loom is incompatible with `tokio::fs`**: under `RUSTFLAGS="--cfg loom"` tokio disables its IO modules (`fs`, net, …) because loom only model-checks concurrency primitives. Pure-domain modules (no IO/async) need **no** `#[cfg(not(loom))]` guard and must keep compiling and passing under the `loom` feature — only modules that use `tokio::fs` or other IO require the guard. So IO adapters that use `tokio::fs` (e.g. `ZipArchiver`) must be excluded from loom builds via `#[cfg(not(loom))]` (on the `infrastructure::zip_archiver` module declaration and on its integration test file), and the bare `cfg(loom)` name must be declared in `crates/core/Cargo.toml` under `[lints.rust] unexpected_cfgs = { check-cfg = ['cfg(loom)'] }` so `cargo clippy -D warnings` stays clean. Concurrency code targeted by loom arrives in **PR-5b**: PR-5a builds the engine but adds **no** loom tests. Two modules are gated `#[cfg(not(loom))]` — `application::run_archive_job` (uses the tokio runtime: `rt`/`sync`/`spawn`/`mpsc`/`Semaphore`) and `infrastructure::zip_archiver` (`tokio::fs`) — while every other new module (`progress`, `compress_context`, `progress_aggregator`, `ports`, `system_clock`) is pure/std and must keep compiling and passing under the `loom` feature. So the loom build now compiles down to the pure domain **plus** those std/pure application modules.
- **Infrastructure**: narrow integration tests against small real fixtures (small folder, small .rar). Few and slow, so isolate them with a marker.
- **Presentation (Tauri commands)**: a `#[tauri::command] pub fn` is an ordinary Rust function; its `Result<_, String>` mapping can be asserted in a plain `#[cfg(test)]` unit test **without** constructing an `App` or `Window`. Integration-level coverage (command seam: argument names `src`/`out`, `ArchiveError`→`String` IPC mapping) can be added via `src-tauri/tests/*.rs` — the macro does not consume the original fn. Requires: the `presentation` module is `pub`, the lib crate is `simple_archiver_lib` with `[lib] crate-type` including `"rlib"`, and dev-deps `tokio` (macros, rt-multi-thread) + `zip` + `tempfile`.
- **Frontend**: Vitest on jsdom + Testing Library for preview computation, reordering, and progress rendering, including event-payload contract tests. Mock `@tauri-apps/api/core` (`invoke`) and `@tauri-apps/plugin-dialog` (`open`/`save`).
  - `@testing-library/user-event` treats `{` as a special key sequence — type a literal brace as `{{` (e.g. `img_{{n:03}` produces `img_{n:03}`).
  - Combining `vi.useFakeTimers()` with `userEvent` can deadlock in jsdom. For debounce-timing tests, drive input with `fireEvent.change` + `vi.advanceTimersByTimeAsync`, and confirm the test fails when the debounce is removed as a correctness check.
- **E2E**: a folder → zip walking-skeleton smoke test.

## Commit / PR rules

- Target **one PR ≤ 1000 lines**, with the walking skeleton (folder → zip e2e) going first. The line count includes co-located tests; a TDD-heavy, cohesive pure-domain PR can legitimately exceed 1000 lines (PR4 ran to ~1.5k, largely tests). When that happens, surface it explicitly and get maintainer approval rather than silently splitting interdependent code across stacked PRs.
- Stack PRs in order of high-impact × low-effort (follow the PR1–PR10 split and dependency graph in the design).
- Each PR has acceptance criteria in the design; do not mix in out-of-scope items.
- Before merge, `cargo clippy` / `cargo fmt` / `cargo nextest run` / `pnpm test` must all be green. CI builds on both Mac and Windows.
- Never run `git commit` / `git push` until the user explicitly asks.

## Build / scaffold notes (learnings)

- **`bitflags` pinned to `=2.8.0` (src-tauri).** dispatch2 (transitive via tao→wry→tauri) emits a large `bitflags!` block; bitflags 2.9+ expands it recursively and overflows the default `recursion_limit = 128`. 2.8.0 is non-recursive. Remove the pin once dispatch2 sets `#![recursion_limit]` or bitflags fixes the recursion. (See the comment in `src-tauri/Cargo.toml`.)
- **pnpm build-script approval lives in `pnpm-workspace.yaml`.** `onlyBuiltDependencies: [esbuild]` must sit there: pnpm 11 ignores `pnpm.onlyBuiltDependencies` in `package.json` and treats `allowBuilds` as a no-op. Without approval, esbuild's postinstall is skipped and `vite build` fails under CI's `--frozen-lockfile`.
- **Tailwind v4 + shadcn needs explicit theme glue.** The global CSS requires a `@theme inline { --color-*: var(--*) }` block plus `@custom-variant dark`. v4 does not auto-generate `bg-primary` / `border-ring` etc. from bare `:root` variables; without the glue the build passes but shadcn components render unstyled.
- **Follow-up (PR10 bundling):** the Tauri bundle identifier `com.simplearchiver.app` ends in `.app` and triggers a warning; change it before the bundling PR.
- **logos + LALRPOP build wiring.** The `core` crate uses a `build.rs` that calls `lalrpop::process_root()` to codegen the parser from `src/domain/template.lalrpop`. The generated file is referenced with `lalrpop_util::lalrpop_mod!(name, "/domain/template.rs")` — the path must mirror the `.lalrpop` file location. `lalrpop` (build-dep) and `lalrpop-util` (dep) **must be pinned to the same version** (0.20.x); version skew causes silent codegen mismatches. logos provides the lexer; its `SpannedIter` is adapted into `(start, token, end)` triples for LALRPOP's external-lexer mode.
- **clippy `-D warnings` gotchas (CI gate).** Two patterns tripped this PR:
  - Use `!(1..=N).contains(&x)` instead of `x < 1 || x > N`; the latter triggers `clippy::manual_range_contains`.
  - A `pub` / `pub(crate)` item is exempt from `dead_code`, but a non-public fn that is only consumed by tests until a later task wires real callers may need a temporary `#[allow(dead_code)]`; remove it once production code calls it.

For coding conventions (including the English-comment rule), see L3 [`/.claude/conventions.md`](../.claude/conventions.md).
