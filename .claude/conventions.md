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
- TypeScript / JS / JSON: formatted and linted by **Biome** (`biome.json`). Run `pnpm check` (format + lint, with autofix) before committing; CI enforces it via `pnpm biome:ci`. Biome owns style (2-space indent, double quotes, semicolons) and import organization; `tsc` still owns type-checking and `knip` owns unused-code detection.
- Match the surrounding code's comment density, naming, and idioms. Do not introduce a new style.

## Layer boundary discipline (implementation level)

- Default visibility is `pub(crate)`; keep cross-layer exposure minimal.
- Do not import `std::fs` / `tokio` / `async` / external IO crates into the `domain` module (keep it pure at compile time).
- All IO goes through the `Extractor` / `Archiver` / `Clock` ports; confine concrete implementations to `infrastructure`.
- Reject imports that violate the dependency direction (presentation → application → domain, infrastructure → domain) in clippy / review.

### Aggregate encapsulation seam

Entity fields are private; only the aggregate root constructs/mutates entities via `pub(crate)` constructors and mutators (e.g. `ArchiveTask::new` / `set_output_name` / `apply_event`, `TaskId::new` are `pub(crate)`; external code obtains a `TaskId` only via `id()`). **Why:** the "names bound to position, `TaskId` stable" invariant is then structurally enforceable — external code cannot fabricate ids, build entities out of band, or reorder the private `Vec`.

## Value-object equality

Derive **both `PartialEq` and `Eq`** on value objects whenever all fields are `Eq`-capable (not just `PartialEq`). **Why:** it's an honest value-equality contract, enables use as map/set keys, and avoids artificially blocking `Eq` up the whole aggregate. (PR3's `NamingRule` / `Segment` derived only `PartialEq` despite `Eq`-capable fields, which cascaded into blocking `Eq` on `ArchiveJob` until fixed in PR4.)

## State-machine convention

Model lifecycle as `apply(self, Event) -> Result<Self, IllegalTransition>` that **consumes `self`**, with a single exhaustive `match`. The catch-all arm must return a typed `IllegalTransition` error — never a silent no-op. At a mutation call site, use clone-before-apply so an illegal transition leaves state unchanged:

```rust
self.status = self.status.clone().apply(event)?;
```

## Error handling

- Use a per-task `Result`; catch failures and never stop other tasks from running.
- Treat name collisions as a **failure, not an overwrite**.
- Always clean up temp; on failure/cancellation, delete the partial output zip.
- Do not swallow errors (no silent failures). Always surface them in logs / the summary.
- **Intentional best-effort swallows are allowed only when the load-bearing signal is delivered elsewhere.** The engine drops a progress `send` once the receiver is gone (`let _ = tx.send(Progress…)`) — that only happens during teardown and the *terminal* status is what matters; document the reason at the site. Pair such swallows with a completeness guarantee: `into_summary` reconciles any non-terminal task into `failed`, so `succeeded + failed` always equals the task count and a panicked worker can never silently vanish.
- **Native dialog calls (`open`/`save`) can reject, not only resolve to `null` on cancel.** A plugin/permission/OS failure rejects the promise; wrap dialog calls in try/catch, surface the real error to the user (status text), and treat only a falsy/`null` resolve as a silent user-cancel.
- **`thiserror` `source` field:** a field literally named `source` is auto-treated as the error source (implicit `#[source]`). Add a brief comment at the definition to flag this non-obvious framework behavior so it is not renamed inadvertently.
- **Defensive guards:** when a check is structurally unreachable via the public API but kept for future-proofing (e.g. `check_unique` inside `ArchiveJob`), add a comment explaining why it exists so a future "cleanup" does not silently remove a safety net.
