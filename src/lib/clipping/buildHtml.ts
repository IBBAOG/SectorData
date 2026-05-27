// Port of clipinator.py lines 639-723: build_html().
// Runs client-side (browser) - no Node-only APIs.
//
// IMPORTANT - Why this HTML looks like 1999:
//
// Goal: the HTML must render identically whether the user opens the digest as
// an .eml file in Outlook OR pastes it from the clipboard into a fresh Outlook
// compose window. The second case is brutal:
//
//   1. Chrome converts our text/html into CF_HTML (Windows clipboard format),
//      injecting <!--StartFragment--> / <!--EndFragment--> markers.
//   2. Outlook only imports what is between those markers, so <html>, <head>,
//      and (sometimes) <body> tags + their style attributes are DROPPED.
//   3. Outlook then runs the pasted fragment through Word's HTML engine.
//      Word's engine attaches its MsoNormal class to every <p> it sees and
//      forces Calibri 11pt black on it, OVERRIDING inline styles in some
//      configurations (depending on the destination paragraph's theme).
//   4. <span style="..."> inside <b> is sometimes parsed by Word as a phrasing
//      child whose style does not propagate to text nodes.
//
// Mitigations (cumulative, all required):
//   A. Wrap everything in a <table><tr><td>. Tables are the lingua franca of
//      email HTML; Outlook treats them verbatim and does NOT apply MsoNormal
//      to table cells.
//   B. Use <div> instead of <p>. <div> escapes the MsoNormal trigger.
//   C. Put inline style on the OUTER block element AND on a nested <span>
//      (Outlook respects whichever it parses last).
//   D. Add legacy <font face="Arial" color="#FF5000" size="6"> tags as
//      belt-and-suspenders. Word HTML respects <font> even when it ignores
//      CSS in some contexts.
//   E. Order tags as <span style="..."><b>text</b></span> (style on the OUTER
//      span so the color/font cascades into <b>), not <b><span>...</span></b>.
//   F. Every leaf text node has its OWN <span style="font-family;color;size">
//      so nothing relies on inheritance from the parent block.

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

const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const COLOR_BODY = "#1A1A1A";
const COLOR_BRAND = "#FF5000";
const COLOR_LINK = "#0563C1";
const COLOR_NAME = "#000512";
const COLOR_LABEL = "#333333";

// Word-HTML "size" attribute maps to a discrete scale (1..7).
// size=6 ~= 24px ~= 18pt for header
// size=4 ~= 14px ~= 14pt for subheader / titles
// size=2 ~= 13px ~= 10pt for footer names
const SIZE_HEADER = "6";
const SIZE_SUBHEADER = "4";
const SIZE_BODY = "3"; // ~12px ~= 11pt
const SIZE_SMALL = "2";

// Block-level "div" style with explicit font properties. Inline on the <div>
// itself AND repeated on a nested <span> for redundancy.
const DIV_BLOCK = `margin:0 0 6px 0;font-family:${FONT_FAMILY};font-size:11pt;line-height:1.4;color:${COLOR_BODY};`;
const DIV_BLOCK_JUS = `${DIV_BLOCK}text-align:justify;`;
const DIV_BLANK = `margin:0;font-family:${FONT_FAMILY};font-size:11pt;line-height:1.4;color:${COLOR_BODY};height:11pt;`;

// Spacer row inside the wrapper table cell.
const BLANK = `<div style="${DIV_BLANK}">&nbsp;</div>`;

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

// Helper - render a text run with style applied via BOTH inline CSS and the
// legacy <font> tag. Order is critical: <span style> OUTSIDE, <font> INSIDE,
// then any <b>/<i> wrap the text. This stacking maximizes the chance that at
// least one layer survives the Outlook/Word HTML normaliser.
function styledRun(opts: {
  text: string; // already-escaped or plain (we escape inside)
  bold?: boolean;
  size?: string; // <font size=...>
  fontPx?: string; // CSS font-size value (e.g., "11pt", "18pt")
  color?: string; // hex like #FF5000
  preEscaped?: boolean; // skip esc() (used when text contains nested HTML)
}): string {
  const {
    text,
    bold = false,
    size = SIZE_BODY,
    fontPx = "11pt",
    color = COLOR_BODY,
    preEscaped = false,
  } = opts;
  const safe = preEscaped ? text : esc(text);
  const cssStyle = `font-family:${FONT_FAMILY};font-size:${fontPx};color:${color};`;
  const inner = bold ? `<b>${safe}</b>` : safe;
  // <span style> OUTER + <font face/color/size> INNER + bold INNERMOST.
  return (
    `<span style="${cssStyle}">` +
    `<font face="Arial, Helvetica, sans-serif" color="${color}" size="${size}">` +
    inner +
    `</font>` +
    `</span>`
  );
}

function buildTeamBlock(): string {
  const team = styledRun({
    text: "Itaú BBA Oil & Gas Team",
    bold: true,
    size: SIZE_BODY,
    fontPx: "11pt",
    color: COLOR_BRAND,
  });
  const teamLine = `<div style="${DIV_BLOCK}">${team}</div>`;

  function memberLine(name: string, email: string): string {
    const namePart = styledRun({
      text: `${name} /`,
      bold: true,
      size: SIZE_SMALL,
      fontPx: "10pt",
      color: COLOR_NAME,
    });
    const linkInner = styledRun({
      text: email,
      size: SIZE_SMALL,
      fontPx: "10pt",
      color: COLOR_LINK,
    });
    // text-decoration:underline on the <a> (Outlook recognises <a> styling).
    const linkStyle = `color:${COLOR_LINK};text-decoration:underline;`;
    return (
      `<div style="${DIV_BLOCK_JUS}">` +
      namePart +
      `&nbsp;` +
      `<a href="mailto:${esc(email)}" style="${linkStyle}">${linkInner}</a>` +
      `</div>`
    );
  }

  return (
    teamLine +
    memberLine("Monique Greco Natal", "monique.greco@itaubba.com") +
    memberLine("Eric de Mello", "eric.mello@itaubba.com") +
    memberLine("Eduardo Mendes", "eduardo.mendes@itaubba.com")
  );
}

