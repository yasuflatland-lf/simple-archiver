# Coding Conventions (L3)

> Doc layers: L1 = [`/CLAUDE.md`](../CLAUDE.md) / L2 = [`/docs/`](../docs/) / L3 = this file.
> Deep reference — consult when starting a task.

## All comments in English (mandatory)

This repository requires **all in-code comments to be written in English**.

**Scope**:
- line and block comments (Rust `//` `/* */`, TS/JS `//` `/* */`)
- doc comments (Rust `///` `//!`, TSDoc/JSDoc `/** */`)
- comments inside test code, and `TODO` / `FIXME` / `NOTE` annotations

**Why**:
- This is an OSS project (MIT) intended for publication; comments must not assume Japanese-only readers.
- Keep generated API docs (rustdoc / TSDoc) consistent in English.
- Align with toolchain/library conventions and keep diffs free of mixed languages during review.

**How to apply**:
- Write new comments in English. When you touch an existing non-English comment, convert it to English.
- Put design discussion in PR descriptions or the L2/L3 docs, not in code comments.
- Name identifiers (types, functions, variables) in English.
- All written repository artifacts are in English: code, comments, and the docs (`CLAUDE.md` / `docs/` / `.claude/`), as well as commit messages. (Live conversation with the user follows the user's language preference and is out of scope for this rule.)

## Naming / style

- Rust: `rustfmt`-compliant. Types `UpperCamelCase`, functions/variables `snake_case`, constants `SCREAMING_SNAKE_CASE`.
- TypeScript / JS / JSON: linted by **oxlint** (v1.67.0) and formatted by **oxfmt** (v0.52.0). Run `pnpm check` (format + lint, with autofix) before committing; CI enforces it via `pnpm fmt:check` + `pnpm lint:ci`. oxfmt owns style (2-space indent, double quotes, semicolons) and import sorting (via oxfmt `sortImports`); `tsc` still owns type-checking and `knip` owns unused-code detection.
  - **`react/button-has-type` is enforced.** Every raw `<button>` element — including in tests — must carry an explicit `type` attribute (e.g. `type="button"`). This rule is enabled as `error` in `.oxlintrc.json` (react plugin) and is caught automatically on `pnpm check`.
  - **oxlint category vs. explicit rule (harness):** `categories.correctness: "error"` in `.oxlintrc.json` enables only the *correctness* category — it does NOT activate rules from other categories. Rules from other categories (`react/no-array-index-key` = perf, `react/button-has-type` = react) are enforced only because they are listed explicitly under `rules`. To enforce any specific oxlint rule, add it explicitly to `rules`; do not assume a category toggle covers it.
- Match the surrounding code's comment density, naming, and idioms. Do not introduce a new style.
- **`#[derive(Clone)]` over-constrains a generic that only holds `Arc<E>` — hand-write the impl instead.**
  - **Why:** `#[derive(Clone)]` on `struct Foo<E> { x: Arc<E> }` generates `impl<E: Clone> Clone for Foo<E>` — it requires `E: Clone` even though cloning an `Arc<E>` only bumps a refcount and never clones `E`. For a generic bounded by a non-`Clone` trait (e.g. `E: Extractor`), the derive makes `Foo<E>` un-cloneable for real implementors even though the operation is perfectly sound.
  - **What:** hand-write the impl so `Clone` holds for ALL `E`, independent of `E: Clone`:
    ```rust
    impl<E: Extractor> Clone for FormatRegistry<E> {
        fn clone(&self) -> Self {
            Self { extractor: Arc::clone(&self.extractor) }
        }
    }
    ```
    PR8's `FormatRegistry<E: Extractor>` hit exactly this — the engine clones the registry into each worker, and `UnrarExtractor` is not `Clone`. The derive looks correct and compiles in isolation but fails the moment a non-`Clone` `E` is substituted.

## Layer boundary discipline (implementation level)

- Default visibility is `pub(crate)`; keep cross-layer exposure minimal.
- Do not import `std::fs` / `tokio` / `async` / external IO crates into the `domain` module (keep it pure at compile time).
- **When the domain needs a filesystem FACT to make a decision, inject it as a plain parameter** rather than probing inside the domain — the presentation layer performs the probe and passes the result (e.g. `SourceItem::classify(path, is_dir: bool)`, where presentation supplies `path.is_dir()`). This keeps the domain pure for simple boolean facts without standing up a full `Extractor` / `Archiver` / `Clock` port.
- All IO goes through the `Extractor` / `Archiver` / `Clock` ports; confine concrete implementations to `infrastructure`.
- Reject imports that violate the dependency direction (presentation → application → domain, infrastructure → domain) in clippy / review.
- **A context/port object handed to an adapter must expose the narrowest read-only surface that adapter needs — never the underlying capability.** `CompressContext` (passed to the `Archiver` port) exposes a read-only `is_cancelled()` predicate, never the raw `CancellationToken`: returning `&CancellationToken` would leak `.cancel()` (it takes `&self`) to an archiver that must only *observe* the signal, letting one task tear down the whole job. Hand out the observation, not the control.
- **An output port may return an OWNED RAII guard to carry cleanup across the layer boundary.**
  - **Why:** the application layer must hold an extracted directory whose temporary storage is reclaimed when it is done, WITHOUT naming any infrastructure type (that would violate the `application → infrastructure` non-dependency rule).
  - **What:** an output port can return an owned guard as a boxed trait object — `Box<dyn ExtractedTree>` from `Extractor::extract` — where the concrete implementor (`infrastructure::TempWorkspace`) owns a `tempfile::TempDir` and reclaims it in `Drop`. The trait exposes the narrowest surface (`fn path(&self) -> &Path` only — never the underlying `TempDir`, so the application cannot call `keep()`/`close()` on it). The application holds the guard (wrapped in `application::format_registry::Prepared`) across the consuming step (compression) and drops it at end of scope, so temp cleanup is STRUCTURAL — guaranteed on success, error return, and unwind — not a manual call that a panic or early return could skip. This is the resource-cleanup analogue of the `CompressContext` and presentation `ProgressEmitter` narrow-surface rules: the port hands out an owned cleanup guarantee, not the raw capability.

### Aggregate encapsulation seam

Entity fields are private; only the aggregate root constructs/mutates entities via `pub(crate)` constructors and mutators (e.g. `ArchiveTask::new` / `set_output_name` / `apply_event`, `TaskId::new` are `pub(crate)`; external code obtains a `TaskId` only via `id()`). **Why:** the "names bound to position, `TaskId` stable" invariant is then structurally enforceable — external code cannot fabricate ids, build entities out of band, or reorder the private `Vec`.

## Value-object equality

Derive **both `PartialEq` and `Eq`** on value objects whenever all fields are `Eq`-capable (not just `PartialEq`). **Why:** it's an honest value-equality contract, enables use as map/set keys, and avoids artificially blocking `Eq` up the whole aggregate. (PR3's `NamingRule` / `Segment` derived only `PartialEq` despite `Eq`-capable fields, which cascaded into blocking `Eq` on `ArchiveJob` until fixed in PR4.)

