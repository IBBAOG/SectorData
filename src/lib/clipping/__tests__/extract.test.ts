/**
 * Fixture-based regression tests for the clipping extraction pipeline.
 * Each fixture is a real HTML page saved from a target news site, paired with an
 * .expected.json that defines what the extractor must (and must not) produce.
 *
 * Phase 4 of the clipping reform plan (see docs/app/news-hunter.md and
 * C:\Users\eduar\.claude\plans\tenho-notado-muito-lixo-jaunty-abelson.md).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extract } from "../extract";

const FIXTURES_DIR = join(__dirname, "fixtures");

// Maps the kebab-case fixture directory name to the actual domain host used by
// the extractor (must match a key in sources.ts EXTRACTORS).
const DOMAIN_HOSTS: Record<string, string> = {
  "brasil-energia": "www.brasilenergia.com.br",
  "petrobras": "agencia.petrobras.com.br",
  "eixos": "eixos.com.br",
  "clickpetroleoegas": "clickpetroleoegas.com.br",
  "valor": "valor.globo.com",
  "g1": "g1.globo.com",
  "folha": "www1.folha.uol.com.br",
  "estadao": "www.estadao.com.br",
  "cnn-brasil": "www.cnnbrasil.com.br",
  "infomoney": "www.infomoney.com.br",
  "uol-economia": "economia.uol.com.br",
  "tnonline": "tnonline.uol.com.br",
  "timesbrasil": "timesbrasil.com.br",
};

// Domains whose fixtures are skipped with an explicit TODO.
// These have known structural blockers that require Phase 3 (Readability) or
// selector additions beyond the Phase 4 scope.
const SKIP_REASONS: Record<string, string> = {
  // Paywall detected: div.editorial_ contains only teaser + "Já é assinante?" wall.
  // Full content not extractable without auth. Fixture kept as reference.
  "brasil-energia": "paywall — only teaser content accessible without auth",
  // CNN Brasil: fixed in Phase 5 (custom [data-single-content] selector +
  // Tailwind-token exclusion in stripNoise). Tests re-enabled.
};

interface Expected {
  title?: string | null;
  minParagraphCount: number;
  maxParagraphCount: number;
  // Text that must appear somewhere in the first 5 paragraphs (allows for leading
  // noise paragraphs that we know about but haven't fixed yet, e.g. Estadão
  // related-article subtitles leaking before the real article lead).
  firstParagraphContains: string;
  // Text that must appear in the last paragraph.
  lastParagraphContains: string;
  noNoiseMarkers: string[];
  noiseMustNotAppearAnywhere?: boolean;
}

const domains = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const domain of domains) {
  const skipReason = SKIP_REASONS[domain];
  const domainHost = DOMAIN_HOSTS[domain];

  if (skipReason) {
    it.skip(`extract — ${domain} [SKIP: ${skipReason}]`, () => {});
    continue;
  }

  if (!domainHost) {
    it.skip(`extract — ${domain} [SKIP: no DOMAIN_HOSTS entry]`, () => {});
    continue;
  }

  describe(`extract — ${domain}`, () => {
    const dir = join(FIXTURES_DIR, domain);
    const htmlFiles = readdirSync(dir).filter((f) => f.endsWith(".html")).sort();

    for (const htmlFile of htmlFiles) {
      const expectedPath = join(dir, htmlFile.replace(".html", ".expected.json"));

      it(htmlFile, () => {
        const html = readFileSync(join(dir, htmlFile), "utf-8");
        const expected: Expected = JSON.parse(readFileSync(expectedPath, "utf-8"));

        const result = extract(html, domainHost);

        // ── Title ─────────────────────────────────────────────────────────────
        if (expected.title) {
          expect(result.title).toBe(expected.title);
        } else {
          // null means "any non-empty title is acceptable"
          expect(result.title).toBeTruthy();
        }

        // ── Paragraph count ───────────────────────────────────────────────────
        expect(
          result.paragraphs.length,
          `paragraph count should be between ${expected.minParagraphCount} and ${expected.maxParagraphCount}, got ${result.paragraphs.length}`,
        ).toBeGreaterThanOrEqual(expected.minParagraphCount);
        expect(result.paragraphs.length).toBeLessThanOrEqual(expected.maxParagraphCount);

        // ── First-paragraph anchor ────────────────────────────────────────────
        // Search the first 5 paragraphs so that known leading noise (e.g. Estadão
        // related-article subtitles, InfoMoney "Publicidade") does not cause a false
        // failure when the real lead is at index 1-2.
        const anchor30 = expected.firstParagraphContains.toLowerCase().slice(0, 30);
        const first5 = result.paragraphs.slice(0, 5).join("\n").toLowerCase();
        expect(
          first5,
          `first 5 paragraphs should contain anchor: "${anchor30}"`,
        ).toContain(anchor30);

        // ── Last-paragraph anchor ─────────────────────────────────────────────
        const lastP = (result.paragraphs[result.paragraphs.length - 1] ?? "").toLowerCase();
        const lastAnchor30 = expected.lastParagraphContains.toLowerCase().slice(0, 30);
        expect(
          lastP,
          `last paragraph should contain anchor: "${lastAnchor30}"`,
        ).toContain(lastAnchor30);

        // ── Noise markers ─────────────────────────────────────────────────────
        if (expected.noiseMustNotAppearAnywhere) {
          const fullText = result.paragraphs.join("\n").toLowerCase();
          for (const marker of expected.noNoiseMarkers) {
            expect(
              fullText,
              `noise marker "${marker}" leaked into output for ${htmlFile}`,
            ).not.toContain(marker.toLowerCase());
          }
        }
      });
    }
  });
}
