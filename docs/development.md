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

- **Domain**: pure unit tests. Cover `NamingRule` resolution, `ArchiveJob.plan`/`reorder` invariants, and name-uniqueness boundary cases.
- **Application**: mock `Extractor`/`Archiver`/`Clock` with `mockall`; verify parallelism, cancellation (interrupt → cleanup invoked), and error tallying **deterministically**.
- **Concurrency**: verify the shared progress aggregator and cancellation propagation with `loom`. `loom` is a normal `optional` dependency on `simple-archiver-core` gated behind the `loom` feature (Cargo cannot mark dev-dependencies optional). It is off by default, so normal builds never compile it; the verification run above flips the feature on.
- **Infrastructure**: narrow integration tests against small real fixtures (small folder, small .rar). Few and slow, so isolate them with a marker.
- **Frontend**: Vitest for preview computation, reordering, and progress rendering. Includes event-payload contract tests.
- **E2E**: a folder → zip walking-skeleton smoke test.

## Commit / PR rules

- Target **one PR ≤ 1000 lines**, with the walking skeleton (folder → zip e2e) going first.
- Stack PRs in order of high-impact × low-effort (follow the PR1–PR10 split and dependency graph in the design).
- Each PR has acceptance criteria in the design; do not mix in out-of-scope items.
- Before merge, `cargo clippy` / `cargo fmt` / `cargo nextest run` / `pnpm test` must all be green. CI builds on both Mac and Windows.
- Never run `git commit` / `git push` until the user explicitly asks.

## Build / scaffold notes (learnings)

- **`bitflags` pinned to `=2.8.0` (src-tauri).** dispatch2 (transitive via tao→wry→tauri) emits a large `bitflags!` block; bitflags 2.9+ expands it recursively and overflows the default `recursion_limit = 128`. 2.8.0 is non-recursive. Remove the pin once dispatch2 sets `#![recursion_limit]` or bitflags fixes the recursion. (See the comment in `src-tauri/Cargo.toml`.)
- **pnpm build-script approval lives in `pnpm-workspace.yaml`.** `onlyBuiltDependencies: [esbuild]` must sit there: pnpm 11 ignores `pnpm.onlyBuiltDependencies` in `package.json` and treats `allowBuilds` as a no-op. Without approval, esbuild's postinstall is skipped and `vite build` fails under CI's `--frozen-lockfile`.
- **Tailwind v4 + shadcn needs explicit theme glue.** The global CSS requires a `@theme inline { --color-*: var(--*) }` block plus `@custom-variant dark`. v4 does not auto-generate `bg-primary` / `border-ring` etc. from bare `:root` variables; without the glue the build passes but shadcn components render unstyled.
- **Follow-up (PR10 bundling):** the Tauri bundle identifier `com.simplearchiver.app` ends in `.app` and triggers a warning; change it before the bundling PR.

For coding conventions (including the English-comment rule), see L3 [`/.claude/conventions.md`](../.claude/conventions.md).
