// Authenticated session layer for Brasil Energia (brasilenergia.com.br).
//
// Brasil Energia is an ASP.NET Core site behind a subscriber paywall. Anonymous
// requests still return HTTP 200, but article bodies are truncated and the page
// carries a login link plus "conteúdo exclusivo / assinante" markers. With a
// paying account we log in, obtain the `be-auth` session cookie, and build a
// Cookie header for subsequent article fetches.
//
// This is a TypeScript port of the verified Python reference
// (news-hunter-scanner/news_hunter/brasilenergia_auth.py). It runs in the
// Node.js runtime of the clipping scrape route (route declares
// `export const runtime = "nodejs"`).
//
// IMPORTANT — transport: brasilenergia.com.br sits behind Cloudflare, which
// fingerprints the TLS ClientHello and 403s Node's built-in fetch (undici)
// while letting a real Chrome fingerprint through (this is exactly why the
// scrape cascade uses curl-impersonate). So the login flow goes through the
// bundled curl-impersonate chrome131 binary when available (Vercel/Linux), and
// only falls back to global `fetch` (reading Set-Cookie via
// `response.headers.getSetCookie()`, Node 18+) on dev environments where the
// ELF binary can't run. On a dev box the fetch path is typically Cloudflare-
// blocked — that's expected; production runs on Linux with the binary.
//
// Login flow (reverse-engineered against the live site, 2026-06-10):
//
//   1. GET  /login?ReturnUrl=%2F
//        -> sets `.AspNetCore.Antiforgery.*` + `be_uuid` cookies
//        -> the login <form> (POST, same URL) carries a hidden
//           `__RequestVerificationToken` field.
//   2. POST /login?ReturnUrl=%2F  (application/x-www-form-urlencoded; no redirect)
//        fields: Tipo=login, g-recaptcha-response="" (the server accepts an empty
//                reCAPTCHA token for this account), LoginForm.Email,
//                LoginForm.Password, LoginForm.AcceptTerms=true, and the
//                __RequestVerificationToken read from step 1. Sends back the
//                antiforgery cookies from step 1.
//        success -> HTTP 302 to ReturnUrl + Set-Cookie `be-auth` (the session).
//        failure -> HTTP 200 re-rendering the form, no `be-auth` cookie.
//
// Credentials come ONLY from the environment (BRASIL_ENERGIA_USER /
// BRASIL_ENERGIA_PASS). If absent, the layer disables itself and callers fall
// back gracefully. Never hardcode the credentials.
//
// A module-level cache (with a TTL) lets a warm lambda reuse the logged-in
// Cookie header across invocations instead of logging in every time.

import { curlImpersonateRequest } from "./fetch";

const BASE_URL = "https://brasilenergia.com.br";
const LOGIN_URL = `${BASE_URL}/login?ReturnUrl=%2F`;
const AUTH_COOKIE = "be-auth";

// Cached Cookie header is considered fresh for this long after a successful
// login. Short enough that an expired upstream session self-heals soon; long
// enough to avoid re-login on every warm-lambda invocation.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Substrings whose presence in a 200 body means the page is logged-out /
// paywalled (i.e. the session is missing or expired). Lowercased compare.
const LOGGED_OUT_MARKERS = [
  "/login?returnurl",
  "conteúdo exclusivo",
  "exclusivo para assinantes",
] as const;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Brotli is intentionally NOT advertised — keep parity with the Python layer
// (an undecoded `br` body parses as an empty page silently).
const BASE_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate",
};

// ---------------------------------------------------------------------------
// Module-level cache (warm-lambda reuse)
// ---------------------------------------------------------------------------

interface CachedSession {
  cookieHeader: string;
  expiresAt: number; // epoch ms
}

let cached: CachedSession | null = null;
// De-dupes concurrent login attempts within the same process (one batch can
// have several Brasil Energia URLs resolving cookies at once).
let inFlight: Promise<string | null> | null = null;

/** Domain helper — true for the brasilenergia.com.br apex and www host. */
export function isBrasilEnergiaDomain(domain: string): boolean {
  const d = (domain || "").toLowerCase().replace(/^www\./, "");
  return d === "brasilenergia.com.br";
}

