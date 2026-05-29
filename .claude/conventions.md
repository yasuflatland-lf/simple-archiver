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
- TypeScript: follow the project's ESLint/Prettier config (finalized at scaffold time).
- Match the surrounding code's comment density, naming, and idioms. Do not introduce a new style.

## Layer boundary discipline (implementation level)

- Default visibility is `pub(crate)`; keep cross-layer exposure minimal.
- Do not import `std::fs` / `tokio` / `async` / external IO crates into the `domain` module (keep it pure at compile time).
- All IO goes through the `Extractor` / `Archiver` / `Clock` ports; confine concrete implementations to `infrastructure`.
- Reject imports that violate the dependency direction (presentation → application → domain, infrastructure → domain) in clippy / review.

## Error handling

- Use a per-task `Result`; catch failures and never stop other tasks from running.
- Treat name collisions as a **failure, not an overwrite**.
- Always clean up temp; on failure/cancellation, delete the partial output zip.
- Do not swallow errors (no silent failures). Always surface them in logs / the summary.
- **Native dialog calls (`open`/`save`) can reject, not only resolve to `null` on cancel.** A plugin/permission/OS failure rejects the promise; wrap dialog calls in try/catch, surface the real error to the user (status text), and treat only a falsy/`null` resolve as a silent user-cancel.
