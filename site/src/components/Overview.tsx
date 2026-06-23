import heroZip from "@/assets/hero-zip.png";

// Overview/editorial section with the manifest rows and the zip-files-mode shot.
export function Overview() {
  return (
    <section aria-label="Overview" className="section editorial" id="overview">
      <div className="editorial-copy">
        <div className="kicker">Overview</div>
        <h2>Sleek interface to get the work done.</h2>
        <p>
          Simple Archiver is a native Mac and Windows app for batch re-archiving
          mixed inputs into standard zip files. Rar and zip inputs are extracted
          into a temporary workspace, then re-compressed. Folders are zipped
          directly.
        </p>
        <div className="manifest">
          <div className="manifest-row">
            <b>Input</b>
            <span>
              Drag and drop multiple rar files, zip files, and folders, or add
              them from a file dialog.
            </span>
          </div>
          <div className="manifest-row">
            <b>Order</b>
            <span>
              Reorder the queue with top-to-bottom run order, so the sequence
              number follows the visible list.
            </span>
          </div>
          <div className="manifest-row">
            <b>Output</b>
            <span>
              Choose one destination folder. The app remembers the last folder
              and defaults to Downloads on first run.
            </span>
          </div>
        </div>
      </div>
      <div className="editorial-media">
        <img
          alt="Simple Archiver zip files mode interface showing naming rule and batch queue"
          className="screen-xl"
          decoding="async"
          loading="eager"
          src={heroZip}
        />
        <div className="caption">
          FOLDERS MODE / OUTPUT TEMPLATE / QUEUE STATUS
        </div>
      </div>
    </section>
  );
}
