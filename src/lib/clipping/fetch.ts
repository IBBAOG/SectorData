// Port of clipinator.py lines 373–496: fetchHtml + Wayback fallback.
// curl_cffi TLS impersonation: approximated via shell-out to system curl (fetchHtmlViaCurl).
// curl uses a different TLS fingerprint than Node's undici, which Cloudflare accepts.
// If curl is not in PATH (ENOENT), fetchHtmlViaCurl returns { ok: false } silently.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

/**
 * Fetch the HTML of a URL, respecting the caller's AbortSignal.
 * @param cookieHeader  Optional pre-built Cookie header value (e.g. from clipping_cookies table).
 */
export async function fetchHtml(
  url: string,
  signal: AbortSignal,
  cookieHeader?: string,
): Promise<FetchResult> {
  let resp: Response;
  try {
    const headers: Record<string, string> = { ...DEFAULT_HEADERS };
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }
    resp = await fetch(url, { headers, signal, redirect: "follow" });
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

/**
 * Fetch HTML via system curl instead of Node's undici fetch.
 * curl uses a different TLS ClientHello fingerprint that Cloudflare accepts even when
 * undici's fingerprint is rejected with 403. Falls back gracefully if curl is not in PATH.
 *
 * Uses execFile (not exec) so url/cookieHeader are passed as array args — no shell injection.
 */
export async function fetchHtmlViaCurl(
  url: string,
  signal: AbortSignal,
  cookieHeader?: string,
): Promise<FetchResult> {
  const args = [
    "-sS",                              // silent + show errors
    "--max-time", "20",                 // hard timeout (seconds)
    "-A", USER_AGENT,
    "-H", `Accept: ${DEFAULT_HEADERS.Accept}`,
    "-H", `Accept-Language: ${DEFAULT_HEADERS["Accept-Language"]}`,
    "-H", `Referer: ${DEFAULT_HEADERS.Referer}`,
    "-w", "\n---STATUS:%{http_code}",   // append status code marker to stdout
    "-L",                               // follow redirects
  ];
  if (cookieHeader) {
    args.push("-H", `Cookie: ${cookieHeader}`);
  }
  args.push(url);

  try {
    const { stdout } = await execFileAsync("curl", args, {
      signal,
      maxBuffer: 10 * 1024 * 1024,     // 10 MB cap on body
      timeout: 22_000,
    });

    // Extract HTTP status from the appended marker.
    const statusMatch = stdout.match(/\n---STATUS:(\d+)$/);
    if (!statusMatch) return { ok: false, reason: "fetch_failed" };
    const status = parseInt(statusMatch[1], 10);
    const html = stdout.slice(0, statusMatch.index);

    if (status === 403 || status === 429 || status === 401) {
      return { ok: false, reason: "fetch_failed" };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, reason: "fetch_failed" };
    }
    return { ok: true, html };
  } catch {
    // curl missing (ENOENT), timeout, abort signal, or non-zero exit.
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