## State-machine convention

Model lifecycle as `apply(self, Event) -> Result<Self, IllegalTransition>` that **consumes `self`**, with a single exhaustive `match`. The catch-all arm must return a typed `IllegalTransition` error — never a silent no-op. At a mutation call site, use clone-before-apply so an illegal transition leaves state unchanged:

```rust
self.status = self.status.clone().apply(event)?;
```

**Hot-path variant — `std::mem::replace` to avoid the happy-path clone.** When the `&mut self` mutator runs in a hot loop and `apply` consumes the current state, take the state out with a cheap placeholder instead of cloning every call:

```rust
let prev = std::mem::replace(&mut self.status, TaskStatus::Pending); // cheap placeholder
match prev.clone().apply(event) {
    Ok(next) => self.status = next,                 // happy path: no clone of prev kept
    Err(e) => { self.status = prev; return Err(e); } // restore on illegal transition
}
```

Only the error/restore path pays for a clone; the happy path moves. **Contract — the placeholder must never leak:** every `match` arm overwrites `self.status` before returning, so a caller can never observe the placeholder. **Harness:** lock the contract with a test that drives the mutator from a NON-placeholder state through a legal transition and asserts the concrete next state — a leaked placeholder then fails the assertion loudly.

## Error handling

- Use a per-task `Result`; catch failures and never stop other tasks from running.
- Treat name collisions as a **failure, not an overwrite**.
- Always clean up temp; on failure/cancellation, delete the partial output zip.
- Do not swallow errors (no silent failures). Always surface them in logs / the summary.
- **No-silent-failure, interim form (no logging facade yet).** The project has no `tracing`/`log` crate wired up, so until a logging-infrastructure PR lands, honor the rule minimally and consistently: (1) `debug_assert!` on "cannot-happen given engine ordering" invariant violations — loud in debug/test/loom, a no-op `continue` in release where the state-derived summary reconciles the task to `failed` (see the aggregator `apply` site in `run_archive_job`); (2) explicitly match and ignore *expected* error kinds (e.g. `ErrorKind::NotFound` on best-effort cleanup) while swallowing the rest *with a comment*; (3) mark each deferred-logging site in a comment so a `logError` + error-id slots in once logging exists. This is interim policy, not the end state.
- **`debug_assert` + release clamp for caller-bug invariants.** For a pure-domain value object whose invalid input is provably a *caller* bug (not a user-facing error) — its only callers are internal code with no meaningful recovery path — prefer `debug_assert!(invariant)` (loud in dev/CI) plus a release-build clamp to a sound value over a `Result`-returning constructor. **Why:** in a shipping desktop app, clamping to keep a derived quantity sound (e.g. a progress ratio / ETA) beats panicking in release, while the dev/CI assertion still catches the real upstream bug loudly. This is the value-object analogue of the aggregator's `debug_assert` + no-op `continue` above — same no-silent-failure stance, applied at construction. Canonical: `TaskProgress::new` asserts `bytes_done <= bytes_total` then clamps `bytes_done.min(bytes_total)`. Reserve a fallible constructor for invariants that *user* input can violate. (Test both paths — see `docs/development.md` testing policy on `cargo nextest run --release`.)
- **No silent numeric casts: prefer `try_from` over `as` for narrowing.** Do not use a silent `as` downcast for a narrowing integer conversion — it truncates without warning. Use `u32::try_from(x).expect("<state the invariant that makes truncation unreachable>")` when truncation is provably impossible (the `expect` message documents *why*), or saturating `u64::try_from(x).unwrap_or(u64::MAX)` when saturation is the correct domain semantic. When handing such a helper to `.map`, pass it **by reference** (`.map(helper)`, not `.map(|x| helper(x))`) to avoid `clippy::redundant_closure`. This is a direct extension of the no-silent-failure policy to numeric truncation.
- **Intentional best-effort swallows are allowed only when the load-bearing signal is delivered elsewhere.** The engine drops a progress `send` once the receiver is gone (`let _ = tx.send(Progress…)`) — that only happens during teardown and the *terminal* status is what matters; document the reason at the site. Pair such swallows with a completeness guarantee: `into_summary` reconciles any non-terminal task into `failed`, so `succeeded + failed` always equals the task count and a panicked worker can never silently vanish.
- **Native dialog calls (`open`/`save`) can reject, not only resolve to `null` on cancel.** A plugin/permission/OS failure rejects the promise; wrap dialog calls in try/catch, surface the real error to the user (status text), and treat only a falsy/`null` resolve as a silent user-cancel. Only **real** dialog/IPC errors reach a `catch`, so never swallow them with a bare `catch {}` — route them to the store `error`. Non-fatal subscription failures (progress / drag-drop listener registration) should at least be `console.error`-logged, not silently dropped.
- **Normalize every rejection through one helper.** `messageFromReason(reason, fallback?)` in `src/lib/errors.ts` turns an unknown throw into an English string (string → as-is, `Error` → `.message`, else fallback) so the UI never renders `[object Object]`. Do not re-duplicate this per file. Store async actions catch failures, record the message in a single `error` state field, and leave `draft` unchanged on failure; the UI surfaces `store.error` in **one** top-level banner (`App`), never per-component, to avoid detached/duplicated error display.
- **`thiserror` `source` field:** a field literally named `source` is auto-treated as the error source (implicit `#[source]`). Add a brief comment at the definition to flag this non-obvious framework behavior so it is not renamed inadvertently.
- **Defensive guards:** when a check is structurally unreachable via the public API but kept for future-proofing (e.g. `check_unique` inside `ArchiveJob`), add a comment explaining why it exists so a future "cleanup" does not silently remove a safety net.

