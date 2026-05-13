// Netscape HTTP Cookie File parsing utilities.
// Used by the scrape route to build Cookie headers for authenticated fetches.
// No Supabase imports here — keep this lib pure.

/**
 * A single parsed cookie entry.
 */
export interface ParsedCookie {
  domain: string;
  name: string;
  value: string;
  /** Unix timestamp (seconds). 0 = session cookie (no expiry). */
  expires: number;
}

/**
 * Parse a Netscape HTTP Cookie File string into cookie entries.
 * Lines starting with '#' or empty lines are ignored.
 * Expired cookies (expires < now) are filtered out.
 * Session cookies (expires === 0) are kept.
 *
 * Format per line (tab-separated, 7 fields):
 *   domain  includeSubdomains  path  secure  expires  name  value
 */
export function parseNetscapeCookies(text: string): ParsedCookie[] {
  const nowSecs = Math.floor(Date.now() / 1000);
  const result: ParsedCookie[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split("\t");
    if (parts.length < 7) continue;

    const [rawDomain, , , , expiresStr, name, ...valueParts] = parts;
    const value = valueParts.join("\t"); // value may contain tabs in theory
    const expires = parseInt(expiresStr, 10);

    if (!name || !rawDomain) continue;

    // Session cookie: expires === 0 → keep. Expired → skip.
    if (expires !== 0 && expires < nowSecs) continue;

    result.push({
      domain: rawDomain.replace(/^\./, "").toLowerCase(),
      name,
      value,
      expires,
    });
  }

  return result;
}

/**
 * Build a Cookie header string from a list of cookies.
 * Values that contain characters outside the safe set are percent-encoded.
 *
 * Returns "name1=value1; name2=value2; ..."
 */
export function buildCookieHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies
    .map(({ name, value }) => {
      // Encode values that contain control chars, semicolons, or commas.
      const safeValue = /[^\x21-\x7E]|[;,]/.test(value) ? encodeURIComponent(value) : value;
      return `${name}=${safeValue}`;
    })
    .join("; ");
}

/**
 * Return the canonical domain for a URL — strip leading 'www.' and lowercase.
 *
 * Examples:
 *   'https://www.valor.globo.com/artigo' → 'valor.globo.com'
 *   'https://brasilenergia.com.br/post'  → 'brasilenergia.com.br'
 */
export function canonicalDomain(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
