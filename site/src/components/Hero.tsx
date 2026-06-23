import heroFolders from "@/assets/hero-folders.png";

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
          <h1>Re-archive the whole queue in one pass.</h1>
          <p className="body">
            Drop rar files, zip files, and folders. Simple Archiver extracts
            what needs extraction, applies one naming rule, then writes clean
            Deflate zip files in visible queue order.
          </p>
          <div className="actions">
            <a className="btn" href="#install">
              Download app
            </a>
            <a className="text-link" href="#workflow">
              View workflow
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
