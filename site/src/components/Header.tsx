import { useScrollHeader } from "@/hooks/useScrollHeader";
import { RELEASES_URL } from "@/config";

// Fixed site header with anchor navigation and scroll-driven visibility.
export function Header() {
  const headerClassName = useScrollHeader();

  return (
    <header
      aria-label="Site header"
      className={headerClassName}
      id="site-header"
    >
      <a className="logo" href="#top">
        Simple Archiver
      </a>
      <nav aria-label="Primary navigation" className="nav">
        <a href="#overview">Overview</a>
        <a href="#workflow">Workflow</a>
        <a href="#install">Install</a>
      </nav>
      <div className="header-end">
        <a href={RELEASES_URL}>Download</a>
      </div>
    </header>
  );
}
