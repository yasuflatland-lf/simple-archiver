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

**Presentation layer wired (PR6).** The execution engine is connected end-to-end: Tauri commands mutate a backend-held session draft, drive the application engine, and stream progress events to the frontend. Domain / application / infrastructure and the presentation adapter are all implemented. Treat this document as the live architecture description.

**Frontend**: the design-system foundation is in place (ASICS tokens, light/dark theme, Inter typography, Button/Input/Label primitives, ThemeProvider). The main screen, card layout, draft list, per-file progress, job summary, and failed-task list are deferred to a later cycle, now that the backend DTOs have landed.

## Layered / hexagonal structure

The Rust backend is split across a **Cargo workspace** with two crates: a pure `simple-archiver-core` crate holding `domain` / `application` / `infrastructure`, and the `src-tauri` crate holding `presentation`.

```
presentation   src-tauri/src/presentation/ — Tauri commands, session state, DTO/event wiring
               commands.rs  — six granular Tauri commands + run_job_inner testability seam
               state.rs     — JobDraft (mutable session draft) + RunState (single-active-job guard) + AppState (Tauri managed state)
               dto.rs       — wire-contract DTOs with serde + ts-rs bindings (ProgressEvent, DraftSnapshot, JobSummaryDto, …)
               events.rs    — ProgressEmitter trait seam + TauriEmitter (production) + RecordingEmitter (test double)
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
- **Error isolation + completeness:** one task failing never stops the others; failures are tallied into `JobSummary { succeeded, cancelled: Vec<TaskId>, failed: Vec<(TaskId, String)> }`. The reason is the full `ArchiveError::to_string()` (Display), not the raw backend message. `into_summary` reconciles any task left non-terminal (e.g. a panicked worker) into `failed`, so `succeeded + cancelled + failed` always equals the task count. **The summary is state-derived, not message-derived:** it iterates `job.tasks()` and classifies each task's *final* `TaskStatus` (disjoint + total — every task classified exactly once), which is precisely what makes the engine's `let _ = tx.send(…)` drops safe: a lost or out-of-order worker message can never drop a task from the tally. Latent constraint: if the summary were ever recomputed from the message *stream* instead of job state, those ignored sends would become lost-terminal-event bugs.
- **Folder-only in PR-5a:** `SourceItem::RarFile` fails its own task with a clear reason; `FormatRegistry` + `Extractor` (rar→temp→Archiver) arrive with rar support.
- **PR-5b (implemented):** cancellation via `CancellationToken` threaded through `CompressContext` — not-started checkpoint (cancel before compress → task ends `Cancelled`, archiver never called) + per-zip-entry checkpoint in `ZipArchiver::compress` (drops the writer, best-effort-deletes the partial `dest_zip`, returns `ArchiveError::Cancelled`); `JobSummary.cancelled` tallies cancelled tasks. A loom verification suite (`application/loom_nucleus.rs`, gated `#[cfg(loom)]`) drives the real `Aggregator`/`WorkerMsg`/`ArchiveJob` under loom primitives: three concurrent loom-thread workers send terminal/progress messages over a loom mpsc channel into the single-writer aggregator. Under every loom interleaving it verifies that no message is lost and the summary partitions every task into exactly one of succeeded/cancelled/failed — this checks the **concurrency model** (single-writer aggregation), NOT the tokio runtime, and NOT `CancellationToken` propagation (that signal path is covered by the regular tokio cancel-path tests). Note: loom 0.7 models message count, not sender-drop/channel closure, so the production worker→channel-close→drain ordering is covered by the regular tokio tests, not loom.
- **Pending:** `EtaEstimator` (moving-average throughput).

## Presentation layer — design-system foundation

The frontend uses a **two-layer design-token system** in `src/App.css`:

- **Primitive layer** — ASICS raw hex values declared in `:root` (e.g. `--asics-ink: #0a1f4f`, `--asics-brand-red: #e60012`). Dark primitives (charcoal palette, navy lift) are invented since ASICS has no official dark spec.
- **Semantic layer** — the shadcn contract variables (`--primary`, `--background`, `--destructive`, …) are wired to the primitives. Tailwind v4 utilities (`bg-primary`, `text-foreground`, etc.) are exposed via `@theme inline { --color-*: var(--*) }`.

