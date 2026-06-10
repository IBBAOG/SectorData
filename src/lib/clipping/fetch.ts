// Port of clipinator.py lines 373–496: fetchHtml + Wayback fallback.
// Dual-binary cascade:
//   1. fetchHtmlViaCurl  — plain static curl 8.20.0 (10 MB musl). Passes most sites
//      including BE Globo that plain undici fails on. Sends manual -A/-H headers.
//   2. fetchHtmlViaImpersonate — curl-impersonate chrome131 (4 MB + wrapper). Full Chrome 131
//      TLS fingerprint + browser headers — Cloudflare / Investing.com accept it.
//      NOT used if plain curl succeeded; NOT used if paywall (impersonate would see same gate).
// On Vercel (Linux) both binaries are bundled via outputFileTracingIncludes.
// On dev (Windows/macOS) both fall back gracefully: plain curl to "curl" (system), impersonate returns null.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { promises as fs } from "node:fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Path resolution — each binary resolved once per process lifetime.
// ---------------------------------------------------------------------------

let _curlStaticPathPromise: Promise<string | null> | null = null;
let _curlImpersonatePathPromise: Promise<string | null> | null = null;

/**
 * Resolve path to the plain static curl binary (curl-static-amd64).
 * On Linux (Vercel): checks vendor/curl-static-amd64 in .next/server or cwd.
 * On non-Linux (dev): falls back to "curl" (system) so local testing still works.
 * Returns null only if non-Linux AND system curl is not wanted (we return "curl" there too).
 */
async function resolveCurlStaticPath(): Promise<string | null> {
  if (_curlStaticPathPromise) return _curlStaticPathPromise;
  _curlStaticPathPromise = (async (): Promise<string | null> => {
    if (process.platform !== "linux") {
      // Dev on Windows/macOS: use system curl (no TLS impersonation, but still useful).
      return "curl";
    }
    // Vercel (Linux): try bundled static binary first.
    const candidates = [
      path.join(process.cwd(), ".next/server/vendor/curl-static-amd64"),
      path.join(process.cwd(), "vendor/curl-static-amd64"),
      "/var/task/.next/server/vendor/curl-static-amd64",
      "/var/task/vendor/curl-static-amd64",
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        try { await fs.chmod(candidate, 0o755); } catch { /* read-only FS is fine */ }
        return candidate;
      } catch {
        continue;
      }
    }
    // Fallback: system curl (may not exist on Vercel minimal runtime).
    return "curl";
  })();
  return _curlStaticPathPromise;
}

/**
 * Resolve path to the curl-impersonate chrome131 wrapper.
 * On Linux (Vercel): checks vendor/curl_chrome131 in .next/server or cwd.
 *   Also chmods the companion curl-impersonate binary in the same directory.
 * On non-Linux (dev): returns null — impersonate is Linux-only (ELF binary).
 */
async function resolveCurlImpersonatePath(): Promise<string | null> {
  if (_curlImpersonatePathPromise) return _curlImpersonatePathPromise;
  _curlImpersonatePathPromise = (async (): Promise<string | null> => {
    if (process.platform !== "linux") {
      // Dev on Windows/macOS: impersonate binary is ELF — not runnable here.
      return null;
    }
    const candidates = [
      path.join(process.cwd(), ".next/server/vendor/curl_chrome131"),
      path.join(process.cwd(), "vendor/curl_chrome131"),
      "/var/task/.next/server/vendor/curl_chrome131",
      "/var/task/vendor/curl_chrome131",
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        try { await fs.chmod(candidate, 0o755); } catch { /* read-only FS is fine */ }
        // Also chmod the companion ELF binary in the same dir.
        try {
          const dir = path.dirname(candidate);
          await fs.chmod(path.join(dir, "curl-impersonate"), 0o755);
        } catch { /* best-effort */ }
        return candidate;
      } catch {
        continue;
      }
    }
    return null;
  })();
  return _curlImpersonatePathPromise;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// fetchHtml — undici (Node built-in fetch)
// ---------------------------------------------------------------------------

/**
 * Fetch the HTML of a URL via Node's built-in undici fetch.
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
    return { ok: false, reason: "fetch_failed", detail: "undici_network_error" };
  }

  if (resp.status === 403 || resp.status === 429 || resp.status === 401) {
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

// ---------------------------------------------------------------------------
// fetchHtmlViaCurl — plain static curl (curl-static-amd64, musl 8.20.0)
// ---------------------------------------------------------------------------

/**
 * Fetch HTML via the bundled plain static curl binary.
 * Sends manual -A / -H browser headers (same as DEFAULT_HEADERS).
 * Covers most sites (BE Globo, Reuters, etc.) that reject undici's TLS fingerprint
 * but don't do deep bot-detection fingerprinting.
 *
 * Detail strings use the "curl_*" prefix.
 */
