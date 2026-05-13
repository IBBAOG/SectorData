// Hand-rolled RFC 5322 multipart/alternative MIME builder.
// Port of clipinator.py lines 742–753: build_eml().
// No nodemailer — produces a Uint8Array ready for download as .eml.
// Runs client-side (browser).

import type { ClippingItem } from "./types";
import { buildHtml } from "./buildHtml";
import { buildPlainText } from "./buildPlainText";
import { formatDateHeader } from "./buildHtml";

const BOUNDARY = "----=_Part_IBBA_ClippingBoundary_001";

function encodeUtf8(s: string): string {
  // Encode a string so it's safe inside a MIME text part.
  // We use 8bit transfer encoding — email clients handle UTF-8 fine.
  return s;
}

export function buildEml(items: ClippingItem[], d: Date): Uint8Array {
  const subject = `*** IBBA Oil & Gas News – ${formatDateHeader(d)} ***`;
  const plain = buildPlainText(items, d);
  const html = buildHtml(items, d);

  const lines: string[] = [
    `MIME-Version: 1.0`,
    `Subject: ${subject}`,
    `From: `,
    `To: `,
    `Content-Type: multipart/alternative; boundary="${BOUNDARY}"`,
    ``,
    `--${BOUNDARY}`,
    `Content-Type: text/plain; charset="utf-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    encodeUtf8(plain),
    ``,
    `--${BOUNDARY}`,
    `Content-Type: text/html; charset="utf-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    encodeUtf8(html),
    ``,
    `--${BOUNDARY}--`,
    ``,
  ];

  const raw = lines.join("\r\n");
  return new TextEncoder().encode(raw);
}
