# CLAUDE.md — simple-archiver

Mac/Windows native desktop app (Tauri 2) that takes drag-and-dropped rar files/folders and batch-renames them into zip archives.
State: **PR1 scaffold landed** (Cargo workspace + Tauri shell + Vite/React frontend + CI); domain/application/infrastructure logic still to be built.

## Mandatory rules (harness)

- **Write all code comments in English.** Name identifiers in English too. Details: `.claude/conventions.md`.
- **TDD**: write tests before implementation (cargo-nextest / Vitest).
- **Layer boundaries**: `domain` is pure (no IO/async); IO lives behind the Extractor/Archiver/Clock ports; deps flow presentation→application→domain and infrastructure→domain.
- **Do not swap libraries** (Tauri 2 / async_zip / unrar / mockall / loom / Biome are fixed choices).
- **One PR ≤ 1000 lines**, walking skeleton first; clippy/fmt/nextest/biome/vitest green before merge.
- Never `git commit` / `git push` until the user explicitly asks.

## Documentation layers (L1/L2/L3)

- **L1 = this file**: mandatory rules + doc map only (keep under 35 lines).
- **L2 = `docs/`**: how the project works.
  - `docs/architecture.md` — layered/hexagonal design and layer boundaries
  - `docs/development.md` — tech stack, dev commands, testing policy, PR rules
- **L3 = `.claude/`**: deep reference, consulted per task.
  - `.claude/conventions.md` — coding conventions (English-comment rule, naming, boundaries)
  - `.claude/domain-model.md` — domain model and invariants

## Source of truth

The authoritative design lives in Notion; the local mirror is `docs/superpowers/specs/` (git-ignored).
If these docs conflict with the design, treat the design as canonical and propose an update.
