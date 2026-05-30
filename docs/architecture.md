# Architecture (L2)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = this file / L3 = [`/.claude/`](../.claude/).
> The authoritative design lives in Notion; the local mirror is `docs/superpowers/specs/` (git-ignored).

## Overview

`simple-archiver` is a **Mac/Windows native desktop app** that lets you drag and drop multiple rar files/folders and compresses them into zip archives following a batch rename rule.

- rar is first extracted, then re-compressed to zip; folders are zipped as-is
- processed by N parallel workers; sequence numbers are fixed at job-creation time in list order (independent of completion order)
- output goes to a single user-specified folder; name collisions are **not overwritten** — that task fails instead
- errors are **caught per task and other tasks continue**; a success/failure summary is shown
- cancellation is required for the MVP (interrupt in-flight work + clean up partial output/temp)

## Current state

**Scaffold landed (PR1).** A Cargo workspace + Tauri shell + Vite/React frontend + CI now exist; the domain/application/infrastructure logic is still to be built. Treat the structure and commands here as the live target.

## Layered / hexagonal structure

The Rust backend is split across a **Cargo workspace** with two crates: a pure `simple-archiver-core` crate holding `domain` / `application` / `infrastructure`, and the `src-tauri` crate holding `presentation`.

```
presentation   src-tauri crate — Tauri commands + events
               add_items / reorder / set_naming_rule / set_output_dir / run_job / cancel_job → emit progress
application    simple-archiver-core — use case / orchestration
               RunArchiveJob: N parallel workers, progress aggregation, cancellation, error tally / ports: Extractor, Archiver, Clock
domain         simple-archiver-core — pure, no IO (the main TDD battleground)
               ArchiveJob (aggregate root) / ArchiveTask / NamingRule / SequenceNumber / SourceItem / OutputDirectory
infrastructure simple-archiver-core — isolates the variation / adapters
               ZipArchiver(async_zip) / UnrarExtractor(unrar) / TempWorkspace / SystemClock
```

**Why a workspace (core split from Tauri):** Tauri's `generate_context!()` requires the built frontend `dist/` at compile time. Keeping `domain`/`application` inside the Tauri crate would couple pure-logic `cargo test` / `clippy` to a frontend build. The standalone `simple-archiver-core` crate lets domain tests run with no `dist/`/webview (the TDD battleground stays fast); CI's `core` job builds `-p simple-archiver-core` so it never pulls in Tauri.

## Layer boundary discipline (strict)

- **Dependency direction**: `presentation → application → domain`, `infrastructure → domain`. `domain` depends on no other layer.
- **`domain` is pure**: no IO, async, or external-crate dependencies. All file/process/clock access goes through ports. This includes naming logic: the logos lexer + LALRPOP grammar that parse/validate/resolve naming templates generate pure, IO-free, async-free code and live entirely in `domain`. Keeping naming in `domain` makes it testable-first and reusable by later job/execution work.
- **IO is isolated behind ports**: `Extractor` (rar→dir) / `Archiver` (dir→zip) / `Clock`, with implementations in `infrastructure`. Ports are async traits (`async fn` in trait with `#[allow(async_fn_in_trait)]`), acceptable while every caller uses the concrete adapter (future `Send`-ness is inferred); revisited in PR5 when parallelism needs `Send` futures across `tokio::spawn`.
- **Default visibility is `pub(crate)`**; layer boundaries are enforced with clippy. Parser/codegen internals — `Token`, `Lexer`, `LexError`, `Segment`, the generated `template` module, and `parse_segments` — are `pub(crate)` or private. The crate's public surface is limited to validated value objects (`NamingRule`, `SequenceNumber`, `FileStem`, `OutputFileName`) and their error enums. WHY: callers cannot bypass `NamingRule::parse` to build unvalidated `Segment`s, and lexer/grammar changes remain non-breaking.
- **IPC error boundary**: domain errors (`NamingRuleError` / `NameError` / `SequenceError`) cross to the frontend as a `String` via `e.to_string()` at the Tauri command layer. The exact message text is a shared contract pinned by tests on both sides (Rust command test and frontend test assert the same string). WHY: the Tauri command is a thin bridge with Rust as the single source of truth — no validation logic is duplicated in TypeScript. The only naming-related outward touch points are the `preview_output_name` Tauri command (presentation) and the React `NamingRuleForm`.

### Infrastructure adapter invariants

- **`ZipArchiver` walks the full source file list before creating/opening the destination zip.** If the output zip lands inside the source directory, creating it first lets `WalkDir` encounter the partially-written archive and read it back into itself — a corrupt, order/timing-dependent result (a runtime path-skip via `canonicalize` is fail-open when canonicalization fails under load). Walking first, then writing, makes self-inclusion structurally impossible regardless of platform symlinks or filesystem timing.

## Execution engine (application)

- `FormatRegistry`: `Folder` → Archiver only / `RarFile` → Extractor (→temp) then Archiver.
- `RunArchiveJob`: up to N parallel via tokio (default = `available_parallelism`). Each task reports byte progress through a `ProgressSink`; the aggregator tallies per-task + overall.
- `CancelToken` (tokio CancellationToken): interrupt at checkpoints → delete partial output zip + temp.
- Errors are caught per task; others continue → `JobSummary { succeeded, failed[] }`.
- `EtaEstimator`: computes ETA from a moving-average throughput (per-task and overall).
- The shared progress aggregator and cancellation propagation are the race-prone spots → verified with `loom`.

For domain model details and invariants, see L3 [`/.claude/domain-model.md`](../.claude/domain-model.md).
