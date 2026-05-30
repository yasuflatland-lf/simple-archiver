# simple-archiver

[![CI](https://img.shields.io/github/actions/workflow/status/yasuflatland-lf/simple-archiver/ci.yml?branch=main&label=CI&logo=github)](https://github.com/yasuflatland-lf/simple-archiver/actions/workflows/ci.yml)
[![backend coverage](https://img.shields.io/codecov/c/github/yasuflatland-lf/simple-archiver?flag=rust&label=backend%20coverage&logo=codecov)](https://codecov.io/gh/yasuflatland-lf/simple-archiver)
[![frontend coverage](https://img.shields.io/codecov/c/github/yasuflatland-lf/simple-archiver?flag=frontend&label=frontend%20coverage&logo=codecov)](https://codecov.io/gh/yasuflatland-lf/simple-archiver)

A native desktop app (Mac / Windows) that takes drag-and-dropped **rar files** and **folders** and batch re-archives them into **zip** files following a single naming rule. rar files are extracted and re-compressed to zip; folders are zipped as-is.

## Overview

Drop a mix of rar files and folders, reorder them, give the batch a single naming rule with an auto-incrementing sequence number, and hit run. Each item is compressed to a zip in list order, with a per-row progress bar and ETA plus an overall progress bar and ETA for the whole job.

It ships as a single self-contained native application built with **Tauri 2** — a Rust engine for the archiving work and a Vite + React frontend for the UI.

## Features

- **Drag & drop intake** — add multiple rar files and/or folders at once (drag-drop or a file dialog).
- **Reorderable list** — move items up and down; the run order follows the list top to bottom.
- **Batch naming rule** — specify a single prefix string and number every item sequentially from `1`, top to bottom. A placeholder inside the prefix marks where the sequence number goes, e.g. `photo_{n:03}` → `photo_001`, `photo_002`, … The sequence number is fixed at job-creation time in list order (independent of completion order).
- **One-click run** — compresses every item per the naming rule, from the top of the list:
  - **rar file** → extracted to a temporary workspace, then re-compressed into a zip.
  - **folder** → compressed into a zip directly.
- **Live per-item progress** — each row shows a progress bar and an estimated-time-remaining string, updated asynchronously while the job runs.
- **Overall progress** — a job-wide progress bar and ETA for all items combined.
- **Resilient by design** — output goes to one user-chosen folder; existing names are **not overwritten** (that item fails instead), a failed item never stops the others, and a run can be cancelled (in-flight work is interrupted and partial output / temp files are cleaned up). A success/failure summary is shown at the end.

## Tech stack

| Area | Choice |
|---|---|
| Framework | [Tauri 2](https://v2.tauri.app/) — single native app for Mac / Windows |
| Frontend | [Vite](https://vite.dev/) + [React 19](https://react.dev/) + TypeScript + [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (new-york) + [Radix](https://www.radix-ui.com/) + [zustand](https://zustand-demo.pmnd.rs/) |
| Design | Base layout after [shadcn-admin](https://shadcn-admin.netlify.app/); design system after the [shadcn.io ASICS design](https://www.shadcn.io/design/asics) (ASICS color tokens, light/dark theme, Inter typography) |
| Backend / engine | Rust, DDD layered / hexagonal (Cargo workspace: pure `simple-archiver-core` crate + `src-tauri` presentation crate) |
| zip creation | [`async_zip`](https://crates.io/crates/async_zip) |
| rar extraction | [`unrar`](https://crates.io/crates/unrar) (extract-only; bundled C++ source for both Mac / Windows) |
| Pluggable compression | `Extractor` / `Archiver` / `Clock` ports + a `FormatRegistry` that routes each source kind to the right adapter — see [Pluggable compression](#pluggable-compression) |
| TypeScript bindings | [`ts-rs`](https://crates.io/crates/ts-rs) (`#[derive(TS)]` on DTOs generates the `.ts` wire contract in `src/bindings/`) |
| Naming parser | [LALRPOP](https://crates.io/crates/lalrpop) (grammar codegen) + [logos](https://crates.io/crates/logos) (lexer) — build-time tooling inside `simple-archiver-core` |
| Rust tests | [cargo-nextest](https://nexte.st/) (runner) + [mockall](https://crates.io/crates/mockall) (port mocks) + [loom](https://crates.io/crates/loom) (concurrency verification) |
| Frontend tests | [Vitest](https://vitest.dev/) + Testing Library (jsdom) |
| Format / lint | [Biome](https://biomejs.dev/) (frontend) + `cargo fmt` / `clippy` (Rust) |
| Tooling | [pnpm](https://pnpm.io/) (package manager) + [mise](https://mise.jdx.dev/) (pinned toolchain) |

Technology choices are fixed. The compression libraries are deliberately kept behind a common interface so they can be treated as plugins (see below), but the libraries themselves are not swapped without a corresponding design change.

## Architecture

The Rust backend follows **DDD layered / hexagonal** design, split across a Cargo workspace with two crates: a pure `simple-archiver-core` crate holding `domain` / `application` / `infrastructure`, and the `src-tauri` crate holding `presentation`.

```
presentation   src-tauri/src/presentation/ — Tauri commands, session state, DTO / event wiring
application    simple-archiver-core — RunArchiveJob: N parallel workers, progress aggregation,
               cancellation, error tally / ports: Extractor, Archiver, Clock / FormatRegistry
domain         simple-archiver-core — pure, no IO (ArchiveJob, ArchiveTask, NamingRule, …)
infrastructure simple-archiver-core — adapters: ZipArchiver(async_zip) / UnrarExtractor(unrar)
                                       / TempWorkspace / SystemClock
```

Dependency direction is strict: `presentation → application → domain` and `infrastructure → domain`; `domain` depends on no other layer and contains no IO or async. All file, process, and clock access goes through ports. For the full design and the layer-boundary rules, see [`docs/architecture.md`](docs/architecture.md).

### Pluggable compression

The spec calls for the compression libraries to be treated as plugins, behind a common interface, with the per-format differences isolated in one place. This is realized with:

- **Common ports** — `Extractor` (rar → directory) and `Archiver` (directory → zip), so the engine drives any format through the same async interface.
- **`FormatRegistry`** — resolves each `SourceItem` to a compressible directory: a `Folder` is compressed directly, while a `RarFile` is first extracted (via `UnrarExtractor`) into a `TempWorkspace` RAII guard and then compressed. The guard's `Drop` guarantees temp cleanup even on error.

Adding another archive format means adding an adapter behind these ports and a branch in the registry — the engine, domain, and UI stay untouched.

## Getting started

Prerequisites: a Rust toolchain, Node.js, and pnpm. The toolchain versions are pinned via [`mise.toml`](mise.toml) (run `mise install` to get them), and the Tauri prerequisites for your OS are listed in the [Tauri docs](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install          # install frontend dependencies
pnpm tauri dev        # run the app in development
pnpm tauri build      # build a native bundle for the current OS
```

## Development

Run all commands from the repo root (the Cargo workspace lives there, not under `src-tauri/`).

```bash
# Rust — pure core (the TDD battleground; -p keeps Tauri out)
cargo nextest run -p simple-archiver-core
cargo clippy -p simple-archiver-core --all-targets -- -D warnings
cargo fmt

# Frontend
pnpm test             # Vitest one-shot
pnpm check            # Biome: format + lint with autofix
pnpm build            # tsc + vite build (the load-bearing type gate)
```

This project is built with **TDD**: write tests before implementation. For the full set of commands, the testing policy, and CI layout, see [`docs/development.md`](docs/development.md).

## Status

Under active development. The archiving engine is wired end-to-end for both folders and rar files, and the main screen (drag-drop intake, reorder, naming-rule preview, run / cancel, per-item progress, failure summary) is in place. The moving-average ETA estimator is the next piece of work.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — layered / hexagonal design and layer boundaries
- [`docs/development.md`](docs/development.md) — tech stack, dev commands, testing policy, PR rules
- [`CLAUDE.md`](CLAUDE.md) — mandatory project rules and documentation map

## License

This project is licensed under the [MIT License](LICENSE).
