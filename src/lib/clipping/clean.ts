// Port of clipinator.py lines 499–590: cleanTitle, cleanParagraphs, looksPaywalled.
// Runs server-side (Node.js) inside the scrape route.

import { SOURCE_NAMES } from "./sources";

// Build site-suffix patterns once at module load (same approach as Python).
const _uniqueNames = new Set([
  ...Object.values(SOURCE_NAMES),
  "Valor",
  "Valor Economico",
  "Folha",
  "Estadao",
  "O Estado de S.Paulo",
  "Brasil Energia - Petróleo e Gás",
  "oglobo",
  "Agencia Petrobras",
  "Agencia iNFRA",
  "Metropoles",
  "Poder 360",
  "Visao Agro",
  "Bloomberg Linea",
]);

const _SITE_SUFFIX_PATTERNS: RegExp[] = Array.from(_uniqueNames).map(
  (name) =>
    new RegExp(
      String.raw`\s*[|–\-]\s*` + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + String.raw`\s*$`,
      "i",
    ),
);

export function cleanTitle(title: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of _SITE_SUFFIX_PATTERNS) {
      const next = t.replace(pat, "").trim();
      if (next !== t && next) {
        t = next;
        changed = true;
      }
    }
  }
  return t;
}

// Port of clipinator.py _NOISE_PATTERNS and _NOISE_REGEX.
const _NOISE_PATTERNS: string[] = [
  String.raw`^\s*leia\s+(tamb[eé]m|mais|tudo\s+sobre)\b`,
  String.raw`^\s*leia\s+a\s+(reportagem|mat[eé]ria)\s+completa\b`,
  String.raw`^\s*continua\s+(ap[oó]s|depois)\s+(a|da)\s+publicidade`,
  String.raw`^\s*assine\b`,
  String.raw`^\s*assinar\b`,
  String.raw`^\s*publicidade\s*$`,
  String.raw`^\s*propaganda\s*$`,
  String.raw`^\s*anuncio\s*$`,
  String.raw`^\s*newsletter\b`,
  String.raw`^\s*siga\s+o\s+`,
  String.raw`^\s*siga\s+a\s+`,
  String.raw`^\s*assista\b`,
  String.raw`^\s*foto:\s`,
  String.raw`^\s*imagem:\s`,
  String.raw`^\s*cr[eé]dito:\s`,
  String.raw`^\s*compartilhe\b`,
  String.raw`^\s*veja\s+(tamb[eé]m|mais)\b`,
  String.raw`^\s*saiba\s+mais\b`,
  String.raw`^\s*por\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ.\-]+(\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ.\-]+){0,3}\s*$`,
  String.raw`j[aá]\s+[eé]\s+assinante\b`,
  String.raw`fa[cç]a\s+seu\s+login\b`,
  String.raw`continue\s+lendo\b`,
  String.raw`nosso\s+conte[uú]do\s+[eé]\s+exclusivo`,
  String.raw`conte[uú]do\s+exclusivo\s+para\s+assinantes`,
  String.raw`voc[eê]\s+atingiu\s+o\s+limite`,
  String.raw`tr[eê]s\s+mat[eé]rias\s+por\s+m[eê]s`,
  String.raw`apoie\s+o\s+jornalismo`,
  String.raw`acesse\s+sem\s+limites`,
  String.raw`acompanhe\s+os\s+mercados\s+com\s+nossas\s+ferramentas`,
  String.raw`tenha\s+acesso\s+a\s+informa[cç][aã]o\s+relevante`,
  String.raw`voc[eê]\s+pode\s+ler\s+nosso\s+conte[uú]do\s+exclusivo`,
  String.raw`cadastro\s+gratuito`,
  String.raw`assine\s+as?\s+newsletters?\b`,
  String.raw`receba\s+as?\s+not[ií]cias\s+do\s+dia`,
  String.raw`em\s+primeira\s+m[aã]o\s+no\s+e-?mail`,
  String.raw`^\s*[⟶→➔➜►▸‣»]\s*`,
  String.raw`^\s*[©®]?\s*\d{4}\s+bloomberg\b`,
  String.raw`^\s*todos\s+os\s+direitos\s+reservados`,
  // breadcrumb pattern: "CategoryName | SubCategory" (short, with pipe, no sentence punctuation)
  String.raw`^\s*[\wÀ-ÿ][\wÀ-ÿ\s&'\-]{1,40}\s*\|\s*[\wÀ-ÿ][\wÀ-ÿ\s&'\-]{1,40}\s*$`,
];

const _NOISE_REGEX = new RegExp(_NOISE_PATTERNS.join("|"), "i");

/**
 * Filter and deduplicate paragraphs using noise regex patterns.
 *
 * @param paragraphs   Raw paragraph strings from the extractor.
 * @param debugSink    Optional callback invoked for each discarded paragraph (truncated
 *                     to 200 chars). Only passed when ?debug=1 is active — zero overhead
 *                     in production because the function reference is undefined.
 */
export function cleanParagraphs(
  paragraphs: string[],
  debugSink?: (sample: string) => void,
): string[] {
  const out: string[] = [];
  for (let p of paragraphs) {
    p = p.replace(/\s+/g, " ").trim();
    p = p.replace(/\s+([.,;:!?])/g, "$1");
    if (!p) continue;
    if (_NOISE_REGEX.test(p)) {
      debugSink?.(p.slice(0, 200));
      continue;
    }
    out.push(p);
  }
  // Deduplicate consecutive identical paragraphs.
  const dedup: string[] = [];
  for (const p of out) {
    if (dedup.length === 0 || dedup[dedup.length - 1] !== p) {
      dedup.push(p);
    }
  }
  return dedup;
}

export const PAYWALL_MARKERS: string[] = [
  "ja e assinante",
  "já é assinante",
  "faca seu login",
  "faça seu login",
  "continue lendo",
  "nosso conteudo e exclusivo",
  "nosso conteúdo é exclusivo",
  "conteudo exclusivo para assinantes",
  "conteúdo exclusivo para assinantes",
  "assine ja",
  "assine já",
  "assine agora",
  "voce atingiu",
  "você atingiu o limite",
  "matéria exclusiva",
  "materia exclusiva",
  "tres materias por mes",
  "três matérias por mês",
  "apoie o jornalismo",
  "acesse sem limites",
  "acompanhe os mercados com nossas ferramentas",
  "conteudo premium",
  "conteúdo premium",
];

export function looksPaywalled(paragraphs: string[]): boolean {
  if (paragraphs.length < 3) return true;
  const joined = paragraphs.join(" ").toLowerCase();
  if (joined.length < 400) return true;
  return PAYWALL_MARKERS.some((marker) => joined.includes(marker));
}
