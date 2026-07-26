# Domain Model (L3)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = [`/docs/architecture.md`](../docs/architecture.md) / L3 = this file.
> Details of the `domain` layer (pure, no IO) — the main TDD battleground. The authoritative design lives in Notion.

## Value objects

- `SequenceNumber(u32)` — every `u32` is valid, including `0`, so `ArchiveJob::plan_with_start` can number a batch from an arbitrary start.
- `NamingRule { template }` — parses the template into a segment list; see "Naming rule details" below.
- `FileStem` / `OutputFileName` — enforce Windows-superset filename validity (see "FileStem / OutputFileName" below). `OutputFileName::from_stem` appends `.zip`.
- `SourceItem` — enum `RarFile(PathBuf)` | `ZipFile(PathBuf)` | `Folder(PathBuf)`, constructed via `SourceItem::classify(path, is_dir) -> Result<Self, UnsupportedSourceItem>` (the single source of truth for the classification rule). Classification order:
  1. `is_dir == true` → `Folder` (takes precedence over extension; a directory literally named `archive.zip` or `archive.rar` is still a `Folder`).
  2. Extension matched case-insensitively (`eq_ignore_ascii_case`): `"rar"` → `RarFile`, `"zip"` → `ZipFile`.
  3. Anything else (including a non-UTF-8 extension, which cannot match any format) → `Err(UnsupportedSourceItem)`.

  "unsupported" is an **error, not a variant** — a constructed `SourceItem` is always one of the three valid kinds. `is_dir` is injected by the caller so the domain never touches the filesystem.

  **Application-layer collapse.** Both archive variants flow through the SAME pipeline (extract → rename → recompress to Deflate zip). `FormatRegistry::prepare` collapses them: `RarFile(p) | ZipFile(p) ⇒ Prepared::Extracted` (via the `Extractor` port); `Folder(p) ⇒ Prepared::Folder`. The distinction between the two archive kinds is invisible to the engine beyond this point.

  **Presentation `SourceKind` mirror.** The presentation-layer enum `SourceKind { Folder, Rar, Zip }` mirrors `SourceItem` one-for-one. The two are kept in sync solely by the exhaustive `draft_item_from_source` match (compile-time) and the ts-rs binding-export test (`export_typescript_bindings` in `dto.rs`). **Invariant to uphold when adding a format:** add the new variant to BOTH `SourceItem` AND `SourceKind`, update the `draft_item_from_source` match (the compiler enforces exhaustiveness), and re-run the binding-export test to regenerate the TypeScript declaration.

  **`ExtractError::Backend` display string.** `ExtractError::Backend` displays as the archive-neutral `"extract error: {0}"` (was rar-specific in earlier iterations). This string crosses the IPC boundary and is pinned by `extract_error_display_strings_are_stable` in `ports.rs` — do not change it without updating that test.
- `OutputDirectory(PathBuf)` — a newtype wrapper for the output directory path. In the pure `domain` layer it performs **no filesystem-existence check**; that IO validation is deferred to the infrastructure layer (a later PR).
- `TaskProgress { bytes_done: u64, bytes_total: u64 }` — progress counters only. There is no `phase` field: the current phase is already represented by `TaskStatus` (`Extracting` / `Compressing`), so `TaskProgress` is purely a pair of byte counters. **`bytes_done <= bytes_total` invariant:** `TaskProgress::new` enforces it via `debug_assert!` (loud in dev/CI) plus a release-build clamp (`bytes_done.min(bytes_total)`) — never a fallible constructor, because the only callers are internal progress callbacks with no recovery path (see conventions.md "debug_assert + release clamp for caller-bug invariants"). **`remaining()` invariant (PR9):** `remaining() = bytes_total.saturating_sub(bytes_done)`, never negative. ETA is typed `Option<Duration>` at the application layer — `None` while throughput is not yet measurable, `Some(ZERO)` when `remaining() == 0`; only `TaskProgress::remaining()` is a domain addition. The `EtaEstimator`/`EtaTracker` that compute ETA live in the **application** layer, not domain (see `architecture.md` "Execution engine").

## Output mode and conflict policy