## Presentation / IPC layer

### HARNESS — RAII guard for must-clear-on-exit managed state

**Why:** a manual `finish()` call on the happy return path is silently skipped if the future panics or is dropped (e.g. during Tauri shutdown or a `select!`-cancel). Any state that MUST be reset on every exit path needs a `Drop`-based guarantee.

**What:** write a small RAII guard struct that holds a `&Mutex<State>` *reference* — NOT a live `MutexGuard` — and calls the reset method inside `Drop`. Because the guard holds only a borrow (not an active lock), nothing is held across any `.await` point, keeping clippy's `await_holding_lock` lint clean. **Arm the guard only after the acquire/registration succeeds**, so a rejected start never clears another holder's state.

```rust
struct RunSlotGuard<'a> {
    run: &'a std::sync::Mutex<RunState>,
}
impl Drop for RunSlotGuard<'_> {
    fn drop(&mut self) {
        // Recover from poisoned lock (see "std Mutex poison policy" below) so the
        // slot is always freed even after a panic.
        let mut run = self.run.lock().unwrap_or_else(|p| p.into_inner());
        run.finish();
    }
}
```

PR6 example: `RunSlotGuard` in `run_job` (`src-tauri/src/presentation/commands.rs`) frees the single-active-job slot on any exit path — normal return, `?` early-return, future drop.