/** Invalidate the cached session so the next call performs a fresh login. */
export function invalidateBrasilEnergiaSession(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Set-Cookie header line into { name, value }. Returns null when the
 * line has no `name=value` pair. Only the first segment (before the first `;`)
 * is the cookie pair; the rest are attributes (Path, Expires, HttpOnly, ...).
 */
function parseSetCookie(line: string): { name: string; value: string } | null {
  const firstSemi = line.indexOf(";");
  const pair = firstSemi === -1 ? line : line.slice(0, firstSemi);
  const eq = pair.indexOf("=");
  if (eq === -1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;
  return { name, value };
}

/**
 * Merge raw Set-Cookie header lines into a cookie map (last write wins).
 * A cookie with an empty value (deletion) removes the entry.
 */
function applySetCookieLines(jar: Map<string, string>, lines: string[]): void {
  for (const line of lines) {
    const parsed = parseSetCookie(line);
    if (!parsed) continue;
    if (parsed.value === "") {
      jar.delete(parsed.name);
    } else {
      jar.set(parsed.name, parsed.value);
    }
  }
}

/** Read Set-Cookie lines off a fetch Response (Node 18+ getSetCookie). */
function getSetCookieLines(response: Response): string[] {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
}

/** Build a `Cookie:` request header from a cookie map. */
function buildCookieHeaderFromJar(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Extract the hidden anti-forgery token from the login form HTML.
 * Handles both attribute orders:
 *   <input name="__RequestVerificationToken" ... value="TOKEN" ...>
 *   <input ... value="TOKEN" ... name="__RequestVerificationToken">
 */
function readRequestVerificationToken(html: string): string | null {
  // Order A: name before value.
  const a = html.match(
    /name="__RequestVerificationToken"[^>]*?\bvalue="([^"]+)"/i,
  );
  if (a?.[1]) return a[1];
  // Order B: value before name.
  const b = html.match(
    /\bvalue="([^"]+)"[^>]*?name="__RequestVerificationToken"/i,
  );
  if (b?.[1]) return b[1];
  return null;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

// Minimal HTTP response shape both transports normalize to.
interface HttpResult {
  ok: boolean;
  status: number;
  body: string;
  setCookies: string[];
}

/**
 * GET via curl-impersonate when the binary is available (Linux/Vercel), else
 * via global fetch (dev fallback — usually Cloudflare-blocked, but lets the
 * code path be exercised locally).
 */
async function httpGet(url: string, cookieHeader?: string): Promise<HttpResult> {
  const imp = await curlImpersonateRequest(url, {
    method: "GET",
    cookieHeader,
    followRedirects: true,
  });
  if (imp.detail !== "curl_impersonate_not_found") {
    return { ok: imp.ok, status: imp.status, body: imp.body, setCookies: imp.setCookies };
  }
  // Dev fallback: plain fetch.
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  const resp = await fetch(url, { method: "GET", headers, redirect: "follow" });
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, body, setCookies: getSetCookieLines(resp) };
}

/**
 * POST x-www-form-urlencoded WITHOUT following redirects (a 302 is success).
 * Same transport preference as httpGet.
 */
async function httpPostForm(
  url: string,
  body: string,
  cookieHeader: string,
): Promise<HttpResult> {
  const extraHeaders = {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: LOGIN_URL,
    Origin: BASE_URL,
  };
  const imp = await curlImpersonateRequest(url, {
    method: "POST",
    body,
    cookieHeader,
    extraHeaders,
    followRedirects: false,
  });
  if (imp.detail !== "curl_impersonate_not_found") {
    return { ok: imp.ok, status: imp.status, body: imp.body, setCookies: imp.setCookies };
  }
  // Dev fallback: plain fetch (redirect: manual to capture the 302 + Set-Cookie).
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...BASE_HEADERS, ...extraHeaders, Cookie: cookieHeader },
    body,
    redirect: "manual",
  });
  const respBody = await resp.text();
  return { ok: resp.ok, status: resp.status, body: respBody, setCookies: getSetCookieLines(resp) };
}

