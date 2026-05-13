// Port of clipinator.py lines 373–496: fetchHtml + Wayback fallback.
// curl_cffi TLS impersonation: approximated via shell-out to bundled static curl (fetchHtmlViaCurl).
// curl uses a different TLS fingerprint than Node's undici, which Cloudflare accepts.
// On Vercel (Linux) we use vendor/curl-static-amd64 bundled via outputFileTracingIncludes.
// On dev (Windows/macOS) we fall back to the system curl in PATH.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { promises as fs } from "node:fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Resolve the curl binary path once per process lifetime.
// On Vercel (Linux) we use the bundled static binary; on dev we use system curl.
// ---------------------------------------------------------------------------
let _curlPathPromise: Promise<string> | null = null;

async function resolveCurlPath(): Promise<string> {
  if (_curlPathPromise) return _curlPathPromise;
  _curlPathPromise = (async (): Promise<string> => {
    if (process.platform !== "linux") {
      // Dev on Windows/macOS: rely on system curl in PATH.
      return "curl";
    }
    // Production on Vercel (Linux/x86_64): try bundled static binary first.
    const candidates = [
      // Next.js copies outputFileTracingIncludes relative to .next/server
      path.join(process.cwd(), ".next/server/vendor/curl-static-amd64"),
      path.join(process.cwd(), "vendor/curl-static-amd64"),
      // Vercel may also land the function root at /var/task
      "/var/task/.next/server/vendor/curl-static-amd64",
      "/var/task/vendor/curl-static-amd64",
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        // Ensure executable bit — Vercel may strip it on deploy.
        try { await fs.chmod(candidate, 0o755); } catch { /* read-only FS is fine */ }
        return candidate;
      } catch {
        continue;
      }
    }
    // Fallback: system curl (may not exist on Vercel minimal runtime).
    return "curl";
  })();
  return _curlPathPromise;
}

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
  | { ok: false; reason: "fetch_failed" | "paywall"; detail?: string };

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
    return { ok: false, reason: "fetch_failed", detail: "undici_network_error" };
  }

  if (resp.status === 403 || resp.status === 429 || resp.status === 401) {
    // Cloudflare / rate-limited — no TLS impersonation in Node; surface as failed.
    return { ok: false, reason: "fetch_failed", detail: `undici_http_${resp.status}` };
  }

  if (!resp.ok) {
    return { ok: false, reason: "fetch_failed", detail: `undici_http_${resp.status}` };
  }

  try {
    const html = await resp.text();
    return { ok: true, html };
  } catch {
    return { ok: false, reason: "fetch_failed", detail: "undici_body_read_error" };
  }
}

/**
 * Fetch HTML via bundled static curl instead of Node's undici fetch.
 * curl uses a different TLS ClientHello fingerprint that Cloudflare accepts even when
 * undici's fingerprint is rejected with 403.
 *
 * On Vercel (Linux) uses vendor/curl-static-amd64 bundled via outputFileTracingIncludes.
 * On dev (Windows/macOS) uses system curl from PATH.
 * Uses execFile (not exec) so url/cookieHeader are passed as array args — no shell injection.
 */
export async function fetchHtmlViaCurl(
  url: string,
  signal: AbortSignal,
  cookieHeader?: string,
): Promise<FetchResult> {
  const curlPath = await resolveCurlPath();

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
    const { stdout } = await execFileAsync(curlPath, args, {
      signal,
      maxBuffer: 10 * 1024 * 1024,     // 10 MB cap on body
      timeout: 22_000,
    });

    // Extract HTTP status from the appended marker.
    const statusMatch = stdout.match(/\n---STATUS:(\d+)$/);
    if (!statusMatch) return { ok: false, reason: "fetch_failed", detail: "curl_no_status_marker" };
    const status = parseInt(statusMatch[1], 10);
    const html = stdout.slice(0, statusMatch.index);

    if (status === 403 || status === 429 || status === 401) {
      return { ok: false, reason: "fetch_failed", detail: `curl_http_${status}` };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, reason: "fetch_failed", detail: `curl_http_${status}` };
    }
    return { ok: true, html };
  } catch (err) {
    // Binary not found (ENOENT), timeout, abort signal, or non-zero exit.
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code === "ENOENT" ? "curl_binary_not_found"
      : code === "ETIMEDOUT"        ? "curl_timeout"
      : `curl_exit_error`;
    return { ok: false, reason: "fetch_failed", detail };
  }
}

/** Try to retrieve the nearest Wayback Machine snapshot for a URL. */
export async function fetchFromWayback(url: string, signal: AbortSignal): Promise<FetchResult> {
  try {
    const lookupResp = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { headers: { "User-Agent": USER_AGENT }, signal },
    );
    if (!lookupResp.ok) return { ok: false, reason: "fetch_failed", detail: `wayback_lookup_http_${lookupResp.status}` };

    const data = (await lookupResp.json()) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } };
    };
    const snap = data.archived_snapshots?.closest;
    if (!snap?.available || !snap.url) return { ok: false, reason: "fetch_failed", detail: "wayback_no_snapshot" };

    // Append "id_" suffix so Wayback serves the raw page without its toolbar.
    let snapUrl = snap.url;
    if (!snapUrl.includes("id_")) snapUrl = snapUrl + "id_";

    const snapResp = await fetch(snapUrl, { headers: { "User-Agent": USER_AGENT }, signal });
    if (!snapResp.ok) return { ok: false, reason: "fetch_failed", detail: `wayback_snap_http_${snapResp.status}` };

    const html = await snapResp.text();
    return { ok: true, html };
  } catch {
    return { ok: false, reason: "fetch_failed", detail: "wayback_network_error" };
  }
}
