// Headless browser fetch layer — 4th tier in the cascade.
// Uses playwright-extra + puppeteer-extra-plugin-stealth + @sparticuz/chromium.
// playwright-extra wraps playwright-core's chromium launch with the stealth plugin,
// which overrides navigator.webdriver, chrome.runtime, navigator.plugins, languages,
// and other fingerprint signals inspected by Cloudflare Bot Management.
// Confirmed working against Cloudflare-protected sites (e.g. Investing.com, 3 runs ~14s each).
//
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
      // playwright-extra wraps playwright-core's chromium with the stealth plugin.
      // The stealth plugin (originally from puppeteer-extra) hides navigator.webdriver,
      // fixes chrome.runtime, normalizes navigator.plugins/languages, etc. — all signals
      // inspected by Cloudflare Bot Management to distinguish real browsers from headless ones.
      const { chromium } = await import("playwright-extra");
      const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;

      // Static imports of each evasion so the Next.js / Vercel bundler can trace them
      // at build time. playwright-extra's default behaviour is to require() each
      // dependency path dynamically at runtime, which the bundler cannot trace and
      // therefore omits from the deployment bundle — causing "Plugin dependency not found"
      // errors in production. Pre-registering with setDependencyResolution() replaces the
      // dynamic require() with a value we supply directly.
      //
      // The dependency path key MUST match what stealth's `dependencies` getter emits:
      //   `${plugin.name}/evasions/${evasionName}` → "stealth/evasions/<name>"
      // (plugin.name === "stealth" — see puppeteer-extra-plugin-stealth/index.js line 78)
      //
      // Reduced set: 9 evasions most critical for Cloudflare Bot Management bypass.
      const [
        EvasionWebdriver,
        EvasionLanguages,
        EvasionPlugins,
        EvasionVendor,
        EvasionRuntime,
        EvasionApp,
        EvasionUserAgent,
        EvasionWebgl,
        EvasionMedia,
      ] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/navigator.webdriver").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/navigator.languages").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/navigator.plugins").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/navigator.vendor").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/chrome.runtime").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/chrome.app").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/user-agent-override").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/webgl.vendor").then((m: any) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("puppeteer-extra-plugin-stealth/evasions/media.codecs").then((m: any) => m.default),
      ]);

      // Register each evasion module under the exact key the plugin's `dependencies`
      // getter emits. This bypasses dynamic require() at runtime — the bundler traces
      // the static import() literals above at build time and includes them in the bundle.
      const prefix = "stealth/evasions/";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugins = (chromium as any).plugins;
      plugins.setDependencyResolution(prefix + "navigator.webdriver", EvasionWebdriver);
      plugins.setDependencyResolution(prefix + "navigator.languages", EvasionLanguages);
      plugins.setDependencyResolution(prefix + "navigator.plugins", EvasionPlugins);
      plugins.setDependencyResolution(prefix + "navigator.vendor", EvasionVendor);
      plugins.setDependencyResolution(prefix + "chrome.runtime", EvasionRuntime);
      plugins.setDependencyResolution(prefix + "chrome.app", EvasionApp);
      plugins.setDependencyResolution(prefix + "user-agent-override", EvasionUserAgent);
      plugins.setDependencyResolution(prefix + "webgl.vendor", EvasionWebgl);
      plugins.setDependencyResolution(prefix + "media.codecs", EvasionMedia);

      // Configure the stealth plugin with only the 9 evasions registered above,
      // then attach it to chromium.
      const stealth = StealthPlugin();
      const keepEvasions = new Set([
        "navigator.webdriver",
        "navigator.languages",
        "navigator.plugins",
        "navigator.vendor",
        "chrome.runtime",
        "chrome.app",
        "user-agent-override",
        "webgl.vendor",
        "media.codecs",
      ]);
      for (const e of [...stealth.enabledEvasions]) {
        if (!keepEvasions.has(e)) stealth.enabledEvasions.delete(e);
      }
      chromium.use(stealth);

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
    const sanitized = errMsg.slice(0, 200).replace(/[^a-z0-9_]/gi, "_");
    return { ok: false, reason: "fetch_failed", detail: `headless_error_${sanitized}` };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