/**
 * Perform a fresh login against the live site. On success returns the full
 * `Cookie:` header (be-auth + antiforgery + be_uuid). Returns null on any
 * failure (callers fall back to the DB cookie).
 */
async function login(user: string, pass: string): Promise<string | null> {
  const jar = new Map<string, string>();

  // Step 1: GET the login page — capture antiforgery + be_uuid cookies and the
  // anti-forgery form token.
  let getResp: HttpResult;
  try {
    getResp = await httpGet(LOGIN_URL);
  } catch (e) {
    console.warn("[brasilEnergiaAuth] GET login page failed:", String(e));
    return null;
  }
  if (!getResp.ok) {
    console.warn(`[brasilEnergiaAuth] GET login page HTTP ${getResp.status}`);
    return null;
  }
  applySetCookieLines(jar, getResp.setCookies);

  const token = readRequestVerificationToken(getResp.body);
  if (!token) {
    console.warn(
      "[brasilEnergiaAuth] could not find __RequestVerificationToken on login page",
    );
    return null;
  }

  // Step 2: POST the credentials. Do NOT follow redirects — success is the 302
  // itself (the be-auth cookie rides on the redirect response's Set-Cookie).
  const form = new URLSearchParams();
  form.set("Tipo", "login");
  form.set("g-recaptcha-response", "");
  form.set("LoginForm.Email", user);
  form.set("LoginForm.Password", pass);
  form.set("LoginForm.AcceptTerms", "true");
  form.set("__RequestVerificationToken", token);

  let postResp: HttpResult;
  try {
    postResp = await httpPostForm(LOGIN_URL, form.toString(), buildCookieHeaderFromJar(jar));
  } catch (e) {
    console.warn("[brasilEnergiaAuth] login POST failed:", String(e));
    return null;
  }

  applySetCookieLines(jar, postResp.setCookies);

  // Success = a be-auth cookie is now present (the POST returns 302 to ReturnUrl;
  // a failed login re-renders the form as HTTP 200 with no be-auth cookie).
  if (!jar.has(AUTH_COOKIE)) {
    console.warn(
      `[brasilEnergiaAuth] login did not yield a ${AUTH_COOKIE} cookie ` +
        `(status ${postResp.status}) — check credentials`,
    );
    return null;
  }

  return buildCookieHeaderFromJar(jar);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a fresh, logged-in `Cookie:` header for Brasil Energia, logging in if
 * needed and caching the result for warm-lambda reuse.
 *
 * Returns null when credentials are absent (BRASIL_ENERGIA_USER /
 * BRASIL_ENERGIA_PASS) or when login fails — callers then fall back to the
 * manually-pasted DB cookie.
 *
 * @param forceRefresh  When true, ignore the cache and force a new login
 *                      (used by the scrape path to re-login once on a
 *                      logged-out response).
 */
export async function getBrasilEnergiaCookieHeader(
  forceRefresh = false,
): Promise<string | null> {
  if (forceRefresh) {
    cached = null;
  }

  // Serve from cache when fresh.
  if (cached && cached.expiresAt > Date.now()) {
    return cached.cookieHeader;
  }

  const user = (process.env.BRASIL_ENERGIA_USER ?? "").trim();
  const pass = (process.env.BRASIL_ENERGIA_PASS ?? "").trim();
  if (!user || !pass) {
    // Credentials not configured — disable the layer silently (callers fall back).
    return null;
  }

  // Collapse concurrent logins into a single in-flight request.
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const cookieHeader = await login(user, pass);
      if (cookieHeader) {
        cached = { cookieHeader, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      return cookieHeader;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Heuristic: does this response body look logged-out / paywalled?
 * Lets the scrape path decide whether to invalidate + re-login once.
 */
export function brasilEnergiaLooksLoggedOut(
  status: number,
  body: string,
): boolean {
  if (status === 401 || status === 403) return true;
  if (status !== 200) return false;
  const lower = body.toLowerCase();
  return LOGGED_OUT_MARKERS.some((m) => lower.includes(m));
}
