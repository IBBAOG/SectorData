"use client";

// ─── useInViewOnce — fire a callback the first time an element scrolls in ──────
//
// SSR-safe, client-only. Attaches an IntersectionObserver to the returned ref and
// invokes `onInView` ONCE the element first intersects the viewport, then
// disconnects. Used by /stock-guide to lazily fetch the scenario-grid mesh
// (~194k points) only when the grid panel scrolls into view — never on page load.
//
// If IntersectionObserver is unavailable (old browser / jsdom), it falls back to
// firing immediately on mount so the content still loads (degraded, never broken).

import { useEffect, useRef } from "react";

/**
 * Calls `onInView` exactly once, the first time the returned ref's element
 * intersects the viewport. The callback identity is captured in a ref, so the
 * observer is set up once and is not torn down when the callback changes.
 *
 * @param onInView fired once on first intersection (e.g. trigger a lazy fetch).
 * @param rootMargin pre-load margin (default "200px" → fetch slightly early).
 */
export function useInViewOnce<T extends Element = HTMLDivElement>(
  onInView: () => void,
  rootMargin = "200px",
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const firedRef = useRef(false);
  const cbRef = useRef(onInView);

  // Keep the latest callback in a ref WITHOUT touching it during render (the
  // observer reads `cbRef.current` when it fires, so it always sees the latest).
  useEffect(() => {
    cbRef.current = onInView;
  }, [onInView]);

  useEffect(() => {
    if (firedRef.current) return;
    const el = ref.current;
    if (!el) return;

    const fire = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      cbRef.current();
    };

    // Degraded fallback: no IntersectionObserver → load right away.
    if (typeof IntersectionObserver === "undefined") {
      fire();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            fire();
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return ref;
}
