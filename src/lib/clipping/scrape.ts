// Port of clipinator.py lines 600–632: scrape() orchestrator.
// Ties together fetch → extract → clean → paywall-check → Wayback retry.

import { EXTRACTORS, SOURCE_NAMES } from "./sources";
import { extract } from "./extract";
import { cleanParagraphs, looksPaywalled } from "./clean";
import { fetchHtml, fetchHtmlViaCurl, fetchHtmlViaImpersonate, fetchFromWayback } from "./fetch";
import { fetchHtmlViaHeadless } from "./fetchHtmlViaHeadless";
import type { ScrapeResult, ScrapeDebug } from "./types";

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Scrape one URL and return a ScrapeResult.
 *
 * @param url          Article URL (must be in the EXTRACTORS allowlist).
 * @param signal       AbortController signal (caller sets a 12-second deadline).
 * @param manualBody   Optional manually-pasted article body text.
 * @param cookieHeader Optional Cookie header value resolved from clipping_cookies (by the route).
 * @param debug        When true, attaches a ScrapeDebug object to the result. Defaults to false.
 */
export async function scrape(
  url: string,
  signal: AbortSignal,
  manualBody?: string,
  cookieHeader?: string,
  debug = false,
): Promise<ScrapeResult> {
  const domain = getDomain(url);

  // SSRF guard: only process domains in the allowlist.
  if (!domain || !(domain in EXTRACTORS)) {
    return { url, status: "unknown_domain", error: `Domain not in allowlist: ${domain}` };
  }

  const source = SOURCE_NAMES[domain] ?? domain;

  // Tracks each fetcher name that was actually invoked (in order).
  // Populated throughout the cascade and merged into ScrapeDebug at return sites.
  const viaCascade: string[] = [];

  // Helper: merge viaCascade into an extract() debug object (if debug is on).
  function attachCascade(dbg: ScrapeDebug | undefined): ScrapeDebug | undefined {
    if (!dbg) return undefined;
    return { ...dbg, viaCascade };
  }

  // If the caller supplies a manual body, we still fetch the URL to extract <title>
  // (falls back to "" on failure), but body paragraphs come from manualBody — no body scraping.
  if (manualBody) {
    viaCascade.push("undici");
    const { title } = await (async () => {
      const fetched = await fetchHtml(url, signal, cookieHeader);
      if (fetched.ok) return extract(fetched.html, domain, false);
      return { title: "", paragraphs: [] };
    })();

    // Split manual body into paragraphs (double newline or single newline).
    let chunks = manualBody.trim().split(/\n\s*\n+/);
    if (chunks.length === 1) {
      chunks = manualBody
        .trim()
        .split("\n")
        .filter((c) => c.trim());
    }
    const paragraphs = cleanParagraphs(chunks.map((c) => c.trim()).filter(Boolean));

    if (!paragraphs.length) {
      return { url, status: "error", error: "Manual body yielded no paragraphs after cleaning." };
    }

    return {
      url,
      status: "ok",
      item: { url, source, title: title || url, paragraphs },
    };
  }

  // Normal path: fetch → extract.
  viaCascade.push("undici");
  const fetchResult = await fetchHtml(url, signal, cookieHeader);

  if (!fetchResult.ok) {
    // Live fetch failed (403, network error, Cloudflare TLS block, timeout).
    // Cascade: plain curl → curl-impersonate → Wayback Machine.
    // Paywall is NOT retried via curl — if the site returned a gate page over undici,
    // any curl variant would return the same gate. Wayback is the only paywall fallback.
    const undiciDetail = fetchResult.detail ?? "undici_failed";

    // Step 1: plain static curl — covers most sites (BE Globo, etc.).
    viaCascade.push("curl");
    const curlResult = await fetchHtmlViaCurl(url, signal, cookieHeader);
    if (curlResult.ok) {
      try {
        const curlExtracted = extract(curlResult.html, domain, debug);
        const curlParagraphs = curlExtracted.paragraphs;
        if (!looksPaywalled(curlParagraphs) && curlParagraphs.length > 0) {
          const title = curlExtracted.title;
          if (!title) {
            return { url, status: "error", error: "Could not extract article title (via curl).", via: "curl", debug: attachCascade(curlExtracted.debug) };
          }
          return { url, status: "ok", item: { url, source, title, paragraphs: curlParagraphs }, via: "curl", debug: attachCascade(curlExtracted.debug) };
        }
        // plain curl got a paywall page — skip impersonate, go to Wayback.
        viaCascade.push("wayback");
        const wbResultPaywall = await fetchFromWayback(url, signal);
        if (wbResultPaywall.ok) {
          try {
            const wbEx = extract(wbResultPaywall.html, domain, debug);
            if (!looksPaywalled(wbEx.paragraphs) && wbEx.paragraphs.length > 0) {
              const title = wbEx.title;
              if (!title) return { url, status: "error", error: "Could not extract article title (via Wayback).", via: "wayback", via_wayback: true, debug: attachCascade(wbEx.debug) };
              return { url, status: "ok", item: { url, source, title, paragraphs: wbEx.paragraphs }, via: "wayback", via_wayback: true, debug: attachCascade(wbEx.debug) };
            }
          } catch { /* fall through */ }
        }
        const wbD = (!wbResultPaywall.ok && wbResultPaywall.detail) ? wbResultPaywall.detail : "no_snapshot";
        return { url, status: "fetch_failed", error: `undici: ${undiciDetail}; curl: paywall; curl_impersonate: skipped; wayback: ${wbD}`, debug: debug ? { selectorUsed: null, containerHtmlByteSize: 0, pCountRaw: 0, pCountAfterStripNoise: 0, pCountAfterClean: 0, noiseRemovedSamples: [], viaCascade } : undefined };
      } catch {
        // curl extract threw — fall through to impersonate.
      }
    }
    const curlDetail = (!curlResult.ok && curlResult.detail) ? curlResult.detail : "curl_failed";

    // Step 2: curl-impersonate chrome131 — full TLS fingerprint, covers Cloudflare / Investing.com.
    viaCascade.push("curl_impersonate");
    const impResult = await fetchHtmlViaImpersonate(url, signal, cookieHeader);
    if (impResult.ok) {
      try {
        const impExtracted = extract(impResult.html, domain, debug);
        const impParagraphs = impExtracted.paragraphs;
        if (!looksPaywalled(impParagraphs) && impParagraphs.length > 0) {
          const title = impExtracted.title;
          if (!title) {
            return { url, status: "error", error: "Could not extract article title (via curl-impersonate).", via: "curl_impersonate", debug: attachCascade(impExtracted.debug) };
          }
          return { url, status: "ok", item: { url, source, title, paragraphs: impParagraphs }, via: "curl_impersonate", debug: attachCascade(impExtracted.debug) };
        }
        // impersonate got a paywall page — Wayback is last resort.
      } catch {
        // impersonate extract failed — fall through to Wayback.
      }
    }
    const impDetail = (!impResult.ok && impResult.detail) ? impResult.detail : "curl_impersonate_failed";

    // Step 3: headless browser (playwright-core + @sparticuz/chromium).
    // Executes JavaScript — passes Cloudflare JS challenge that TLS impersonation alone can't.
    // Paywall logic: same as impersonate — if headless gets a paywall page, skip to Wayback.
    viaCascade.push("headless");
    const headlessResult = await fetchHtmlViaHeadless(url, signal, cookieHeader);
    if (headlessResult.ok) {
      try {
        const headlessExtracted = extract(headlessResult.html, domain, debug);
        const headlessParagraphs = headlessExtracted.paragraphs;
        if (!looksPaywalled(headlessParagraphs) && headlessParagraphs.length > 0) {
          const title = headlessExtracted.title;
          if (!title) {
            return { url, status: "error", error: "Could not extract article title (via headless).", via: "headless", debug: attachCascade(headlessExtracted.debug) };
          }
          return { url, status: "ok", item: { url, source, title, paragraphs: headlessParagraphs }, via: "headless", debug: attachCascade(headlessExtracted.debug) };
        }
        // headless got a paywall page — Wayback is last resort.
      } catch {
        // headless extract failed — fall through to Wayback.
      }
    }
    let headlessDetail: string;
    if (!headlessResult.ok) {
      headlessDetail = headlessResult.detail ?? "headless_failed_unknown";
    } else {
      // ok=true but paragraphs were empty or paywalled — browser loaded but got
      // a Cloudflare challenge page that didn't resolve, or a paywall fragment.
      headlessDetail = "headless_empty_or_paywall";
    }

    // Step 4: Wayback Machine.
    viaCascade.push("wayback");
    const wbResult = await fetchFromWayback(url, signal);
    if (wbResult.ok) {
      try {
        const wbExtracted = extract(wbResult.html, domain, debug);
        const wbParagraphs = wbExtracted.paragraphs;
        if (!looksPaywalled(wbParagraphs) && wbParagraphs.length > 0) {
          const title = wbExtracted.title;
          if (!title) {
            return { url, status: "error", error: "Could not extract article title (via Wayback).", via: "wayback", via_wayback: true, debug: attachCascade(wbExtracted.debug) };
          }
          return { url, status: "ok", item: { url, source, title, paragraphs: wbParagraphs }, via: "wayback", via_wayback: true, debug: attachCascade(wbExtracted.debug) };
        }
      } catch {
        // Wayback extract failed — fall through to fetch_failed.
      }
    }
    const wbDetail = (!wbResult.ok && wbResult.detail) ? wbResult.detail : "no_snapshot";
    return {
      url,
      status: "fetch_failed",
      error: `undici: ${undiciDetail}; curl: ${curlDetail}; curl_impersonate: ${impDetail}; headless: ${headlessDetail}; wayback: ${wbDetail}`,
      debug: debug ? { selectorUsed: null, containerHtmlByteSize: 0, pCountRaw: 0, pCountAfterStripNoise: 0, pCountAfterClean: 0, noiseRemovedSamples: [], viaCascade } : undefined,
    };
  }

  const extracted = extract(fetchResult.html, domain, debug);
  let { title, paragraphs } = extracted;
  let extractDebug = extracted.debug;

  // Paywall detected → try Wayback Machine once (not curl — paywall = site responded, curl would too).
  if (looksPaywalled(paragraphs)) {
    viaCascade.push("wayback");
    const wbResult = await fetchFromWayback(url, signal);
    if (wbResult.ok) {
      const wbExtracted = extract(wbResult.html, domain, debug);
      if (
        !looksPaywalled(wbExtracted.paragraphs) &&
        wbExtracted.paragraphs.length > paragraphs.length
      ) {
        paragraphs = wbExtracted.paragraphs;
        if (wbExtracted.title) title = wbExtracted.title;
        // Use Wayback extract debug (more informative — it's the content we actually kept).
        if (wbExtracted.debug) extractDebug = wbExtracted.debug;
        // Mark via when we actually used the Wayback content.
        if (!looksPaywalled(paragraphs)) {
          if (!title) {
            return { url, status: "error", error: "Could not extract article title.", debug: attachCascade(extractDebug) };
          }
          return {
            url,
            status: "ok",
            item: { url, source, title, paragraphs },
            via: "wayback",
            via_wayback: true,
            debug: attachCascade(extractDebug),
          };
        }
      }
    }
  }

  // Still looks paywalled after Wayback attempt.
  if (looksPaywalled(paragraphs)) {
    return {
      url,
      status: "paywall",
      error: "Content appears to be behind a paywall. Paste the article body manually.",
      // Return whatever title we got so the UI can display it.
      item: title ? { url, source, title, paragraphs: [] } : undefined,
      debug: attachCascade(extractDebug),
    };
  }

  if (!title) {
    return { url, status: "error", error: "Could not extract article title.", debug: attachCascade(extractDebug) };
  }

  return {
    url,
    status: "ok",
    item: { url, source, title, paragraphs },
    debug: attachCascade(extractDebug),
  };
}