- `OutputMode { Zip, Folder }` defaults to `Zip`: `Zip` produces a renamed `.zip` per item, while `Folder` extracts archive inputs into source-named output directories. WHY: the mode selects different planning, destination, and execution rules for the whole batch.
- `ConflictPolicy { AutoRename, Skip, Overwrite }` defaults to `AutoRename` and applies in both modes: `AutoRename` writes a free `name (2)` sibling and succeeds, `Skip` leaves the existing output unchanged and currently reports a successful no-op, and `Overwrite` removes the existing output before writing. WHY: the policy makes every destination collision an explicit job-level choice.

### Output rulings (target, not yet implemented)

**DECISIONS NOT YET IMPLEMENTED:** these 2026-07-26 rulings describe target behaviour; implementation is assigned to [dm M5] (#243) through [dm M8] (#246).

- **R1** A skip is not a success. It is its own terminal outcome, presented as "no change". Target issue: [dm M7] (#245).
- **R2** The completion view shows the name that was actually produced (`foo (2).zip`), not the name that was wanted. Target issue: [dm M6] (#244).
- **R3** A folder source in Folder mode is an explicit skip, not a silent success. Target issue: [dm M7] (#245).
- **R4** Two inputs whose names collide on the filesystem are rejected at plan time. Target issue: [dm M5] (#243).
- **R5** In Folder mode an invalid source name fails only that one task, not the batch. Target issue: [dm M5] (#243).

## Entities / aggregate

### `ArchiveTask` (entity)

- Fields: `TaskId` / `SourceItem` / resolved `OutputFileName` / `TaskStatus`. (Live byte progress is **not** an entity field — it is owned by the application-layer aggregator's `HashMap<TaskId, TaskProgress>` as the single source of truth; see `architecture.md` "Execution engine".)
- `ArchiveTask::output_destination(out_dir, mode)` is the single source of truth for the pure per-task destination formula: Zip mode is `out_dir.join(output_name)`, while Folder mode is `out_dir.join(source.output_stem())`. WHY: the engine and presentation summary cannot drift on where a task is intended to land.
- **`TaskStatus` state machine:** source-agnostic, forward-only; terminal states (`Completed` / `Failed` / `Cancelled`) are irreversible. Normal path: `Pending → Extracting → Compressing → Completed`. Folder fast-path: `Pending → Compressing → Completed` (no extraction needed; the engine picks the first event, the machine doesn't inspect the source type). Error/cancel transitions: any non-terminal state → `Failed` or `Cancelled`. Modelled as `apply(self, Event) -> Result<Self, IllegalTransition>` — see conventions.md "State-machine convention" (the `&mut self` driver `apply_event` uses the `std::mem::replace` hot-path variant to skip the happy-path clone).
- `TaskStatus` variants: `Pending` / `Extracting` / `Compressing` / `Completed` / `Failed { reason }` / `Cancelled`.
- **`TaskId(u32)` vs `SequenceNumber` (identity vs position):** `TaskId` is a stable 1-based task identity assigned once at plan time (`TaskId(i + 1)` for item at index `i`) and is never re-derived or changed by reordering. In Zip mode, `SequenceNumber` is `start + position`, is **derived and never stored**, and changes when tasks are reordered via `move_up` / `move_down`; `start` may be `0`. Output names are bound to the sequence/position (not to the `TaskId`), so reordering rebinds names while preserving `TaskId` and `TaskStatus`.

### `ArchiveJob` (aggregate root)

- Composition: an ordered `Vec<ArchiveTask>` / `NamingRule` / `OutputDirectory` / `OutputMode` / `ConflictPolicy`.
- **Full value type**: derives `PartialEq + Eq` (possible because `NamingRule` and all constituent types are `Eq`-capable).
- **Invariants**:
  - In Zip mode, order ↔ sequence number (head = `start`) always match; `plan` is the special case `start = 1`.
  - Output names are unique within the job, checked **case-insensitively** via ASCII case-fold (`to_ascii_lowercase`): names differing only in ASCII case (e.g. `A.zip` / `a.zip`) are rejected, because a case-insensitive filesystem (Windows / default macOS) would otherwise silently overwrite a prior output. **Known limitation:** `check_unique` does not apply the target filesystem's Unicode normalisation or full case-folding. Verified on APFS: `ガイド.zip` in NFC and NFD are the same file, while `to_ascii_lowercase` does not fold them, so both inputs can pass `check_unique`; [dm M5] (#243) replaces this with filesystem-aware uniqueness.
- Operations:
  - `move_up` / `move_down` — re-derive sequence numbers and output names after reordering.
  - `ArchiveJob::plan(items, rule, out_dir)` is the Zip-mode convenience factory for `ArchiveJob::plan_with_start` with `start = 1` and default `ConflictPolicy::AutoRename`.
  - `ArchiveJob::plan_with_start(items, rule, out_dir, start, policy)` numbers Zip-mode names from any `u32` start, rejects a range past `u32::MAX`, resolves names, and checks uniqueness. WHY: consecutive batches can continue numbering without changing stable 1-based `TaskId` values.
  - `ArchiveJob::plan_extract(items, out_dir, policy)` plans Folder mode without a naming rule: destinations derive from `SourceItem::output_stem`, and invalid or duplicate source-derived names fail planning. WHY: source filenames, rather than injected sequence numbers, determine Folder-mode collisions.
- **Name-invariance under reordering (Zip mode only):** names produced by `plan` / `plan_with_start` are position-derived and number rendering is injective, so the SET `{resolve(rule, k) : k ∈ {start, …, start + N - 1}}` is **invariant under reordering** — a reorder only permutes which task holds which name. Consequences: (1) reorder can never introduce a new name-resolution failure or collision; (2) `move_up` / `move_down` only re-bind each position's already-validated name and **cannot fail on naming** — the only error is `TaskNotFound`; (3) the `check_unique` call is therefore defensive for these Zip-mode factories. In Folder mode, `plan_extract` derives names from source filenames, where collisions are routine (`foo.rar` and `foo.zip` both want `foo`); its `check_unique` call is **load-bearing**.

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

- Any `u32` is valid, including `0`.
- Fixed at job-creation time as `start + position` in list order, **independent of completion order**; `plan` supplies `start = 1`, while `plan_with_start` accepts an arbitrary start and rejects an overflowing range.

## FileStem / OutputFileName

Windows-superset validity rules (applied identically on all platforms):

- **Forbidden characters**: `< > : " / \ | ? *` and control characters `U+0000..=U+001F`.
- **Path separators** (`/` and `\`) are members of the shared `is_forbidden_filename_char` set and are reported as `ForbiddenChar`. There is **no separate `NameError::PathSeparator` variant** — the design listed one, but the implementation folds them into `ForbiddenChar`. The model and code agree on this point; the Notion design should be updated accordingly.
- **Trailing dot or space** — rejected.
- **Reserved device names** — checked case-insensitively against the **whole stem**: `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`. The check is intentionally whole-stem only. `CON` is rejected (which prevents `CON.zip`), but `CON.bak` used as a stem is **not** rejected (the `.bak` makes it a different stem). Do not extend this check to dotted forms.
- **Empty stem** — rejected.

## Test focus (domain)

- `NamingRule` resolution: zero-padding, plain placeholder, no-placeholder auto-append, and arbitrary sequence values including `0`.
- Width boundary cases: min (1), max (9), out-of-range, overflowing `u32`, non-truncation beyond width.
- `{n:3}` (missing leading zero) rejected as malformed brace.
- `resolve` re-validation: reserved names and trailing dot/space that emerge post-substitution.
- `SequenceNumber` construction: `0` accepted, `u32::MAX` accepted.
- `FileStem` / `OutputFileName`: forbidden chars, control chars, trailing dot/space, reserved names (whole-stem, case-insensitive), empty stem.
- `ArchiveJob::plan` / `ArchiveJob::plan_with_start` numbering, name resolution, overflow, and uniqueness; `ArchiveJob::plan_extract` source-name validation and collisions.
- Invariants maintained after `move_up` / `move_down` (order ↔ sequence, name uniqueness).
- The `TaskStatus` state-transition model.
- `SourceItem::classify`: zip case-insensitive match, `is_dir` precedence over `.zip`/`.rar` extension, unsupported extensions, missing extension, non-UTF-8 extension → `UnsupportedSourceItem`.
