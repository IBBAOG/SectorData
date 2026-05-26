"use client";

// Admin-only right-rail sidebar showing the ordered clipping queue.
// Displayed only when Selection Mode is active (isAdmin && selectionMode).
//
// Width is injected via inline style from desktop/View.tsx:
//   clamp(420px, 50vw, 720px)  — ~50% of viewport, min 420px, max 720px.
//
// Drag-and-drop reorder via @dnd-kit/sortable. Keyboard support is built-in
// (Tab to focus handle, Space to lift, Arrow keys to move, Space/Enter to drop).
// Touch support via PointerSensor (works on mobile if clipping ever lands there).

import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  restrictToVerticalAxis,
  restrictToWindowEdges,
} from "@dnd-kit/modifiers";

import BarrelLoading from "@/components/dashboard/BarrelLoading";
import type { ArticleSnapshot } from "@/lib/clipping/types";
import SortableClippingItem from "./SortableClippingItem";
import styles from "./SelectionSidebar.module.css";

interface Props {
  selection: ArticleSnapshot[];
  onRemove: (url: string) => void;
  onClear: () => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onGenerate: () => void;
  generating: boolean;
  /** CSS width value for the sidebar — e.g. "clamp(420px, 50vw, 720px)".
   *  Passed as inline style so the parent controls the responsive formula. */
  widthCss: string;
  /** Propagate theme to sidebar (sidebar lives outside .page[data-nh-theme] tree). */
  theme: "light" | "dark";
}

export default function SelectionSidebar({
  selection,
  onRemove,
  onClear,
  onMoveUp,
  onMoveDown,
  onReorder,
  onGenerate,
  generating,
  widthCss,
  theme,
}: Props) {
  // PointerSensor: activationConstraint avoids accidental drags on normal clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6, // px — must move 6px before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = selection.findIndex((a) => a.url === active.id);
    const toIndex = selection.findIndex((a) => a.url === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      onReorder(fromIndex, toIndex);
    }
  }

  // IDs for SortableContext — use URL as stable unique key.
  const itemIds = selection.map((a) => a.url);

  return (
    <aside
      className={styles.sidebar}
      data-nh-theme={theme}
      style={{ width: widthCss }}
      aria-label="Clipping queue"
    >
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Clipping Queue</span>
        <span className={styles.headerCount}>
          {selection.length} article{selection.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Sortable list */}
      <ul className={styles.list} aria-label="Selected articles in clipping order">
        {selection.length === 0 && (
          <li className={styles.empty} aria-live="polite">
            No articles selected.
            <br />
            Click checkboxes in the feed to add them here.
          </li>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {selection.map((article, idx) => (
              <SortableClippingItem
                key={article.url}
                article={article}
                index={idx}
                total={selection.length}
                onRemove={onRemove}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                disabled={generating}
              />
            ))}
          </SortableContext>
        </DndContext>
      </ul>

      {/* Footer */}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.generateBtn}
          onClick={onGenerate}
          disabled={selection.length === 0 || generating}
        >
          {generating ? (
            <>
              <BarrelLoading size={18} bare />
              Scraping…
            </>
          ) : (
            "Generate Clipping"
          )}
        </button>
        <button
          type="button"
          className={styles.clearBtn}
          onClick={onClear}
          disabled={selection.length === 0 || generating}
        >
          Clear selection
        </button>
      </div>
    </aside>
  );
}
