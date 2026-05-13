// Port of clipinator.py lines 373–496: fetchHtml + Wayback fallback.
// TLS impersonation: shell-out to curl-impersonate (lexiforest/curl-impersonate v1.1.0).
// curl_chrome131 wrapper sets Chrome 131 TLS ciphers/curves/extensions — Cloudflare accepts it.
// On Vercel (Linux) we use vendor/curl_chrome131 + vendor/curl-impersonate bundled via outputFileTracingIncludes.
// On dev (Windows/macOS) we fall back to the system curl in PATH (no impersonation).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { promises as fs } from "node:fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Resolve the curl-impersonate wrapper path once per process lifetime.
// On Vercel (Linux) we use vendor/curl_chrome131 (bash wrapper for curl-impersonate).
// On dev (Windows/macOS) we use system curl (no TLS impersonation).
// ---------------------------------------------------------------------------
let _curlPathPromise: Promise<string> | null = null;

async function resolveCurlImpersonatePath(): Promise<string> {
  if (_curlPathPromise) return _curlPathPromise;
  _curlPathPromise = (async (): Promise<string> => {
    if (process.platform !== "linux") {
      // Dev on Windows/macOS: rely on system curl in PATH (no impersonation).
      return "curl";
    }
    // Production on Vercel (Linux/x86_64): try bundled curl_chrome131 wrapper first.
    // The wrapper calls curl-impersonate (must be in same dir) with Chrome 131 TLS flags.
    const candidates = [
      // Next.js copies outputFileTracingIncludes relative to .next/server
      path.join(process.cwd(), ".next/server/vendor/curl_chrome131"),
      path.join(process.cwd(), "vendor/curl_chrome131"),
      // Vercel may also land the function root at /var/task
      "/var/task/.next/server/vendor/curl_chrome131",
      "/var/task/vendor/curl_chrome131",
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        // Ensure executable bit — Vercel may strip it on deploy.
        try { await fs.chmod(candidate, 0o755); } catch { /* read-only FS is fine */ }
        // Also chmod the companion binary in the same dir.
        try {
          const dir = path.dirname(candidate);
          await fs.chmod(path.join(dir, "curl-impersonate"), 0o755);
        } catch { /* best-effort */ }
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
 * Fetch HTML via curl-impersonate (Chrome 131 TLS fingerprint) instead of Node's undici.
 * curl_chrome131 wrapper injects Chrome 131 TLS ciphers/curves/extensions/HTTP2 settings
 * and all browser request headers — Cloudflare accepts it even when undici is rejected.
 *
 * On Vercel (Linux) uses vendor/curl_chrome131 wrapper + vendor/curl-impersonate binary,
 * bundled via outputFileTracingIncludes. On dev (Windows/macOS) falls back to system curl
 * (no impersonation — manual headers are added instead).
 * Uses execFile (not exec) so url/cookieHeader are passed as array args — no shell injection.
 */
export async function fetchHtmlViaCurl(
  url: string,
  signal: AbortSignal,
  cookieHeader?: string,
): Promise<FetchResult> {
  const curlPath = await resolveCurlImpersonatePath();

  // curl_chrome131 wrapper already injects User-Agent, Accept, Accept-Language,
  // sec-ch-ua-*, sec-fetch-*, Priority, and all Chrome 131 TLS parameters.
  // Only add manual headers when falling back to plain system curl (dev).
  const isImpersonate = curlPath.endsWith("curl_chrome131");

  const args = [
    "-sS",                              // silent + show errors
    "--max-time", "20",                 // hard timeout (seconds)
    "-w", "\n---STATUS:%{http_code}",   // append status code marker to stdout
    "-L",                               // follow redirects
  ];

  if (!isImpersonate) {
    // Dev local: plain curl needs manual headers to avoid bot detection.
    args.push(
      "-A", USER_AGENT,
      "-H", `Accept: ${DEFAULT_HEADERS.Accept}`,
      "-H", `Accept-Language: ${DEFAULT_HEADERS["Accept-Language"]}`,
      "-H", `Referer: ${DEFAULT_HEADERS.Referer}`,
    );
  }

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
    if (!statusMatch) return { ok: false, reason: "fetch_failed", detail: "curl_impersonate_no_status_marker" };
    const status = parseInt(statusMatch[1], 10);
    const html = stdout.slice(0, statusMatch.index);

    if (status >= 400 && status < 500) {
      return { ok: false, reason: "fetch_failed", detail: `curl_impersonate_http_${status}` };
    }
    if (status >= 500) {
      return { ok: false, reason: "fetch_failed", detail: `curl_impersonate_http_${status}` };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, reason: "fetch_failed", detail: `curl_impersonate_http_${status}` };
    }
    return { ok: true, html };
  } catch (err) {
    // Binary not found (ENOENT), timeout, abort signal, or non-zero exit.
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code === "ENOENT"   ? "curl_impersonate_not_found"
      : code === "ETIMEDOUT"           ? "curl_impersonate_timeout"
      : `curl_impersonate_exit_${(err as NodeJS.ErrnoException & { exitCode?: number }).exitCode ?? "unknown"}`;
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
