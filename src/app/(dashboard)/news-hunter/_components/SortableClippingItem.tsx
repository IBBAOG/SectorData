"use client";

// Drag-and-drop sortable item for the Clipping Queue sidebar.
// Uses @dnd-kit/sortable. Each item shows: order badge, source label,
// title, drag handle, and remove button.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ArticleSnapshot } from "@/lib/clipping/types";
import styles from "./SelectionSidebar.module.css";

interface Props {
  article: ArticleSnapshot;
  index: number;
  total: number;
  onRemove: (url: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  disabled: boolean;
}

export default function SortableClippingItem({
  article,
  index,
  total,
  onRemove,
  onMoveUp,
  onMoveDown,
  disabled,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: article.url, disabled });

  const itemStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={itemStyle}
      className={`${styles.item} ${isDragging ? styles.itemDragging : ""}`}
    >
      {/* Drag handle — left gutter */}
      <button
        type="button"
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        disabled={disabled}
        title="Drag to reorder"
      >
        <DragIcon />
      </button>

      {/* Order badge */}
      <span className={styles.badge} aria-hidden="true">
        {index + 1}
      </span>

      {/* Article info */}
      <div className={styles.info}>
        <span className={styles.source}>{article.source_name}</span>
        <span className={styles.headline} title={article.title}>
          {article.title}
        </span>
      </div>

      {/* Remove button — top-right corner via CSS positioning */}
      <button
        type="button"
        className={styles.removeBtn}
        onClick={() => onRemove(article.url)}
        disabled={disabled}
        aria-label={`Remove: ${article.title}`}
        title="Remove"
      >
        ×
      </button>

      {/* Keyboard-accessible move buttons (fallback for non-drag users) */}
      <div className={styles.moveButtons} aria-label="Reorder controls">
        <button
          type="button"
          className={styles.moveBtn}
          onClick={() => onMoveUp(index)}
          disabled={index === 0 || disabled}
          aria-label="Move up"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.moveBtn}
          onClick={() => onMoveDown(index)}
          disabled={index === total - 1 || disabled}
          aria-label="Move down"
          title="Move down"
        >
          ↓
        </button>
      </div>
    </li>
  );
}

// Inline SVG drag handle icon (6-dot grid pattern, accessible via aria-hidden).
function DragIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="currentColor"
    >
      <circle cx="4" cy="3" r="1.3" />
      <circle cx="10" cy="3" r="1.3" />
      <circle cx="4" cy="7" r="1.3" />
      <circle cx="10" cy="7" r="1.3" />
      <circle cx="4" cy="11" r="1.3" />
      <circle cx="10" cy="11" r="1.3" />
    </svg>
  );
}
