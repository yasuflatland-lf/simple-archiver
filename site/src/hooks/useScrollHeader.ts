import { useEffect, useState } from "react";

// A small threshold prevents jitter from trackpad micro-scrolls; past the
// reveal zone the header gains its gradient and may hide on downward scroll.
const THRESHOLD = 3;
const REVEAL_ZONE = 5;

// Mirrors the original page's SpaceX-style header: reveal on scroll-up, hide on
// scroll-down past the hero. Returns the header element's class list.
export function useScrollHeader(): string {
  const [pastHero, setPastHero] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY || 0;
    let ticking = false;

    const update = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const delta = y - lastY;

      setPastHero(y > REVEAL_ZONE);
      if (y <= REVEAL_ZONE || delta < -THRESHOLD) {
        setHidden(false);
      } else if (delta > THRESHOLD) {
        setHidden(true);
      }

      lastY = Math.max(y, 0);
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return ["header", pastHero && "is-past-hero", hidden && "is-hidden"]
    .filter(Boolean)
    .join(" ");
}
