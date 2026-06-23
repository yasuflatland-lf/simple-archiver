# Architecture Diagram

Source for the architecture diagram of `simple-archiver`. The script
`diagram.py` uses the [diagrams](https://diagrams.mingrammer.com/) Python
library (which renders via [Graphviz](https://graphviz.gitlab.io/)) and emits
`architecture.png` in this directory.

## Prerequisites

- Python 3.6+
- [Graphviz](https://graphviz.gitlab.io/download/)
- [Diagrams](https://diagrams.mingrammer.com/docs/getting-started/installation#quick-start)

On macOS:

```bash
brew install graphviz
pip3 install diagrams
```

## Generate Diagram

From this directory:

```bash
python diagram.py
```

The script writes `architecture.png` next to itself. Re-run after updating
`diagram.py`; the output is regenerable, so do not hand-edit the PNG.

## Icons

Vendor / platform logos live in `icons/` as PNGs so the diagram renders without
network access. They were converted from SVG with `rsvg-convert`:

```bash
rsvg-convert -w 512 -h 512 -a Tauri.svg     -o icons/tauri.png
rsvg-convert -w 512 -h 512 -a Rust.svg      -o icons/rust.png
rsvg-convert -w 512 -h 512 -a Apple.svg     -o icons/apple.png
rsvg-convert -w 512 -h 512 -a "Windows 8.svg" -o icons/windows.png
rsvg-convert -w 512 -h 512 -a zip.svg       -o icons/zip.png
rsvg-convert -w 512 -h 512 -a rar-archiver.svg -o icons/rar.png
```

## What the diagram shows

- **Tauri 2 desktop app** — a single node (Tauri logo): the React webview UI
  plus the presentation layer (Tauri commands, `AppState` = `JobDraft` /
  `RunState`, DTO/events on the `archive://progress` channel). Rust is the
  single source of truth; the UI is a thin mirror of the backend draft.
- **simple-archiver-core (Rust crate)** — the engine (Rust logo, no caption,
  = `RunArchiveJob`: bounded N-way parallel workers, single-writer aggregator,
  cancellation, `FormatRegistry`) drives **two processing paths**. The outbound
  ports appear as edge labels (`Extractor port` / `Archiver port`) rather than
  as nodes:
  - **Extractor-port path (`.rar` / `.zip`)** — the `ArchiveExtractor` router
    dispatches by source kind: `UnrarExtractor` (the `unrar` C API on
    `spawn_blocking`) for `.rar`, `ZipExtractor` (`async_zip`, CRC-checked with
    a zip-slip guard) for `.zip`. Both extract into a `TempWorkspace` (an RAII
    temp dir reclaimed on every exit path), then `ZipArchiver` (`async_zip`)
    re-compresses it. The final compress also goes through the Archiver port
    (labelled on that edge).
  - **Archiver-port path (folders)** — `ZipArchiver` compresses the folder
    as-is, with no extraction.
  - Both paths converge on a single user-chosen **Output folder**; zips are
    never overwritten (a collision fails that task).
  - The pure, IO-free `domain` and the `Clock` port also live in this crate but
    are not drawn — see `docs/architecture.md` for the full layer boundaries.
- **Native targets** — the same app is bundled as a native binary for **macOS**
  (Apple logo) and **Windows** (Windows logo).

For the narrative version of the same picture, see `docs/architecture.md` and
`docs/development.md`.