export async function fetchHtmlViaCurl(
  url: string,
  signal: AbortSignal,
  cookieHeader?: string,
): Promise<FetchResult> {
  const curlPath = await resolveCurlStaticPath();
  if (!curlPath) {
    return { ok: false, reason: "fetch_failed", detail: "curl_binary_not_found" };
  }

  const args = [
    "-sS",
    "--max-time", "20",
    "-w", "\n---STATUS:%{http_code}",
    "-L",
    // Plain curl always needs manual headers (no wrapper injecting them).
    "-A", USER_AGENT,
    "-H", `Accept: ${DEFAULT_HEADERS.Accept}`,
    "-H", `Accept-Language: ${DEFAULT_HEADERS["Accept-Language"]}`,
    "-H", `Referer: ${DEFAULT_HEADERS.Referer}`,
  ];

  if (cookieHeader) {
    args.push("-H", `Cookie: ${cookieHeader}`);
  }
  args.push(url);

  try {
    const { stdout } = await execFileAsync(curlPath, args, {
      signal,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 22_000,
    });

    const statusMatch = stdout.match(/\n---STATUS:(\d+)$/);
    if (!statusMatch) return { ok: false, reason: "fetch_failed", detail: "curl_no_status_marker" };
    const status = parseInt(statusMatch[1], 10);
    const html = stdout.slice(0, statusMatch.index);

    if (status >= 400) {
      return { ok: false, reason: "fetch_failed", detail: `curl_http_${status}` };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, reason: "fetch_failed", detail: `curl_http_${status}` };
    }
    return { ok: true, html };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code === "ENOENT"   ? "curl_binary_not_found"
      : code === "ETIMEDOUT"           ? "curl_timeout"
      : `curl_exit_${(err as NodeJS.ErrnoException & { exitCode?: number }).exitCode ?? "unknown"}`;
    return { ok: false, reason: "fetch_failed", detail };
  }
}

// ---------------------------------------------------------------------------
// fetchHtmlViaImpersonate — curl-impersonate chrome131
// ---------------------------------------------------------------------------

/**
 * Fetch HTML via the bundled curl-impersonate chrome131 binary.
 * The curl_chrome131 wrapper injects the full Chrome 131 TLS fingerprint:
 * ciphers, curves, extensions, HTTP/2 settings, and all browser request headers.
 * Cloudflare and Investing.com accept it even when plain curl gets 403.
 *
 * Does NOT send manual -A / -H — the wrapper already injects them.
 * Cookie header is still passed (our domain-specific cookies).
 * Returns null-path as fetch_failed on non-Linux dev environments.
 *
 * Detail strings use the "curl_impersonate_*" prefix.
 */
export async function fetchHtmlViaImpersonate(
  url: string,
  signal: AbortSignal,
  cookieHeader?: string,
): Promise<FetchResult> {
  const curlPath = await resolveCurlImpersonatePath();
  if (!curlPath) {
    return { ok: false, reason: "fetch_failed", detail: "curl_impersonate_not_found" };
  }

  const args = [
    "-sS",
    "--max-time", "20",
    "-w", "\n---STATUS:%{http_code}",
    "-L",
    // Intentionally no -A / -H Accept* / -H Referer — curl_chrome131 wrapper injects them.
  ];

  if (cookieHeader) {
    args.push("-H", `Cookie: ${cookieHeader}`);
  }
  args.push(url);

  try {
    const { stdout } = await execFileAsync(curlPath, args, {
      signal,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 22_000,
    });

    const statusMatch = stdout.match(/\n---STATUS:(\d+)$/);
    if (!statusMatch) return { ok: false, reason: "fetch_failed", detail: "curl_impersonate_no_status_marker" };
    const status = parseInt(statusMatch[1], 10);
    const html = stdout.slice(0, statusMatch.index);

    if (status >= 400) {
      return { ok: false, reason: "fetch_failed", detail: `curl_impersonate_http_${status}` };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, reason: "fetch_failed", detail: `curl_impersonate_http_${status}` };
    }
    return { ok: true, html };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code === "ENOENT"   ? "curl_impersonate_not_found"
      : code === "ETIMEDOUT"           ? "curl_impersonate_timeout"
      : `curl_impersonate_exit_${(err as NodeJS.ErrnoException & { exitCode?: number }).exitCode ?? "unknown"}`;
    return { ok: false, reason: "fetch_failed", detail };
  }
}

