// Port of clipinator.py lines 639–723: build_html().
// Runs client-side (browser) — no Node-only APIs.
//
// IMPORTANT: All styles are inlined on each element.
// Outlook (desktop + web) and Gmail strip <style> blocks and class attributes
// when the content is pasted. Inline style="..." on every tag is the only
// reliable way to preserve formatting.

import type { ClippingItem } from "./types";

export const MONTH_EN: Record<number, string> = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
};

// Base paragraph style — applied inline on every <p>.
const P_STYLE =
  "margin:0 0 0 0;font-size:11pt;font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#1a1a1a;";

// Justified paragraph (article body).
const P_JUS_STYLE =
  "margin:0 0 0 0;font-size:11pt;font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#1a1a1a;text-align:justify;";

// Empty spacer row.
const BLANK = `<p style="${P_STYLE}">&nbsp;</p>`;

// Hardcoded IBBA Oil & Gas Team block — verbatim from clipinator.py lines 659–670.
const TEAM_BLOCK =
  `<p style="${P_STYLE}"><b><span style="color:#FF5000;font-family:Arial,Helvetica,sans-serif;">Ita&uacute; BBA Oil &amp; Gas Team</span></b></p>` +
  `<p style="${P_JUS_STYLE}"><b><span style="font-size:10pt;color:#000512;font-family:Arial,Helvetica,sans-serif;">Monique Greco Natal /</span></b>&nbsp;` +
  `<a href="mailto:monique.greco@itaubba.com" style="color:#0563C1;text-decoration:underline;font-size:10pt;font-family:Arial,Helvetica,sans-serif;">monique.greco@itaubba.com</a></p>` +
  `<p style="${P_JUS_STYLE}"><b><span style="font-size:10pt;color:#000512;font-family:Arial,Helvetica,sans-serif;">Eric de Mello /</span></b>&nbsp;` +
  `<a href="mailto:eric.mello@itaubba.com" style="color:#0563C1;text-decoration:underline;font-size:10pt;font-family:Arial,Helvetica,sans-serif;">eric.mello@itaubba.com</a></p>` +
  `<p style="${P_JUS_STYLE}"><b><span style="font-size:10pt;color:#000512;font-family:Arial,Helvetica,sans-serif;">Eduardo Mendes /</span></b>&nbsp;` +
  `<a href="mailto:eduardo.mendes@itaubba.com" style="color:#0563C1;text-decoration:underline;font-size:10pt;font-family:Arial,Helvetica,sans-serif;">eduardo.mendes@itaubba.com</a></p>`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDateHeader(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = MONTH_EN[d.getMonth() + 1];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function buildHtml(items: ClippingItem[], d: Date): string {
  const dateText = formatDateHeader(d);

  // Index bullets — each <li> gets full inline style.
  const LI_STYLE =
    "font-size:11pt;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5;margin:2px 0;";
  const bulletsHtml = items
    .map(
      (item) =>
        `<li style="${LI_STYLE}"><b>${esc(item.title)} (${esc(item.source)})</b></li>`,
    )
    .join("");
  const UL_STYLE =
    "margin:8px 0 8px 24px;padding:0;font-family:Arial,Helvetica,sans-serif;";
  const indexBlock = `<ul style="${UL_STYLE}">${bulletsHtml}</ul>`;

  // Per-article sections.
  const TITLE_STYLE =
    "font-size:14pt;font-weight:bold;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;";
  const SOURCE_LABEL_STYLE =
    "font-size:10pt;font-family:Arial,Helvetica,sans-serif;color:#333333;";
  const SOURCE_LINK_STYLE =
    "font-size:10pt;font-family:Arial,Helvetica,sans-serif;color:#0563C1;text-decoration:underline;word-break:break-all;";

  const sections = items.map((item) => {
    const titleHtml =
      `<p style="${P_STYLE}"><b><span style="${TITLE_STYLE}">${esc(item.title)} (${esc(item.source)})</span></b></p>`;
    const bodyParts = item.paragraphs.map(
      (par) => `<p style="${P_JUS_STYLE}">${esc(par)}</p>`,
    );
    const bodyHtml = bodyParts.join(BLANK);
    const sourceHtml =
      `<p style="${P_STYLE}"><span style="${SOURCE_LABEL_STYLE}">Fonte:</span> ` +
      `<a href="${esc(item.url)}" style="${SOURCE_LINK_STYLE}">${esc(item.url)}</a></p>`;
    return titleHtml + BLANK + bodyHtml + BLANK + sourceHtml + BLANK;
  });

  // Main header.
  const HEADER_STYLE =
    "margin:0 0 0 0;font-size:18pt;font-weight:bold;font-family:Arial,Helvetica,sans-serif;color:#FF5000;text-align:center;";
  const headerHtml =
    `<p style="margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;">` +
    `<b><span style="${HEADER_STYLE}">*** IBBA Oil &amp; Gas News – ${esc(dateText)} ***</span></b></p>`;

  // "Main Headlines" subheader.
  const SUBHEADER_STYLE =
    "font-size:14pt;font-weight:bold;font-family:Arial,Helvetica,sans-serif;color:#FF5000;";
  const subheaderHtml =
    `<p style="${P_STYLE}"><b><span style="${SUBHEADER_STYLE}">Main Headlines</span></b></p>`;

  // Minimal <head> — no <style> block. Outlook ignores it; inline styles are
  // the only reliable vehicle.
  return (
    '<html><head><meta charset="utf-8"></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#ffffff;margin:0;padding:16px;">' +
    headerHtml +
    BLANK +
    subheaderHtml +
    indexBlock +
    BLANK +
    TEAM_BLOCK +
    BLANK +
    sections.join("") +
    "</body></html>"
  );
}
