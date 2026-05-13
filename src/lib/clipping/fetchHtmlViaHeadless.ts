// Headless browser fetch layer — 4th tier in the cascade.
// Uses playwright-core + @sparticuz/chromium for serverless Chromium (~62 MB).
// Both modules are loaded dynamically to avoid cold-start penalty on routes that
// don't need the headless tier.
//
// Browser instance is cached module-level (browserPromise) and reused across
// requests in the same Lambda/Edge worker invocation. Each request gets its own
// BrowserContext so cookies and page state don't bleed between concurrent scrapes.

import type { FetchResult } from "./fetch";

// Module-level browser cache — shared across requests within one serverless instance.
let browserPromise: Promise<import("playwright-core").Browser> | null = null;

async function getBrowser(): Promise<import("playwright-core").Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core");
      const chromiumPkg = await import("@sparticuz/chromium");
      return chromium.launch({
        args: chromiumPkg.default.args,
        executablePath: await chromiumPkg.default.executablePath(),
        headless: true,
      });
    })();
  }
  return browserPromise;
}

/**
 * Fetch the HTML of a URL using a headless Chromium browser (playwright-core +
 * @sparticuz/chromium). Executes JavaScript, waits for Cloudflare challenges to
 * resolve, and blocks heavy resources (images, media, fonts, stylesheets) to
 * speed up page load.
 *
 * Cold-start: ~2s for first browser launch per Lambda instance; subsequent calls
 * reuse the cached browser (context is still fresh per call).
 *
 * @param url          Article URL to fetch.
 * @param signal       AbortController signal from the caller's per-URL deadline.
 * @param cookieHeader Optional Cookie header value (e.g. from clipping_cookies table).
 */
export async function fetchHtmlViaHeadless(
  url: string,
  signal: AbortSignal,
  cookieHeader?: string,
): Promise<FetchResult> {
  let context: import("playwright-core").BrowserContext | null = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "pt-BR",
      viewport: { width: 1280, height: 720 },
    });

    if (cookieHeader) {
      const { canonicalDomain } = await import("./cookies");
      const domain = canonicalDomain(url);
      const cookies = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const eq = c.indexOf("=");
          if (eq < 0) return null;
          return {
            name: c.slice(0, eq).trim(),
            value: c.slice(eq + 1).trim(),
            domain: "." + domain,
            path: "/",
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (cookies.length > 0) await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // NOTE: Resource blocking intentionally removed.
    // Cloudflare's JS challenge sometimes inspects whether sub-resources load;
    // blocking images/fonts/stylesheets can flag the request as non-browser and
    // prevent the challenge from resolving. Latency cost is acceptable given we
    // only reach headless after undici + curl + curl-impersonate have all failed.

    const response = await page.goto(url, {
      // "networkidle" lets Cloudflare's challenge JS complete its network activity
      // (XHR/fetch calls used to verify the browser) before we capture HTML.
      waitUntil: "networkidle",
      timeout: 25_000,
    });

    // Detect Cloudflare (or similar) JS challenge pages.
    const challengeStatus = response != null && [403, 429, 503].includes(response.status());
    let title = "";
    try {
      title = await page.title();
    } catch { /* ignore — page may not be ready */ }
    const challengeTitle = /just a moment|checking your browser|please wait|cloudflare/i.test(title);

    if (challengeStatus || challengeTitle) {
      // Challenges typically resolve in 5-8s. Wait up to 12s for the title to clear.
      try {
        await page.waitForFunction(
          () => !/just a moment|checking your browser/i.test(document.title),
          { timeout: 12_000, polling: 500 },
        );
      } catch {
        // Title never cleared — challenge did not resolve; return whatever HTML we have.
      }
    }

    // Brief hydration wait for article body lazy-loaded by JS on normal pages.
    await page.waitForTimeout(1000);

    const html = await page.content();
    return { ok: true, html };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, reason: "fetch_failed", detail: "headless_aborted" };
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.toLowerCase().includes("timeout")) {
      return { ok: false, reason: "fetch_failed", detail: "headless_timeout" };
    }
    const sanitized = errMsg.slice(0, 60).replace(/[^a-z0-9_]/gi, "_");
    return { ok: false, reason: "fetch_failed", detail: `headless_error_${sanitized}` };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