// ---------------------------------------------------------------------------
// curlImpersonateRequest — low-level Chrome-fingerprint request (GET/POST)
// ---------------------------------------------------------------------------

export interface ImpersonateResponse {
  ok: boolean;
  status: number;
  body: string;
  /** Raw Set-Cookie header lines from the response (may be empty). */
  setCookies: string[];
  detail?: string;
}

/**
 * Perform a single HTTP request through curl-impersonate chrome131, exposing
 * the status code, body, and Set-Cookie lines. Unlike fetchHtmlViaImpersonate,
 * this does NOT follow redirects by default and supports POST bodies + an
 * inbound Cookie string — it's used by the Brasil Energia login flow, which
 * needs to read antiforgery/be-auth cookies off the response and treat a 302
 * as success.
 *
 * Returns ok=false with detail "curl_impersonate_not_found" on non-Linux dev
 * environments (the ELF binary can't run there) so callers can fall back.
 */
export async function curlImpersonateRequest(
  url: string,
  opts: {
    method?: "GET" | "POST";
    body?: string;
    cookieHeader?: string;
    extraHeaders?: Record<string, string>;
    followRedirects?: boolean;
    signal?: AbortSignal;
    timeoutSecs?: number;
  } = {},
): Promise<ImpersonateResponse> {
  // Prefer the plain static curl binary: it already passes brasilenergia.com.br's
  // Cloudflare check in production (the scrape cascade's "curl" hop reaches the
  // origin) and is the transport the Brasil Energia login was verified against.
  // The impersonate (chrome131) wrapper is only a fallback — on Vercel it is not
  // always traced into this function's bundle, which would otherwise drop the
  // login down to undici (Cloudflare-403'd) and silently fail. resolveCurlStaticPath
  // returns "curl" on dev, so local testing still works.
  const curlPath =
    (await resolveCurlStaticPath()) ?? (await resolveCurlImpersonatePath());
  if (!curlPath) {
    return { ok: false, status: 0, body: "", setCookies: [], detail: "curl_impersonate_not_found" };
  }

  const {
    method = "GET",
    body,
    cookieHeader,
    extraHeaders = {},
    followRedirects = false,
    signal,
    timeoutSecs = 20,
  } = opts;

  // -D - dumps response headers (incl. Set-Cookie) to stdout before the body.
  const args = [
    "-sS",
    "--max-time", String(timeoutSecs),
    "-D", "-",
    "-w", "\n---STATUS:%{http_code}",
  ];
  if (followRedirects) args.push("-L");
  if (method === "POST") {
    args.push("-X", "POST");
    if (body !== undefined) args.push("--data-raw", body);
  }
  if (cookieHeader) args.push("-H", `Cookie: ${cookieHeader}`);
  for (const [k, v] of Object.entries(extraHeaders)) {
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);

  try {
    const { stdout } = await execFileAsync(curlPath, args, {
      signal,
      maxBuffer: 10 * 1024 * 1024,
      timeout: (timeoutSecs + 2) * 1000,
    });

    const statusMatch = stdout.match(/\n---STATUS:(\d+)$/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const withoutMarker = statusMatch ? stdout.slice(0, statusMatch.index) : stdout;

    // Split the dumped header block(s) from the body. With -D -, each response
    // (one per redirect hop) emits its headers followed by a blank line, then
    // the body. Collect Set-Cookie from every hop; the body is everything after
    // the LAST header block.
    const setCookies: string[] = [];
    const lines = withoutMarker.split("\n");
    let bodyStart = 0;
    let inHeaders = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^HTTP\/\d/.test(line)) {
        inHeaders = true;
        continue;
      }
      if (inHeaders) {
        if (line.replace(/\r$/, "") === "") {
          inHeaders = false;
          bodyStart = i + 1;
          continue;
        }
        const m = line.match(/^set-cookie:\s*(.*)$/i);
        if (m) setCookies.push(m[1].replace(/\r$/, ""));
      }
    }
    const respBody = lines.slice(bodyStart).join("\n");

    return { ok: status >= 200 && status < 400, status, body: respBody, setCookies };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail =
      code === "ENOENT" ? "curl_impersonate_not_found"
      : code === "ETIMEDOUT" ? "curl_impersonate_timeout"
      : `curl_impersonate_exit_${(err as NodeJS.ErrnoException & { exitCode?: number }).exitCode ?? "unknown"}`;
    return { ok: false, status: 0, body: "", setCookies: [], detail };
  }
}

// ---------------------------------------------------------------------------
// fetchFromWayback — Wayback Machine snapshot
// ---------------------------------------------------------------------------

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
