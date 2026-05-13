// Port of clipinator.py lines 639–723: build_html().
// Runs client-side (browser) — no Node-only APIs.
// Verbatim port: STYLE_BLOCK, _P, _P_CTR, _P_JUS, BLANK, TEAM_BLOCK, MONTH_EN, build_html.

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

const STYLE_BLOCK =
  "<style>" +
  'p.MsoNormal,li.MsoNormal,div.MsoNormal{margin:0;font-size:11.0pt;font-family:"Calibri",sans-serif;}' +
  "a:link{color:#0563C1;text-decoration:underline;}" +
  "a:visited{color:#954F72;text-decoration:underline;}" +
  "</style>";

const _P_BASE = "margin:0;font-size:11.0pt;font-family:'Calibri',sans-serif";
const _P = `<p class="MsoNormal" style="${_P_BASE}">`;
const _P_CTR = `<p class="MsoNormal" style="${_P_BASE};text-align:center">`;
const _P_JUS = `<p class="MsoNormal" style="${_P_BASE};text-align:justify">`;

// Exported so buildEml can reference it (unused _P_CTR kept to match Python source).
export { _P_CTR };

const BLANK = `${_P}&nbsp;</p>`;

// Hardcoded IBBA Oil & Gas Team block — verbatim from clipinator.py lines 659–670.
const TEAM_BLOCK =
  `${_P}<b><span style="color:#FF5000">Ita&uacute; BBA Oil &amp; Gas Team</span></b></p>` +
  `${_P_JUS}<b><span style="font-size:10.0pt;color:#000512">Monique Greco Natal /</span></b>&nbsp;` +
  '<a href="mailto:monique.greco@itaubba.com"><span style="font-size:10.0pt">monique.greco@itaubba.com</span></a>' +
  "</p>" +
  `${_P_JUS}<b><span style="font-size:10.0pt;color:#000512">Eric de Mello /</span></b>&nbsp;` +
  '<a href="mailto:eric.mello@itaubba.com"><span style="font-size:10.0pt">eric.mello@itaubba.com</span></a>' +
  "</p>" +
  `${_P_JUS}<b><span style="font-size:10.0pt;color:#000512">Eduardo Mendes /</span></b>&nbsp;` +
  '<a href="mailto:eduardo.mendes@itaubba.com"><span style="font-size:10.0pt">eduardo.mendes@itaubba.com</span></a>' +
  "</p>";

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

  const bulletsHtml = items
    .map(
      (item) =>
        `<li class="MsoNormal"><b>${esc(item.title)} (${esc(item.source)})</b></li>`,
    )
    .join("");
  const indexBlock = `<ul type="disc">${bulletsHtml}</ul>`;

  const sections = items.map((item) => {
    const titleHtml = `${_P}<b><span style="font-size:14.0pt">${esc(item.title)} (${esc(item.source)})</span></b></p>`;
    const bodyParts = item.paragraphs.map((par) => `${_P}${esc(par)}</p>`);
    const bodyHtml = bodyParts.join(BLANK);
    const sourceHtml =
      `${_P}<span style="color:black">Fonte:</span> ` +
      `<a href="${esc(item.url)}">${esc(item.url)}</a>` +
      "</p>";
    return titleHtml + BLANK + bodyHtml + BLANK + sourceHtml + BLANK;
  });

  const headerHtml =
    `<p class="MsoNormal" align="center" style="${_P_BASE};text-align:center">` +
    '<b><span style="font-size:18.0pt;color:#FF5000">' +
    `*** IBBA Oil &amp; Gas News – ${esc(dateText)} ***` +
    "</span></b></p>";

  const subheaderHtml = `${_P}<b><span style="font-size:14.0pt;color:#FF5000">Main Headlines</span></b></p>`;

  return (
    '<html><head><meta charset="utf-8">' +
    STYLE_BLOCK +
    "</head>" +
    '<body lang="EN-US" link="#0563C1" vlink="#954F72" style="word-wrap:break-word">' +
    '<div class="WordSection1">' +
    headerHtml +
    BLANK +
    subheaderHtml +
    indexBlock +
    BLANK +
    TEAM_BLOCK +
    BLANK +
    sections.join("") +
    "</div></body></html>"
  );
}
