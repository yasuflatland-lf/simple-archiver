# simple-archiver

[![CI](https://img.shields.io/github/actions/workflow/status/yasuflatland-lf/simple-archiver/ci.yml?branch=main&label=CI&logo=github)](https://github.com/yasuflatland-lf/simple-archiver/actions/workflows/ci.yml)
[![backend coverage](https://img.shields.io/codecov/c/github/yasuflatland-lf/simple-archiver?flag=rust&label=backend%20coverage&logo=codecov)](https://codecov.io/gh/yasuflatland-lf/simple-archiver)
[![frontend coverage](https://img.shields.io/codecov/c/github/yasuflatland-lf/simple-archiver?flag=frontend&label=frontend%20coverage&logo=codecov)](https://codecov.io/gh/yasuflatland-lf/simple-archiver)

A native desktop app (Mac / Windows) that takes drag-and-dropped **rar files**, **zip files**, and **folders** and batch re-archives them into **zip** files following a single naming rule. rar and zip files are extracted and re-compressed to standard Deflate zip; folders are zipped as-is.

## Installation

Download the installer for your OS from the **[latest release](https://github.com/yasuflatland-lf/simple-archiver/releases/latest)**:

- **macOS** — `simple-archiver_<version>_universal.dmg` (universal: Apple Silicon + Intel)
- **Windows** — `simple-archiver_<version>_x64-setup.exe` (installer) or `simple-archiver_<version>_x64_en-US.msi`

> [!IMPORTANT]
> The app is **not notarized by Apple** and **not signed by a Windows publisher**, so
> your OS shows a security warning the **first time** you open it. This is expected and
> safe. Follow the steps below **once** — after that, the app opens normally like any
> other app.

### macOS — first launch

1. Double-click the downloaded `.dmg`. If a dialog says *"…dmg cannot be opened
   because Apple cannot check it for malicious software"*, click **Done**
   (do **not** click *Move to Trash*).
2. Open the Apple menu → **System Settings…** → **Privacy & Security**.
3. Scroll down to the **Security** section. macOS shows the blocked item with an
   **Open Anyway** button on the right, like this:

   > **"simple-archiver_…_universal.dmg" was blocked to protect your Mac.**  `[ Open Anyway ]`
   >
   > Apple could not verify "simple-archiver_…_universal.dmg" is free of malware that
   > may harm your Mac or compromise your privacy.

   Click the **Open Anyway** button on the right of that message.
4. Click **Open Anyway** once more to confirm, then unlock with Touch ID or your
   Mac password.
5. The `.dmg` opens. Drag the **simple-archiver** icon onto the **Applications**
   folder shown in the window.
6. Open **simple-archiver** from Applications (or Launchpad). If the same warning
   appears for the app itself, repeat steps 2–4 once — the blocked item will now be
   the app — and it will launch. It opens directly every time after that.

### Windows — first launch

1. Run the downloaded `.exe` (or `.msi`).
2. If **"Windows protected your PC"** (SmartScreen) appears, click the small
   **More info** link.
3. Click **Run anyway**, then follow the installer prompts.

<details>
<summary>Advanced (Terminal): skip the macOS warning</summary>

If you are comfortable with the Terminal, you can remove the quarantine flag instead
of using System Settings:

```bash
# the downloaded disk image
xattr -d com.apple.quarantine ~/Downloads/simple-archiver_*_universal.dmg
# the installed app (after dragging it to Applications)
xattr -dr com.apple.quarantine /Applications/simple-archiver.app
```

</details>

## Architecture

![simple-archiver architecture](docs/images/architecture.png)

## Overview

Drop a mix of rar files, zip files, and folders, reorder them, give the batch a single naming rule with an auto-incrementing sequence number, and hit run. Each item is compressed to a zip in list order, with a per-row progress bar and ETA plus an overall progress bar and ETA for the whole job.

It ships as a single self-contained native application built with **Tauri 2** — a Rust engine for the archiving work and a Vite + React frontend for the UI.

## Features

- **Drag & drop intake** — add multiple rar files, zip files, and/or folders at once (drag-drop or a file dialog).
- **Reorderable & selectable list** — select rows (click, <kbd>Shift</kbd>+click for a range, <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+click to toggle), move items up and down (drag, buttons, or arrow keys), and delete unwanted rows; the run order follows the list top to bottom. See [Keyboard shortcuts](#keyboard-shortcuts).
- **Content-fit columns** — the queue and the completion summary size each column to its content so every column stays visible without horizontal scrolling. In the queue you can still drag a column's right edge to set a custom width, or double-click the resize handle to snap it back to its content.
- **Batch naming rule** — specify a single prefix string and number every item sequentially from `1`, top to bottom. A placeholder inside the prefix marks where the sequence number goes: `{n}` inserts the bare number, and `{n:0W}` zero-pads it to width `W` (1–9), e.g. `photo_{n:03}` → `photo_001`, `photo_002`, … A **live preview** shows the resulting `seq=1` filename as you type, and every queue row previews its own output name. The sequence number is fixed at job-creation time in list order (independent of completion order). Output names are de-duplicated case-insensitively and validated to be Windows-safe.
- **One-click run** — compresses every item per the naming rule, from the top of the list:
  - **rar file** → extracted to a temporary workspace, then re-compressed into a standard Deflate zip.
  - **zip file** → extracted to a temporary workspace, then re-compressed into a standard Deflate zip.
  - **folder** → compressed into a zip directly.
- **Live per-item progress** — each row shows a progress bar and an estimated-time-remaining string, updated asynchronously while the job runs.
- **Overall progress** — a job-wide progress bar and ETA for all items combined.
- **Output directory** — pick one destination folder through the native OS picker; all archives are written there. The app remembers your last chosen directory and, on first run, defaults to the OS Downloads folder.
- **Resilient by design** — existing names are **not overwritten** (that item fails instead), a failed item never stops the others, and a run can be cancelled (in-flight work is interrupted and partial output / temp files are cleaned up). A run summary tallying **succeeded / cancelled / failed** items is shown at the end.

### Keyboard shortcuts

The queue supports both mouse selection and keyboard control. Click anywhere in the queue to focus it, then:

| Action | Shortcut |
|---|---|
| Select a single row | Click |
| Add / remove a row from the selection | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + Click |
| Select a range of rows | <kbd>Shift</kbd> + Click |
| Select all rows | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>A</kbd> |
| Move the selected row up / down | <kbd>↑</kbd> / <kbd>↓</kbd> |
| Delete the selected rows | <kbd>Delete</kbd> / <kbd>Backspace</kbd> |
| Clear the selection | <kbd>Esc</kbd> |

Selection, reordering, and deletion are disabled while a job is running. Moving a row with the arrow keys requires exactly one selected row; with no row or several rows selected, the arrow keys scroll the queue instead.

## Getting started (from source)

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
pnpm check            # oxfmt + oxlint: format + lint with autofix
pnpm build            # tsc + vite build (the load-bearing type gate)
```

## Tech stack

| Area | Choice |
|---|---|
| Framework | [Tauri 2](https://v2.tauri.app/) — single native app for Mac / Windows |
| Frontend | [Vite](https://vite.dev/) + [React 19](https://react.dev/) + TypeScript (strict) + [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (new-york) on [Radix](https://www.radix-ui.com/) primitives ([class-variance-authority](https://cva.style/) + [clsx](https://github.com/lukeed/clsx) + [tailwind-merge](https://github.com/dcastil/tailwind-merge)) + [lucide-react](https://lucide.dev/) (icons) + [zustand](https://zustand-demo.pmnd.rs/) (state) + [Inter](https://github.com/fontsource/fontsource) (variable font) |
| Design | Base layout after [shadcn-admin](https://shadcn-admin.netlify.app/); design system after the [shadcn.io ASICS design](https://www.shadcn.io/design/asics) (ASICS color tokens, light/dark theme, Inter typography) |
| Backend / engine | Rust, DDD layered / hexagonal (Cargo workspace: pure `simple-archiver-core` crate + `src-tauri` presentation crate) |
| zip creation | [`async_zip`](https://crates.io/crates/async_zip) |
| rar extraction | [`unrar`](https://crates.io/crates/unrar) (extract-only; bundled C++ source for both Mac / Windows) |
| Pluggable compression | `Extractor` / `Archiver` / `Clock` ports + a `FormatRegistry` that routes each source kind to the right adapter — see [Pluggable compression](#pluggable-compression) |
| TypeScript bindings | [`ts-rs`](https://crates.io/crates/ts-rs) (`#[derive(TS)]` on DTOs generates the `.ts` wire contract in `src/bindings/`) |
| Naming parser | [LALRPOP](https://crates.io/crates/lalrpop) (grammar codegen) + [logos](https://crates.io/crates/logos) (lexer) — build-time tooling inside `simple-archiver-core` |
| Rust tests | [cargo-nextest](https://nexte.st/) (runner) + [mockall](https://crates.io/crates/mockall) (port mocks) + [loom](https://crates.io/crates/loom) (concurrency verification) |
| Frontend tests | [Vitest](https://vitest.dev/) + Testing Library (jsdom) |
| Format / lint | [oxlint](https://oxc.rs/docs/guide/usage/linter) + [oxfmt](https://oxc.rs/docs/guide/usage/formatter) (frontend) + `cargo fmt` / `clippy` (Rust) |
| Dead-code | [knip](https://knip.dev/) (frontend, `pnpm knip`) |
| Tooling | [pnpm](https://pnpm.io/) (package manager) + [mise](https://mise.jdx.dev/) (pinned toolchain) |

Technology choices are fixed. The compression libraries are deliberately kept behind a common interface so they can be treated as plugins (see below), but the libraries themselves are not swapped without a corresponding design change.

### Pluggable compression

The spec calls for the compression libraries to be treated as plugins, behind a common interface, with the per-format differences isolated in one place. This is realized with:

- **Common ports** — `Extractor` (rar → directory) and `Archiver` (directory → zip), so the engine drives any format through the same async interface.
- **`FormatRegistry`** — resolves each `SourceItem` to a compressible directory: a `Folder` is compressed directly, while a `RarFile` or `ZipFile` is first extracted (via `UnrarExtractor` or `ZipExtractor` respectively) into a `TempWorkspace` RAII guard and then re-compressed to standard Deflate zip. The guard's `Drop` guarantees temp cleanup even on error.

Adding another archive format means adding an adapter behind these ports and a branch in the registry — the engine, domain, and UI stay untouched.

## Processing flow

The end-to-end path from a drop to the final summary, across the four layers:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Frontend<br/>(React + zustand)
    participant Cmd as Tauri commands<br/>(presentation)
    participant Engine as RunArchiveJob + Aggregator<br/>(application)
    participant Worker as Worker ×N<br/>(per task)
    participant Reg as FormatRegistry
    participant Unrar as UnrarExtractor
    participant Zip as ZipArchiver

    Note over User,Cmd: 1 — Build the draft
    User->>UI: drag & drop rar/zip files / folders
    UI->>Cmd: add_items(paths)
    Cmd->>Cmd: classify_path → Folder | RarFile | ZipFile
    Cmd-->>UI: DraftSnapshot
    User->>UI: set naming rule + output dir
    UI->>Cmd: set_naming_rule / set_output_dir
    UI->>Cmd: preview_output_name(template, seq)
    Cmd-->>UI: preview filenames

    Note over User,Zip: 2 — Run the job
    User->>UI: click Run
    UI->>Cmd: run_job()
    Cmd->>Cmd: draft.build() → ArchiveJob, claim run slot
    Cmd->>Engine: execute_with_cancellation(job, sink, token)

    loop per task — bounded to N parallel workers
        Engine->>Worker: spawn run_one(task)
        alt RarFile
            Worker->>Reg: prepare(RarFile)
            Reg->>Unrar: extract(path) → temp workspace
            Unrar-->>Worker: ExtractedTree (RAII temp guard)
        else ZipFile
            Worker->>Reg: prepare(ZipFile)
            Reg->>Zip: extract(path) → temp workspace
            Zip-->>Worker: ExtractedTree (RAII temp guard)
        else Folder
            Worker->>Reg: prepare(Folder) → dir as-is
        end
        Worker->>Zip: compress(dir, dest, ctx)
        loop while compressing
            Zip-->>Worker: ctx.report(bytes_done / total)
            Worker-->>Engine: WorkerMsg::Progress (mpsc)
            Engine->>Engine: Aggregator.apply + snapshot
            Engine-->>UI: emit "archive://progress"
            UI->>UI: applyProgress → per-row & overall bar / ETA
        end
        Worker-->>Engine: WorkerMsg::Status (TaskEvent: Complete | Fail | Cancel)
        Note over Worker,Unrar: temp workspace dropped → cleaned up
    end

    Engine-->>Cmd: JobSummary
    Cmd-->>UI: JobSummaryDto (run_job resolves)
    UI-->>User: success / failure summary

    Note over User,Zip: Cancellation — any time during a run
    User->>UI: click Cancel
    UI->>Cmd: cancel_job()
    Cmd->>Engine: request_cancel() → CancellationToken fired
    Engine-->>Worker: ctx.is_cancelled() → interrupt in-flight task
```

Workers run concurrently up to `available_parallelism`, but only one task — the aggregator on the engine's own task — ever writes progress: each worker pushes `WorkerMsg` over an `mpsc` channel, the aggregator folds them into a job-wide snapshot, and the presentation layer's `TauriEmitter` forwards each snapshot to the frontend as an `archive://progress` event. A failed item is tallied but never stops its siblings, and `run_job` always resolves with a `JobSummaryDto` — the load-bearing terminal signal — even if some progress frames were dropped along the way.



## Documentation

- [`docs/architecture.md`](docs/architecture.md) — layered / hexagonal design and layer boundaries
- [`docs/development.md`](docs/development.md) — tech stack, dev commands, testing policy, PR rules
- [`CLAUDE.md`](CLAUDE.md) — mandatory project rules and documentation map

## License

This project is licensed under the [MIT License](LICENSE).
