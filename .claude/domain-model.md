# Domain Model (L3)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = [`/docs/architecture.md`](../docs/architecture.md) / L3 = this file.
> Details of the `domain` layer (pure, no IO) — the main TDD battleground. The authoritative design lives in Notion.

## Value objects

- `SequenceNumber(NonZeroU32)` — 1-based; `0` is rejected at construction (`SequenceError::Zero`).
- `NamingRule { template }` — parses the template into a segment list; see "Naming rule details" below.
- `FileStem` / `OutputFileName` — enforce Windows-superset filename validity (see "FileStem / OutputFileName" below). `OutputFileName::from_stem` appends `.zip`.
- `SourceItem` — enum `RarFile(PathBuf)` | `Folder(PathBuf)`.
- `OutputDirectory(PathBuf)` — a newtype wrapper for the output directory path. In the pure `domain` layer it performs **no filesystem-existence check**; that IO validation is deferred to the infrastructure layer (a later PR).
- `TaskProgress { bytes_done: u64, bytes_total: u64 }` — progress counters only. There is no `phase` field: the current phase is already represented by `TaskStatus` (`Extracting` / `Compressing`), so `TaskProgress` is purely a pair of byte counters.

## Entities / aggregate

### `ArchiveTask` (entity)

- Fields: `TaskId` / `SourceItem` / resolved `OutputFileName` / `TaskStatus` / `TaskProgress`.
- `TaskStatus`: `Pending` / `Extracting` / `Compressing` / `Completed` / `Failed { reason }` / `Cancelled`.
- **`TaskId(u32)` vs `SequenceNumber` (identity vs position):** `TaskId` is a stable task identity assigned once at plan time (`TaskId(i + 1)` for item at index `i`) and is never re-derived or changed by reordering. `SequenceNumber` is the 1-based position in the job's ordering (`position + 1`), is **derived and never stored**, and changes when tasks are reordered via `move_up` / `move_down`. Output names are bound to the sequence/position (not to the `TaskId`), so reordering rebinds names while preserving `TaskId`, `TaskStatus`, and `TaskProgress`.

### `ArchiveJob` (aggregate root)

- Composition: an ordered `Vec<ArchiveTask>` / `NamingRule` / `OutputDirectory`.
- **Invariants**:
  - Order ↔ sequence number (head = 1) always match.
  - Output names are unique within the job.
- Operations:
  - `move_up` / `move_down` — re-derive sequence numbers and output names after reordering.
  - Factory `ArchiveJob::plan(items, rule, out_dir) -> Result<_, PlanError>` — number → resolve names → uniqueness check.

## Naming rule details (`NamingRule`)

### Template grammar

- `{n}` — plain (no padding).
- `{n:0W}` — zero-padded to width `W`. The leading `0` character is **required**; `{n:3}` (no leading zero) is rejected as a malformed-brace error.
- `{{` / `}}` escape sequences are **not supported** — literal braces in filenames are forbidden on Windows anyway.

### No-placeholder normalisation

When the template contains no placeholder, `_{n}` is automatically appended and normalised into the segment list. `resolve` therefore has a single code path regardless of whether the user supplied a placeholder.

### Segment encoding

`Segment::Placeholder { pad_width: Option<u32> }` is the chosen encoding:
- `None` → plain (`{n}`).
- `Some(w)` → zero-padded to width `w`.

(The design originally proposed `width: u8` with `0 = plain`; the `Option<u32>` encoding was chosen instead and is the authoritative representation.)

### Padding width invariants

- Valid range: `1..=9`.
- Width values outside that range — including values that overflow `u32` — surface as `NamingRuleError::WidthOutOfRange`. The lexer saturates an overflowing width to `u32::MAX` so it reaches the range-check rather than being misclassified as a malformed-brace error.
- Padding **never truncates**: if the rendered sequence value has more digits than the width, all digits are kept (e.g. `{n:03}` at sequence 1000 → `"1000"`).

### `resolve` signature and re-validation

```
fn resolve(&self, seq: SequenceNumber) -> Result<OutputFileName, NameError>
```

After the sequence number is substituted into the template, the assembled string is **re-validated** through `FileStem::new`. This catches trailing dots/spaces and reserved device names that only emerge after substitution (e.g. a template `CO` with `_{n}` suffix could still not produce a reserved name, but explicit templates can). Errors from this second validation surface as `NameError` variants.

### Sequence number properties

- 1-based, fixed at job-creation time in list order, **independent of completion order**.
- Backed by `NonZeroU32`; construction with `0` returns `SequenceError::Zero`.

## FileStem / OutputFileName

Windows-superset validity rules (applied identically on all platforms):

- **Forbidden characters**: `< > : " / \ | ? *` and control characters `U+0000..=U+001F`.
- **Path separators** (`/` and `\`) are members of the shared `is_forbidden_filename_char` set and are reported as `ForbiddenChar`. There is **no separate `NameError::PathSeparator` variant** — the design listed one, but the implementation folds them into `ForbiddenChar`. The model and code agree on this point; the Notion design should be updated accordingly.
- **Trailing dot or space** — rejected.
- **Reserved device names** — checked case-insensitively against the **whole stem**: `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`. The check is intentionally whole-stem only. `CON` is rejected (which prevents `CON.zip`), but `CON.bak` used as a stem is **not** rejected (the `.bak` makes it a different stem). Do not extend this check to dotted forms.
- **Empty stem** — rejected.

## Test focus (domain)

- `NamingRule` resolution: zero-padding, plain placeholder, no-placeholder auto-append, 1-based sequence.
- Width boundary cases: min (1), max (9), out-of-range, overflowing `u32`, non-truncation beyond width.
- `{n:3}` (missing leading zero) rejected as malformed brace.
- `resolve` re-validation: reserved names and trailing dot/space that emerge post-substitution.
- `SequenceNumber` construction: `0` rejected, `NonZeroU32::MIN` accepted.
- `FileStem` / `OutputFileName`: forbidden chars, control chars, trailing dot/space, reserved names (whole-stem, case-insensitive), empty stem.
- `ArchiveJob::plan` numbering, name resolution, and uniqueness check.
- Invariants maintained after `move_up` / `move_down` (order ↔ sequence, name uniqueness).
- The `TaskStatus` state-transition model.
