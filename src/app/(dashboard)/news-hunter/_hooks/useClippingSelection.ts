"use client";

// Local hook: manages the ordered selection of articles for clipping.
// State is persisted to localStorage (versioned key) and lives in page.tsx
// (NOT in NewsHunterContext).

import { useCallback, useState } from "react";
import type { ArticleSnapshot } from "@/lib/clipping/types";

const STORAGE_KEY = "nh_clipping_selection_v1";

function storageSave(items: ArticleSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // QuotaExceededError — ignore silently.
  }
}

function storageLoad(): ArticleSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ArticleSnapshot[]) : [];
  } catch {
    return [];
  }
}

export interface ClippingSelectionHook {
  /** Ordered list of selected articles (order = clipping order). */
  selection: ArticleSnapshot[];
  /** Whether a given URL is currently selected. */
  isSelected: (url: string) => boolean;
  /** Toggle an article in/out of the selection. */
  toggle: (article: ArticleSnapshot) => void;
  /** Remove a specific URL from the selection. */
  remove: (url: string) => void;
  /** Clear the entire selection. */
  clear: () => void;
  /** Move item at index up by one position. */
  moveUp: (index: number) => void;
  /** Move item at index down by one position. */
  moveDown: (index: number) => void;
}

export function useClippingSelection(): ClippingSelectionHook {
  // Lazy initializer reads localStorage synchronously on first render — no effect needed.
  const [selection, setSelection] = useState<ArticleSnapshot[]>(() => {
    // Guard for SSR (server has no localStorage).
    if (typeof window === "undefined") return [];
    return storageLoad();
  });

  const persist = useCallback((next: ArticleSnapshot[]) => {
    setSelection(next);
    storageSave(next);
  }, []);

  const isSelected = useCallback(
    (url: string) => selection.some((a) => a.url === url),
    [selection],
  );

  const toggle = useCallback(
    (article: ArticleSnapshot) => {
      const exists = selection.some((a) => a.url === article.url);
      if (exists) {
        persist(selection.filter((a) => a.url !== article.url));
      } else {
        persist([...selection, article]);
      }
    },
    [selection, persist],
  );

  const remove = useCallback(
    (url: string) => {
      persist(selection.filter((a) => a.url !== url));
    },
    [selection, persist],
  );

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  const moveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const next = [...selection];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      persist(next);
    },
    [selection, persist],
  );

  const moveDown = useCallback(
    (index: number) => {
      if (index >= selection.length - 1) return;
      const next = [...selection];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      persist(next);
    },
    [selection, persist],
  );

  return { selection, isSelected, toggle, remove, clear, moveUp, moveDown };
}