### std Mutex poison policy — asymmetric, by intent

**Why:** acquire sites and cleanup sites have opposite requirements. An acquire site that starts new work should refuse to operate on a corrupted lock (fail loudly). A cleanup/cancel site that must always succeed should never be gated by a prior panic.

**What:** apply asymmetrically:

- **Acquire sites (start new work):** propagate poison as an IPC error — `.lock().map_err(|e| e.to_string())?`. A fresh job that refuses to start on a poisoned lock is better than silently inheriting corrupt state.
- **Cleanup/cancel sites (must always run):** recover the guard — `.lock().unwrap_or_else(|p| p.into_inner())`. A prior panic must not strand the slot or silently drop a user-requested cancellation.

Document the rationale at each call site with a comment. This is the no-silent-failure interim policy (see the "Error handling" section above) applied to lock poisoning — do not restate that policy here, only the asymmetric lock rule.

PR6 examples: `run_job` uses `.map_err(|e| e.to_string())?` at both the draft and run-slot acquire; `RunSlotGuard::drop` and `cancel_job` use `unwrap_or_else(|p| p.into_inner())`.

### Encapsulate the invariant in the TYPE, not the call site (presentation managed-state)

**Why and What:** the same principle as the aggregate-encapsulation seam (see that section above) applies equally to presentation-layer managed state. A Tauri `State<T>` value should own its invariant via methods, not rely on a guard check that happens to live in one command handler — a second command path could bypass it.

PR6 example: `RunState` in `src-tauri/src/presentation/state.rs` keeps its `token: Option<CancellationToken>` **private** and exposes only `try_start` / `request_cancel` / `finish`. "Reject if already running" is therefore structural: no command handler can poke the field directly or sneak past the guard. Cross-reference: this is the same rule as the aggregate-encapsulation seam — field visibility forces invariant ownership.

### Presentation-layer DTO conventions

**Why:** the wire shape must evolve independently of domain/application types; domain and application crates must stay free of serde and ts-rs dependencies.

**What:**