function buildHeaderBlock(dateText: string): string {
  const headerSpan = styledRun({
    text: `*** IBBA Oil & Gas News – ${dateText} ***`,
    bold: true,
    size: SIZE_HEADER,
    fontPx: "18pt",
    color: COLOR_BRAND,
  });
  const blockStyle = `margin:0 0 6px 0;text-align:center;font-family:${FONT_FAMILY};font-size:18pt;color:${COLOR_BRAND};`;
  return `<div style="${blockStyle}" align="center">${headerSpan}</div>`;
}

function buildSubheader(): string {
  const span = styledRun({
    text: "Main Headlines",
    bold: true,
    size: SIZE_SUBHEADER,
    fontPx: "14pt",
    color: COLOR_BRAND,
  });
  return `<div style="${DIV_BLOCK}">${span}</div>`;
}

function buildIndexBlock(items: ClippingItem[]): string {
  // <ul> is risky in Outlook (resets margins). Use <div> with em-dash bullet.
  // Each bullet is its own <div> for maximum isolation.
  const rows = items
    .map((item) => {
      const bullet = styledRun({
        text: `• ${item.title} (${item.source})`,
        bold: true,
        size: SIZE_BODY,
        fontPx: "11pt",
        color: COLOR_BODY,
      });
      const style = `margin:2px 0 2px 16px;font-family:${FONT_FAMILY};font-size:11pt;line-height:1.45;color:${COLOR_BODY};`;
      return `<div style="${style}">${bullet}</div>`;
    })
    .join("");
  return rows;
}

function buildArticleSection(item: ClippingItem): string {
  // Title
  const titleSpan = styledRun({
    text: `${item.title} (${item.source})`,
    bold: true,
    size: SIZE_SUBHEADER,
    fontPx: "14pt",
    color: COLOR_BODY,
  });
  const titleStyle = `margin:0 0 6px 0;font-family:${FONT_FAMILY};font-size:14pt;color:${COLOR_BODY};`;
  const titleHtml = `<div style="${titleStyle}">${titleSpan}</div>`;

  // Body paragraphs
  const bodyHtml = item.paragraphs
    .map((par) => {
      const span = styledRun({
        text: par,
        size: SIZE_BODY,
        fontPx: "11pt",
        color: COLOR_BODY,
      });
      return `<div style="${DIV_BLOCK_JUS}">${span}</div>`;
    })
    .join(BLANK);

  // Source line
  const labelSpan = styledRun({
    text: "Fonte:",
    size: SIZE_SMALL,
    fontPx: "10pt",
    color: COLOR_LABEL,
  });
  const urlSpan = styledRun({
    text: item.url,
    size: SIZE_SMALL,
    fontPx: "10pt",
    color: COLOR_LINK,
  });
  const linkStyle = `color:${COLOR_LINK};text-decoration:underline;word-break:break-all;`;
  const sourceHtml =
    `<div style="${DIV_BLOCK}">` +
    labelSpan +
    `&nbsp;` +
    `<a href="${esc(item.url)}" style="${linkStyle}">${urlSpan}</a>` +
    `</div>`;

  return titleHtml + BLANK + bodyHtml + BLANK + sourceHtml + BLANK;
}

export function buildHtml(items: ClippingItem[], d: Date): string {
  const dateText = formatDateHeader(d);

  const headerHtml = buildHeaderBlock(dateText);
  const subheaderHtml = buildSubheader();
  const indexHtml = buildIndexBlock(items);
  const teamHtml = buildTeamBlock();
  const sectionsHtml = items.map(buildArticleSection).join("");

  // Outer wrapper - a single-cell <table>. This is the gold-standard for email
  // HTML: Outlook treats <table> contents verbatim and does NOT apply Word's
  // default paragraph/font styles to descendants of <td>. The cell carries the
  // font-family fallback so any leaf that somehow lost its own style still
  // inherits from a sane parent.
  const tableStyle = `border-collapse:collapse;font-family:${FONT_FAMILY};color:${COLOR_BODY};`;
  const cellStyle = `padding:16px;font-family:${FONT_FAMILY};font-size:11pt;color:${COLOR_BODY};vertical-align:top;`;

  const body =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${tableStyle}">` +
    `<tr>` +
    `<td style="${cellStyle}">` +
    headerHtml +
    BLANK +
    subheaderHtml +
    indexHtml +
    BLANK +
    teamHtml +
    BLANK +
    sectionsHtml +
    `</td>` +
    `</tr>` +
    `</table>`;

  // Full document - kept for the .eml path. For the clipboard path, Chrome
  // converts to CF_HTML and the <html>/<head>/<body> wrapper is dropped (only
  // the fragment inside <body> survives, which is exactly the table).
  return (
    '<html><head><meta charset="utf-8"></head>' +
    `<body style="font-family:${FONT_FAMILY};color:${COLOR_BODY};background:#ffffff;margin:0;padding:0;">` +
    body +
    "</body></html>"
  );
}
