import heroFolders from "@/assets/hero-folders.png";
import { RELEASES_URL } from "@/config";

// Hero section: the folders-mode screenshot bleeds off-canvas behind the copy.
export function Hero() {
  return (
    <section aria-label="Hero" className="section hero">
      <img
        alt="Simple Archiver folders mode screenshot"
        className="hero-image"
        decoding="async"
        src={heroFolders}
      />
      <div className="full-frame">
        <div className="hero-copy">
          <p className="eyebrow">Native batch zip archiver</p>
          <h1>Stress-free re-archive process.</h1>
          <p className="body">
            Organizing random archive files and folders into numbered, unified
            filenames is troublesome. Simple Archiver makes it easy.
          </p>
          <div className="actions">
            <a className="btn" href={RELEASES_URL}>
              Download app
            </a>
            <a className="text-link" href="#workflow-video-stage">
              View how it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
