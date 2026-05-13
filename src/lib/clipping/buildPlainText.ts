// Port of clipinator.py lines 726–739: build_plain_text().
// Runs client-side (browser) — no Node-only APIs.

import type { ClippingItem } from "./types";
import { formatDateHeader } from "./buildHtml";

export function buildPlainText(items: ClippingItem[], d: Date): string {
  const lines: string[] = [
    `*** IBBA Oil & Gas News - ${formatDateHeader(d)} ***`,
    "",
    "Main Headlines",
  ];

  for (const item of items) {
    lines.push(`  - ${item.title} (${item.source})`);
  }
  lines.push("");

  for (const item of items) {
    lines.push(`${item.title} (${item.source})`);
    lines.push("");
    for (const p of item.paragraphs) {
      lines.push(p);
      lines.push("");
    }
    lines.push(`Fonte: ${item.url}`);
    lines.push("");
  }

  return lines.join("\n");
}