**Dark mode** is class-driven: `.dark` on `<html>` overrides only the semantic layer. `@custom-variant dark (&:is(.dark *))` replaces Tailwind v4's default media-query dark variant so the theme is user-controlled. `ThemeProvider` (`src/components/theme-provider.tsx`) toggles the class, persists the choice to `localStorage` under the key `simple-archiver-theme`, and follows the OS via a `matchMedia change` listener only while the theme is set to `"system"`. Persisted values are validated through a type guard (`isTheme`) before use — unrecognised strings fall back to the default rather than being cast blindly.

**Color discipline:** navy (`--asics-ink`) is `--primary`; red `#e60012` is reserved for the single `--brand` CTA (`Button variant="brand"`), `--destructive`, and error badges — not a general accent.

**shadcn/ui (new-york)** primitives live in `src/components/ui/`. Keep them faithful to upstream templates; the `cn` helper (`clsx` + `tailwind-merge`) is used throughout, so later utility classes win conflicts (e.g. a variant's `rounded-full` overrides the base `rounded-md`). The `@/` path alias resolves to `src/` (tsconfig `paths` + vite `resolve.alias`).

For domain model details and invariants, see L3 [`/.claude/domain-model.md`](../.claude/domain-model.md).

## Presentation layer — wiring the engine to the UI (PR6)

The four modules in `src-tauri/src/presentation/` form the adapter between the application engine and the Tauri frontend.

### Backend-held session state (single source of truth = Rust)

`JobDraft` (in `state.rs`) accumulates the user's pending job configuration inside `AppState`, which is registered with `tauri::Builder::manage`. The four mutation commands (`add_items` / `reorder` / `set_naming_rule` / `set_output_dir`) each mutate the draft and return a `DraftSnapshot` so the frontend reflects the current state. `run_job` calls `JobDraft::build` (which calls `ArchiveJob::plan`) and hands the planned job to the engine. WHY: Rust is the single source of truth — no job state is duplicated in the TypeScript layer, so the frontend never needs to sync with the backend between commands.

### Single-active-job invariant

`RunState` (in `state.rs`) holds at most one `CancellationToken`. Its public API is intentionally narrow: `try_start` claims the slot and rejects a second concurrent job with the IPC-contract message `"a job is already running"`; `request_cancel` signals the token; `finish` is the sole way to clear the slot. The slot is freed on every exit path (normal completion, error, or drop) because `run_job` calls `finish` in a deferred cleanup path — the invariant is owned by the type, not by the caller.

### Progress event transport

Progress snapshots flow from the application engine to the frontend via Tauri global events on the channel `archive://progress` (constant `PROGRESS_EVENT` in `dto.rs`). The `run_job` command's awaited return value — a `JobSummaryDto` — IS the completion signal; there is no separate "done" event. Missed progress ticks (e.g. a failed `app.emit`) are silently discarded: a dropped tick must never abort a running job.

### DTO boundary preserves layer purity

Wire-contract types (`ProgressEvent`, `ProgressCounts`, `TaskProgressDto`, `DraftSnapshot`, `JobSummaryDto`, etc.) are authored exclusively in `dto.rs` (presentation). `domain` and `application` carry no `serde` or `ts-rs` derives. Application types (`JobProgress` / `JobSummary`) are mapped to DTOs via `From` impls inside presentation. WHY: this is a concrete realization of the `presentation → application → domain` dependency rule — the wire shape can evolve without touching the core model, and the core stays independently testable.

### Testability seam at the IPC boundary

`ProgressEmitter` (in `events.rs`) is a `trait` over `emit_progress`. Production code uses `TauriEmitter` (wrapping `AppHandle`); integration tests use a `RecordingEmitter` double. The engine entry point is extracted into `run_job_inner(emitter: &dyn ProgressEmitter, …)` in `commands.rs`, which can be called in tests without a live Tauri application. Path classification (directory → `Folder`, `.rar` extension → `RarFile`) is a free function in `commands.rs` because it is IO, keeping `JobDraft` pure and independently unit-testable.