- Wire-contract DTOs live exclusively in the presentation crate.
- Derive `Serialize + TS + Clone + Debug + PartialEq + Eq` (for send-only DTOs omit `Deserialize`; `Serialize` alone suffices). For the `Eq` requirement, cross-reference the value-object-equality rule — it applies identically to DTOs, so derive both `PartialEq` and `Eq` whenever all fields are `Eq`-capable.
- Apply `#[serde(rename_all = "camelCase")]` on every DTO struct and `#[ts(export, export_to = "...")]` to regenerate the TypeScript binding automatically on test runs.
- Map from domain/application types via `From` impls written **in the presentation layer only** (domain/application stay serde/ts-rs-free). Keep `From` impls in `dto.rs` next to the DTO they produce.
- When `u64` fields would emit `bigint` in TypeScript (which mismatches Tauri's JSON-number IPC transport), annotate with `#[ts(type = "number")]` and document the reason. For `Option<u64>` fields use `#[ts(type = "number | null")]` — ts-rs would emit `bigint | null`, but Tauri IPC delivers a JSON number-or-null. Pin both overrides with a binding-shape test asserting the emitted type and absence of `bigint`.
- **Document cross-boundary type coupling at the definition (guardrail).** When a TypeScript string-literal union mirrors the keys of a ts-rs-generated DTO (e.g. `type TaskOutcome = "succeeded" | "cancelled" | "failed"` must match every bucket name in `JobSummaryDto`), TypeScript cannot enforce alignment across the generated-bindings boundary — call sites pass string literals that are checked only structurally at use, not traced back to the DTO. Add a comment at the union definition naming the DTO it shadows and why it must stay in sync, so a renamed or newly added DTO bucket does not silently leave the union stale. Extend this principle to any domain→presentation mapping where DTO-key dependency is implicit rather than type-checked.

PR6 examples: `ProgressEvent`, `JobSummaryDto`, `DraftSnapshot` in `src-tauri/src/presentation/dto.rs`; mapping impls `From<&JobProgress> for ProgressEvent`, `From<JobSummary> for JobSummaryDto`.

### HARNESS — testability seam at the IPC boundary

**Why:** Tauri command handlers receive an `AppHandle`, which requires a live Tauri application to construct — making them impossible to unit-test in isolation.

**What:** extract the command's load-bearing logic into an inner function (`run_job_inner`) that takes a `&dyn ProgressEmitter` instead of an `AppHandle`. The thin `#[tauri::command]` wrapper constructs the concrete `TauriEmitter` and delegates. Provide a `RecordingEmitter` test double (a `Mutex<Vec<ProgressEvent>>`) that implements `ProgressEmitter` for use in unit and integration tests without the Tauri runtime.

The `ProgressEmitter` trait exposes only `emit_progress(&self, ev: &ProgressEvent)` — never the raw `AppHandle`. This is the same narrow-surface rule as the port discipline in the "Layer boundary discipline" section above (`CompressContext` exposes only `is_cancelled()`, not the full `CancellationToken`). Apply the same discipline here: the port exposes the observation capability, not the underlying handle.

PR6 examples: `run_job_inner` + `ProgressEmitter` trait + `RecordingEmitter` in `src-tauri/src/presentation/events.rs` and `src-tauri/src/presentation/commands.rs`.

## TypeScript / frontend conventions

- **Validate before using persisted/deserialized external values.** Do not blind-cast `localStorage.getItem(key) as T`; use a type guard and fall back to a safe default on an unrecognized value. (`isTheme` in `theme-provider.tsx` is the canonical shape.)
- **Share string-literal union types; don't re-declare them.** When two modules need the same union, export the type from one and import it in the other. Use `Record<Union, …>` for exhaustive mappings to avoid unsound `as` casts that silently hide drift.
- **shadcn/ui primitives (`src/components/ui/`) are kept faithful to upstream templates.** Do not deviate from the shadcn contract. The `cn` helper is `clsx` + `tailwind-merge`; later utility classes win conflicts (e.g. a variant's `rounded-full` overrides the base `rounded-md`).
- **A React index `key={i}` is correct for a positional, backend-ordered list** with no per-row local state whose item values may legitimately duplicate (`TaskList` rows). Suppress oxlint's `react/no-array-index-key` with a targeted inline comment — put the rationale on a separate line above, then `// oxlint-disable-next-line react/no-array-index-key` — rather than synthesizing a fake unique key.
- **Prefer semantic HTML over explicit ARIA roles (a11y guardrail).** `pnpm lint:ci` enforces `jsx-a11y/prefer-tag-over-role` as a hard error via `--deny-warnings`. A `<div role="status">` or `<section role="status">` is a lint failure; use the semantic element `<output>` instead — it carries an implicit `role="status"` and implicit `aria-live="polite"` with no extra attributes. Testing implication: `getByRole("status")` resolves against `<output>` through its implicit role, so no explicit `role` attribute is needed (and adding one re-triggers the lint). Keep status/live-region panels as `<output>` when refactoring.
- **Disabled-action a11y: `aria-disabled` + a reason, not bare native `disabled` (a11y harness).** Native `disabled` drops a control from the tab order and tells assistive technology nothing about WHY it is unavailable. For a primary action that should communicate its blocker (the Run button), keep it focusable with `aria-disabled`, point `aria-describedby` at a visually-hidden (`sr-only`) reason node, keep `title` for the mouse-hover hint, and **guard the click handler** (`if (disabled) return;`) because `aria-disabled` does NOT prevent activation. Reserve native `disabled` for actions whose unavailability is self-evident (Cancel). **Do NOT add `aria-disabled:pointer-events-none`** — it suppresses the intentional `title` hover tooltip; the handler guard is the activation block. `RunControls.tsx` is the canonical shape; its test harness lives in `docs/development.md` (frontend testing policy).
- **Icons: lucide-react, icon + visible label, decorative svg (a11y).** Use `lucide-react` glyphs, not hand-rolled inline SVGs. Action buttons render an icon **with** a visible text label and mark the svg `aria-hidden="true"`, so the visible label is the accessible name; an icon-only control carries its name via `aria-label`. The shadcn `Button` base sizes and spaces the svg, so pass the glyph as a child with no extra sizing.
