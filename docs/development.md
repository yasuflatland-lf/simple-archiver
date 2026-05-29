# Development Guide (L2)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = this file / L3 = [`/.claude/`](../.claude/).

## Tech stack

| Area | Choice |
|---|---|
| Framework | Tauri 2 (single native app for Mac/Windows) |
| Frontend | Vite + React + TypeScript + shadcn/ui (shadcn-admin layout / asics design tokens), state via zustand |
| Backend | Rust, DDD layered (module split inside a single binary crate) |
| zip creation | `async_zip` |
| rar extraction | `unrar` (extract-only; bundled C++ source for both Mac/Win) |
| Rust tests | cargo-nextest (runner) / mockall (port mocks) / loom (concurrency verification) |
| Frontend tests | Vitest |

Technology choices are fixed. **Do not swap in alternative libraries on your own.** If a change is needed, propose it together with an update to the design (the source of truth).

## Development commands

After scaffolding (PR1), use the following as the standard commands. Before running, confirm the relevant files (`Cargo.toml` / `package.json` / `src-tauri/`) exist.

```bash
# Rust (under src-tauri/)
cargo nextest run          # run tests (use nextest, not `cargo test`)
cargo clippy --all-targets # lint (keep layer boundaries clean, zero warnings)
cargo fmt                  # format

# loom concurrency verification (target tests only; kept separate from normal runs)
RUSTFLAGS="--cfg loom" cargo nextest run --features loom

# Frontend
npm run test               # Vitest
npm run lint
npm run build

# App run / build
npm run tauri dev
npm run tauri build
```

> Note: the command/script names are finalized at scaffold time. Adapt them to the actual `package.json` / CI config.

## Testing policy (TDD)

This project is designed around TDD. **Write tests before implementation.**

- **Domain**: pure unit tests. Cover `NamingRule` resolution, `ArchiveJob.plan`/`reorder` invariants, and name-uniqueness boundary cases.
- **Application**: mock `Extractor`/`Archiver`/`Clock` with `mockall`; verify parallelism, cancellation (interrupt → cleanup invoked), and error tallying **deterministically**.
- **Concurrency**: verify the shared progress aggregator and cancellation propagation with `loom`.
- **Infrastructure**: narrow integration tests against small real fixtures (small folder, small .rar). Few and slow, so isolate them with a marker.
- **Frontend**: Vitest for preview computation, reordering, and progress rendering. Includes event-payload contract tests.
- **E2E**: a folder → zip walking-skeleton smoke test.

## Commit / PR rules

- Target **one PR ≤ 1000 lines**, with the walking skeleton (folder → zip e2e) going first.
- Stack PRs in order of high-impact × low-effort (follow the PR1–PR10 split and dependency graph in the design).
- Each PR has acceptance criteria in the design; do not mix in out-of-scope items.
- Before merge, `cargo clippy` / `cargo fmt` / `cargo nextest run` / `npm run test` must all be green. CI builds on both Mac and Windows.
- Never run `git commit` / `git push` until the user explicitly asks.

For coding conventions (including the English-comment rule), see L3 [`/.claude/conventions.md`](../.claude/conventions.md).
