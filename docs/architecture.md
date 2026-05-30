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
- **`ArchiveJob` is the aggregate root** (PR4): it holds an ordered `Vec<ArchiveTask>` as the single source of truth. The sequence number and resolved output name are *re-derived from list position* on every read — never stored as a second copy. WHY: the aggregate encapsulates the "ordering ↔ sequence ↔ output name" invariant so the PR5 execution engine can trust it without extra synchronisation. `TaskId` is a stable identity separate from position; it never doubles as a sequence number.
- **IO is isolated behind ports** (`Extractor` rar→dir / `Archiver` dir→zip / `Clock`), implementations in `infrastructure`. PR-5a evolved `Archiver` to `trait Archiver: Send + Sync` with `fn compress(&self, src, dest, ctx: &CompressContext) -> impl Future<Output = Result<(), ArchiveError>> + Send` (RPITIT). WHY: the engine drives implementations across `tokio::spawn`, which needs a `Send` future and a `Send + Sync` trait. `Clock` (`fn now(&self) -> Instant`, `Send + Sync`) was added so `elapsed` is testable with a `FixedClock`. `Extractor` keeps the older `#[allow(async_fn_in_trait)]` form until its first parallel caller (rar, PR-5b).
- **Default visibility is `pub(crate)`**; layer boundaries are enforced with clippy. Parser/codegen internals — `Token`, `Lexer`, `LexError`, `Segment`, the generated `template` module, and `parse_segments` — are `pub(crate)` or private. The crate's public surface is limited to validated value objects (`NamingRule`, `SequenceNumber`, `FileStem`, `OutputFileName`) and their error enums. WHY: callers cannot bypass `NamingRule::parse` to build unvalidated `Segment`s, and lexer/grammar changes remain non-breaking.
- **IPC error boundary**: domain errors (`NamingRuleError` / `NameError` / `SequenceError`) cross to the frontend as a `String` via `e.to_string()` at the Tauri command layer. The exact message text is a shared contract pinned by tests on both sides (Rust command test and frontend test assert the same string). WHY: the Tauri command is a thin bridge with Rust as the single source of truth — no validation logic is duplicated in TypeScript. The only naming-related outward touch points are the `preview_output_name` Tauri command (presentation) and the React `NamingRuleForm`.

### Infrastructure adapter invariants

- **`ZipArchiver` walks the full source file list before creating/opening the destination zip.** If the output zip lands inside the source directory, creating it first lets `WalkDir` encounter the partially-written archive and read it back into itself — a corrupt, order/timing-dependent result (a runtime path-skip via `canonicalize` is fail-open when canonicalization fails under load). Walking first, then writing, makes self-inclusion structurally impossible regardless of platform symlinks or filesystem timing.
- **`ZipArchiver` forces durability before returning.** `tokio::fs::File` writes on the blocking pool and its `Drop` does **not** wait for them, so a naive return can hand back an unflushed/locked archive — an order/timing-dependent CI flake. After `async_zip`'s `close()` writes the central directory, recover the file via `.into_inner()`, then `shutdown().await` + `sync_all().await` so the zip is complete and readable immediately. PR-5a also reports per-entry byte progress through the `CompressContext` and **refuses to overwrite** an existing destination (`OpenOptions::create_new(true)` → `AlreadyExists` → `ArchiveError::Io` → the task fails).

## Execution engine (application)

- **`RunArchiveJob` (PR-5a, implemented):** bounded N-way parallelism — `Semaphore(N)` + `tokio::spawn` workers (default `N = available_parallelism`). Workers send immutable messages over an internal mpsc channel to a **single aggregator** that runs on the `execute` task and **owns the `ArchiveJob`** (status) plus the per-task progress projection: single writer / single source of truth → no shared lock. (This supersedes the earlier "shared aggregator" design; the concurrency nucleus is loom-verified in PR-5b.)
- **`ProgressSink` is the only public outbound port.** Workers report cumulative bytes through a `CompressContext` that carries the `TaskId` and a `pub(crate) TaskProgressReport`, so the engine's mpsc channel never leaks onto the public `Archiver` port. The aggregator emits `JobProgress { overall, per_task (job order), elapsed }`.
- **Error isolation + completeness:** one task failing never stops the others; failures are tallied into `JobSummary { succeeded, failed: Vec<(TaskId, String)> }`. The reason is the full `ArchiveError::to_string()` (Display), not the raw backend message. `into_summary` reconciles any task left non-terminal (e.g. a panicked worker) into `failed`, so `succeeded + failed` always equals the task count.
- **Folder-only in PR-5a:** `SourceItem::RarFile` fails its own task with a clear reason; `FormatRegistry` + `Extractor` (rar→temp→Archiver) arrive with rar support.
- **Pending (PR-5b):** cancellation (`CancellationToken` through `CompressContext`) → delete partial output zip + temp, `JobSummary.cancelled`; the `loom` suite; `EtaEstimator` (moving-average throughput); the presentation `ProgressSink`→Tauri adapter and `run_job` / `cancel_job` commands.

For domain model details and invariants, see L3 [`/.claude/domain-model.md`](../.claude/domain-model.md).
