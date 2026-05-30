"""Architecture diagram for simple-archiver.

Generates ``architecture.png`` in this directory: a single-image overview of
the Mac/Windows native desktop app (Tauri 2) and the two processing paths a
batch-archive job can take (one per outbound port).

Run from this directory::

    python diagram.py

Layers shown (matches docs/architecture.md):
  - A thin Tauri 2 desktop app: React webview UI + presentation (a single
    vendor-logo node, no cluster frame).
  - A pure Rust core crate (simple-archiver-core): the engine and two explicit
    processing paths fanning out from it. The outbound ports are shown as edge
    labels (Extractor port / Archiver port) rather than as nodes:
      * Extractor-port path (.rar): extract -> temp dir -> compress -> zip.
      * Archiver-port path (folders): compress the folder as-is -> zip.
    The Archiver-port step is intentionally repeated on the .rar path (its
    final compress also uses it).
  - The app is bundled as a native binary for macOS and Windows.
"""

from diagrams import Cluster, Diagram, Edge
from diagrams.custom import Custom
from diagrams.generic.storage import Storage
from diagrams.onprem.client import Users

# Vendor / platform logos staged in icons/ — kept locally so the diagram is
# portable and regenerable without network access.
ICON_TAURI = "icons/tauri.png"
ICON_RUST = "icons/rust.png"
ICON_APPLE = "icons/apple.png"
ICON_WINDOWS = "icons/windows.png"
ICON_ZIP = "icons/zip.png"
ICON_RAR = "icons/rar.png"

graph_attr = {
    "fontsize": "18",
    "splines": "spline",
    "pad": "0.5",
    "nodesep": "0.6",
    "ranksep": "1.3",
}


with Diagram(
    "simple-archiver — Mac/Windows desktop architecture",
    filename="architecture",
    show=False,
    direction="LR",
    outformat="png",
    graph_attr=graph_attr,
):
    # External actor
    user = Users("End user\n(drag & drop\nrar files / folders)")

    # Presentation: the whole Tauri 2 desktop app as one vendor-logo node —
    # React webview UI + the Tauri command layer (no cluster frame).
    tauri_app = Custom("Tauri 2 desktop app", ICON_TAURI)

    # Output sink on the local filesystem (both paths converge here).
    out = Storage("Output folder\n*.zip (no overwrite)")

    # Pure Rust core crate: the engine plus the two processing paths.
    with Cluster("simple-archiver-core (Rust crate)"):
        # The engine carries the Rust logo only (no caption).
        application = Custom("", ICON_RUST)

        # Path 1 — Extractor port: a .rar file is extracted, then compressed.
        with Cluster("Extractor-port path · .rar files"):
            unrar = Custom("UnrarExtractor\n(unrar · spawn_blocking)", ICON_RAR)
            temp = Storage("TempWorkspace\n(RAII temp dir)")
            zip_rar = Custom("ZipArchiver\n(async_zip)", ICON_ZIP)

        # Path 2 — Archiver port: a folder is compressed as-is (no extraction).
        with Cluster("Archiver-port path · folders"):
            zip_folder = Custom("ZipArchiver\n(async_zip)", ICON_ZIP)

    # Native distribution targets.
    with Cluster("Native targets (Tauri bundle)"):
        macos = Custom("macOS\n(.app)", ICON_APPLE)
        windows = Custom("Windows\n(.msi)", ICON_WINDOWS)

    # ────────────────────────────── Edges ──────────────────────────────

    # Request spine: user -> Tauri app -> engine.
    # High weight + thick stroke pins these onto the same horizontal rank.
    user >> Edge(label="drag & drop", penwidth="2", weight="10") >> tauri_app
    tauri_app >> Edge(
        label="run_job\n(plan → engine)", penwidth="2", weight="10"
    ) >> application

    # The two outbound ports are shown only as edge labels — one per path.
    # Path 1 (Extractor port): extract -> temp dir -> compress (Archiver) -> zip.
    application >> Edge(
        label="Extractor port\n(In case of RAR file)", style="dashed"
    ) >> unrar
    unrar >> Edge(label="RarFile: extract →") >> temp
    temp >> Edge(label="then compress\n(Archiver port)") >> zip_rar
    zip_rar >> Edge(label="write *.zip", penwidth="2") >> out

    # Path 2 (Archiver port): compress the folder as-is -> zip.
    application >> Edge(
        label="Archiver port\n(In case of folders)", style="dashed"
    ) >> zip_folder
    zip_folder >> Edge(
        label="Folder: compress as-is\n→ write *.zip", penwidth="2"
    ) >> out

    # Progress streams back to the UI over a Tauri global event channel.
    application >> Edge(
        label="archive://progress\nevents",
        style="dotted",
        constraint="false",
    ) >> tauri_app

    # The same app is packaged as a native binary for each desktop OS.
    tauri_app >> Edge(
        label="native bundle",
        style="dotted",
        constraint="false",
    ) >> macos
    tauri_app >> Edge(
        style="dotted",
        constraint="false",
    ) >> windows
