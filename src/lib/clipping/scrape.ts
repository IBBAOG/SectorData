// Port of clipinator.py lines 600–632: scrape() orchestrator.
// Ties together fetch → extract → clean → paywall-check → Wayback retry.

import { EXTRACTORS, SOURCE_NAMES } from "./sources";
import { extract } from "./extract";
import { cleanParagraphs, looksPaywalled } from "./clean";
import { fetchHtml, fetchHtmlViaCurl, fetchHtmlViaImpersonate, fetchFromWayback } from "./fetch";
import type { ScrapeResult } from "./types";

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Scrape one URL and return a ScrapeResult.
 * @param url          Article URL (must be in the EXTRACTORS allowlist).
 * @param signal       AbortController signal (caller sets a 12-second deadline).
 * @param manualBody   Optional manually-pasted article body text.
 * @param cookieHeader Optional Cookie header value resolved from clipping_cookies (by the route).
 */
export async function scrape(
  url: string,
  signal: AbortSignal,
  manualBody?: string,
  cookieHeader?: string,
): Promise<ScrapeResult> {
  const domain = getDomain(url);

  // SSRF guard: only process domains in the allowlist.
  if (!domain || !(domain in EXTRACTORS)) {
    return { url, status: "unknown_domain", error: `Domain not in allowlist: ${domain}` };
  }

  const source = SOURCE_NAMES[domain] ?? domain;

  // If the caller supplies a manual body, we still fetch the URL to extract <title>
  // (falls back to "" on failure), but body paragraphs come from manualBody — no body scraping.
  if (manualBody) {
    const { title } = await (async () => {
      const fetched = await fetchHtml(url, signal, cookieHeader);
      if (fetched.ok) return extract(fetched.html, domain);
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
  const fetchResult = await fetchHtml(url, signal, cookieHeader);

  if (!fetchResult.ok) {
    // Live fetch failed (403, network error, Cloudflare TLS block, timeout).
    // Cascade: plain curl → curl-impersonate → Wayback Machine.
    // Paywall is NOT retried via curl — if the site returned a gate page over undici,
    // any curl variant would return the same gate. Wayback is the only paywall fallback.
    const undiciDetail = fetchResult.detail ?? "undici_failed";

    // Step 1: plain static curl — covers most sites (BE Globo, etc.).
    const curlResult = await fetchHtmlViaCurl(url, signal, cookieHeader);
    if (curlResult.ok) {
      try {
        const curlExtracted = extract(curlResult.html, domain);
        const curlParagraphs = curlExtracted.paragraphs;
        if (!looksPaywalled(curlParagraphs) && curlParagraphs.length > 0) {
          const title = curlExtracted.title;
          if (!title) {
            return { url, status: "error", error: "Could not extract article title (via curl).", via: "curl" };
          }
          return { url, status: "ok", item: { url, source, title, paragraphs: curlParagraphs }, via: "curl" };
        }
        // plain curl got a paywall page — skip impersonate, go to Wayback.
        const wbResultPaywall = await fetchFromWayback(url, signal);
        if (wbResultPaywall.ok) {
          try {
            const wbEx = extract(wbResultPaywall.html, domain);
            if (!looksPaywalled(wbEx.paragraphs) && wbEx.paragraphs.length > 0) {
              const title = wbEx.title;
              if (!title) return { url, status: "error", error: "Could not extract article title (via Wayback).", via: "wayback", via_wayback: true };
              return { url, status: "ok", item: { url, source, title, paragraphs: wbEx.paragraphs }, via: "wayback", via_wayback: true };
            }
          } catch { /* fall through */ }
        }
        const wbD = (!wbResultPaywall.ok && wbResultPaywall.detail) ? wbResultPaywall.detail : "no_snapshot";
        return { url, status: "fetch_failed", error: `undici: ${undiciDetail}; curl: paywall; curl_impersonate: skipped; wayback: ${wbD}` };
      } catch {
        // curl extract threw — fall through to impersonate.
      }
    }
    const curlDetail = (!curlResult.ok && curlResult.detail) ? curlResult.detail : "curl_failed";

    // Step 2: curl-impersonate chrome131 — full TLS fingerprint, covers Cloudflare / Investing.com.
    const impResult = await fetchHtmlViaImpersonate(url, signal, cookieHeader);
    if (impResult.ok) {
      try {
        const impExtracted = extract(impResult.html, domain);
        const impParagraphs = impExtracted.paragraphs;
        if (!looksPaywalled(impParagraphs) && impParagraphs.length > 0) {
          const title = impExtracted.title;
          if (!title) {
            return { url, status: "error", error: "Could not extract article title (via curl-impersonate).", via: "curl_impersonate" };
          }
          return { url, status: "ok", item: { url, source, title, paragraphs: impParagraphs }, via: "curl_impersonate" };
        }
        // impersonate got a paywall page — Wayback is last resort.
      } catch {
        // impersonate extract failed — fall through to Wayback.
      }
    }
    const impDetail = (!impResult.ok && impResult.detail) ? impResult.detail : "curl_impersonate_failed";

    // Step 3: Wayback Machine.
    const wbResult = await fetchFromWayback(url, signal);
    if (wbResult.ok) {
      try {
        const wbExtracted = extract(wbResult.html, domain);
        const wbParagraphs = wbExtracted.paragraphs;
        if (!looksPaywalled(wbParagraphs) && wbParagraphs.length > 0) {
          const title = wbExtracted.title;
          if (!title) {
            return { url, status: "error", error: "Could not extract article title (via Wayback).", via: "wayback", via_wayback: true };
          }
          return { url, status: "ok", item: { url, source, title, paragraphs: wbParagraphs }, via: "wayback", via_wayback: true };
        }
      } catch {
        // Wayback extract failed — fall through to fetch_failed.
      }
    }
    const wbDetail = (!wbResult.ok && wbResult.detail) ? wbResult.detail : "no_snapshot";
    return {
      url,
      status: "fetch_failed",
      error: `undici: ${undiciDetail}; curl: ${curlDetail}; curl_impersonate: ${impDetail}; wayback: ${wbDetail}`,
    };
  }

  let { title, paragraphs } = extract(fetchResult.html, domain);

  // Paywall detected → try Wayback Machine once (not curl — paywall = site responded, curl would too).
  if (looksPaywalled(paragraphs)) {
    const wbResult = await fetchFromWayback(url, signal);
    if (wbResult.ok) {
      const wbExtracted = extract(wbResult.html, domain);
      if (
        !looksPaywalled(wbExtracted.paragraphs) &&
        wbExtracted.paragraphs.length > paragraphs.length
      ) {
        paragraphs = wbExtracted.paragraphs;
        if (wbExtracted.title) title = wbExtracted.title;
        // Mark via when we actually used the Wayback content.
        if (!looksPaywalled(paragraphs)) {
          if (!title) {
            return { url, status: "error", error: "Could not extract article title." };
          }
          return {
            url,
            status: "ok",
            item: { url, source, title, paragraphs },
            via: "wayback",
            via_wayback: true,
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
    };
  }

  if (!title) {
    return { url, status: "error", error: "Could not extract article title." };
  }

  return {
    url,
    status: "ok",
    item: { url, source, title, paragraphs },
  };
}
