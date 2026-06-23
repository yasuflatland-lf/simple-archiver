import { RELEASES_URL } from "@/config";

// Installation section with per-OS release cards.
export function Install() {
  return (
    <section aria-label="Installation" className="install" id="install">
      <div className="install-copy">
        <div className="kicker">Installation</div>
        <h2>Multi platform, Mac and Windows.</h2>
        <p>
          Download the latest installer for your OS. Because the app is not
          notarized by Apple or signed by a Windows publisher, the first launch
          may show the standard OS security warning.
        </p>
        <div className="note">
          Source stack: Tauri 2 native shell, Rust archive engine, Vite + React
          + TypeScript frontend, Tailwind CSS, shadcn/ui, Radix primitives,
          zustand state, and Inter typography.
        </div>
      </div>
      <div className="release-panel">
        <div className="release-grid">
          <div className="release-card">
            <div>
              <h3>macOS</h3>
              <p>
                Use the universal .dmg build for Apple Silicon and Intel. Open
                Anyway may be required on first launch.
              </p>
            </div>
            <a
              className="btn"
              href={RELEASES_URL}
              rel="noreferrer"
              target="_blank"
            >
              Latest release
            </a>
          </div>
          <div className="release-card">
            <div>
              <h3>Windows</h3>
              <p>
                Use the x64 setup executable or MSI installer. If SmartScreen
                appears, choose More info, then Run anyway.
              </p>
            </div>
            <a
              className="btn"
              href={RELEASES_URL}
              rel="noreferrer"
              target="_blank"
            >
              Latest release
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
