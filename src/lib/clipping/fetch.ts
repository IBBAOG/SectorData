// Port of clipinator.py lines 373–496: fetchHtml + Wayback fallback.
// curl_cffi TLS impersonation is intentionally skipped — Node has no equivalent.
// 403 / Cloudflare-blocked sites surface as { ok: false } and rely on the manual-body UI.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  Referer: "https://www.google.com/",
};

export type FetchResult =
  | { ok: true; html: string }
  | { ok: false; reason: "fetch_failed" | "paywall" };

/** Fetch the HTML of a URL, respecting the caller's AbortSignal. */
export async function fetchHtml(url: string, signal: AbortSignal): Promise<FetchResult> {
  let resp: Response;
  try {
    resp = await fetch(url, { headers: DEFAULT_HEADERS, signal, redirect: "follow" });
  } catch {
    // Network error, timeout, or abort.
    return { ok: false, reason: "fetch_failed" };
  }

  if (resp.status === 403 || resp.status === 429 || resp.status === 401) {
    // Cloudflare / rate-limited — no TLS impersonation in Node; surface as failed.
    return { ok: false, reason: "fetch_failed" };
  }

  if (!resp.ok) {
    return { ok: false, reason: "fetch_failed" };
  }

  try {
    const html = await resp.text();
    return { ok: true, html };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}

/** Try to retrieve the nearest Wayback Machine snapshot for a URL. */
export async function fetchFromWayback(url: string, signal: AbortSignal): Promise<FetchResult> {
  try {
    const lookupResp = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { headers: { "User-Agent": USER_AGENT }, signal },
    );
    if (!lookupResp.ok) return { ok: false, reason: "fetch_failed" };

    const data = (await lookupResp.json()) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } };
    };
    const snap = data.archived_snapshots?.closest;
    if (!snap?.available || !snap.url) return { ok: false, reason: "fetch_failed" };

    // Append "id_" suffix so Wayback serves the raw page without its toolbar.
    let snapUrl = snap.url;
    if (!snapUrl.includes("id_")) snapUrl = snapUrl + "id_";

    const snapResp = await fetch(snapUrl, { headers: { "User-Agent": USER_AGENT }, signal });
    if (!snapResp.ok) return { ok: false, reason: "fetch_failed" };

    const html = await snapResp.text();
    return { ok: true, html };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}
