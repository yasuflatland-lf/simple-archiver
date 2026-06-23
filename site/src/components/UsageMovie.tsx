import usageMovie from "@/assets/basic_usage.mp4";
import { RELEASES_URL } from "@/config";

// Workflow section presenting the usage movie as a full product surface.
export function UsageMovie() {
  return (
    <section
      aria-label="Basic usage movie"
      className="section wide-visual usage-visual"
      id="workflow"
    >
      <div className="wide-visual-head usage-head">
        <div>
          <div className="kicker">Basic usage</div>
          <h2>Just throw your files and folders in, and let it run.</h2>
        </div>
        <div className="usage-copy">
          <p>
            Drop rar files, zip files, or folders into the queue, confirm the
            naming rule, choose an output directory, then run the batch. The
            movie is shown as a complete product surface instead of a
            background, so the flow stays readable from first intake to final
            summary.
          </p>
          <a className="text-link" href={RELEASES_URL}>
            Download latest release
          </a>
        </div>
      </div>
      <div className="stage video-stage" id="workflow-video-stage">
        <video
          aria-label="Simple Archiver basic usage movie"
          className="usage-video"
          controls
          muted
          playsInline
          preload="metadata"
          src={usageMovie}
        />
        <div className="stage-caption">
          Visible walkthrough — draft queue, naming template, destination
          selection, progress, and completion summary.
        </div>
      </div>
    </section>
  );
}
