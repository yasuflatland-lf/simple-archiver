# Domain Model (L3)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = [`/docs/architecture.md`](../docs/architecture.md) / L3 = this file.
> Details of the `domain` layer (pure, no IO) — the main TDD battleground. The authoritative design lives in Notion.

## Value objects

- `SequenceNumber(NonZeroU32)` — 1-based sequence number.
- `NamingRule { template }` — parses `{n}` / `{n:03}`. `resolve(seq) -> FileStem`. If no placeholder is present, append `_{seq}` to the end.
- `FileStem` / `OutputFileName` — validate OS-forbidden characters and path separators, then append `.zip`.
- `SourceItem` — enum `RarFile(PathBuf)` | `Folder(PathBuf)`.
- `OutputDirectory(PathBuf)` — an existing directory.
- `TaskProgress { bytes_done, bytes_total, phase }`.

## Entities / aggregate

### `ArchiveTask` (entity)

- Fields: `TaskId` / `SourceItem` / resolved `OutputFileName` / `TaskStatus` / `TaskProgress`.
- `TaskStatus`: `Pending` / `Extracting` / `Compressing` / `Completed` / `Failed { reason }` / `Cancelled`.

### `ArchiveJob` (aggregate root)

- Composition: an ordered `Vec<ArchiveTask>` / `NamingRule` / `OutputDirectory`.
- **Invariants**:
  - Order ↔ sequence number (head = 1) always match.
  - Output names are unique within the job.
- Operations:
  - `move_up` / `move_down` — re-derive sequence numbers and output names after reordering.
  - Factory `ArchiveJob::plan(items, rule, out_dir) -> Result<_, PlanError>` — number → resolve names → uniqueness check.

## Naming rule details (`NamingRule`)

- Parsed placeholders: `{n}` (verbatim) / `{n:03}` (zero-padded width).
- For a template without a placeholder, automatically append `_{seq}` to the end.
- Sequence numbers are 1-based, fixed at job-creation time in list order, and **independent of completion order**.
- Reject invalid templates and OS-forbidden characters via validation.
- Cover boundary cases (min/max width, empty template, colliding resolved names, etc.) with unit tests.

## Test focus (domain)

- `NamingRule` resolution (zero-padding, placeholder presence/absence, 1-based).
- `ArchiveJob::plan` numbering, name resolution, and uniqueness check.
- Invariants maintained after `move_up` / `move_down` (order ↔ sequence, name uniqueness).
- The `TaskStatus` state-transition model.
