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

**Design finalized, implementation not started.** The repo holds only `README.md` / `LICENSE` / `.gitignore` plus this documentation; no scaffold (Tauri/Rust/frontend) exists yet. The first task is PR1 (project scaffold + CI). Treat the structure and commands here as the target state after scaffolding.

## Layered / hexagonal structure

The Rust backend splits a single binary crate into four modules. A multi-crate workspace is **rejected** as overkill at this scale.

```
presentation   Tauri commands + events
               add_items / reorder / set_naming_rule / set_output_dir / run_job / cancel_job → emit progress
application    use case / orchestration
               RunArchiveJob: N parallel workers, progress aggregation, cancellation, error tally / ports: Extractor, Archiver, Clock
domain         pure, no IO (the main TDD battleground)
               ArchiveJob (aggregate root) / ArchiveTask / NamingRule / SequenceNumber / SourceItem / OutputDirectory
infrastructure isolates the variation / adapters
               ZipArchiver(async_zip) / UnrarExtractor(unrar) / TempWorkspace / SystemClock
```

## Layer boundary discipline (strict)

- **Dependency direction**: `presentation → application → domain`, `infrastructure → domain`. `domain` depends on no other layer.
- **`domain` is pure**: no IO, async, or external-crate dependencies. All file/process/clock access goes through ports.
- **IO is isolated behind ports**: `Extractor` (rar→dir) / `Archiver` (dir→zip) / `Clock`, with implementations in `infrastructure`.
- Default visibility is `pub(crate)`; layer boundaries are enforced with clippy.

## Execution engine (application)

- `FormatRegistry`: `Folder` → Archiver only / `RarFile` → Extractor (→temp) then Archiver.
- `RunArchiveJob`: up to N parallel via tokio (default = `available_parallelism`). Each task reports byte progress through a `ProgressSink`; the aggregator tallies per-task + overall.
- `CancelToken` (tokio CancellationToken): interrupt at checkpoints → delete partial output zip + temp.
- Errors are caught per task; others continue → `JobSummary { succeeded, failed[] }`.
- `EtaEstimator`: computes ETA from a moving-average throughput (per-task and overall).
- The shared progress aggregator and cancellation propagation are the race-prone spots → verified with `loom`.

For domain model details and invariants, see L3 [`/.claude/domain-model.md`](../.claude/domain-model.md).
