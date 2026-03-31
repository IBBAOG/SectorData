export const MONTHS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Standard Brazilian region -> UF mapping (copied from components/filters.py)
export const REGIAO_UF_MAP: Record<string, string[]> = {
  Norte: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  N: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  NE: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MS", "MT"],
  CO: ["DF", "GO", "MS", "MT"],
  Sudeste: ["ES", "MG", "RJ", "SP"],
  SE: ["ES", "MG", "RJ", "SP"],
  Sul: ["PR", "RS", "SC"],
  S: ["PR", "RS", "SC"],
};

export function fmtData(d: string): string {
  try {
    const y = d.slice(0, 4);
    const m = parseInt(d.slice(5, 7), 10);
    const day = d.slice(8, 10);
    return `${MONTHS_EN[m - 1]} ${day}/${y}`;
  } catch {
    return d;
  }
}

export function resolverDatas(opcoes: Record<string, unknown> | null | undefined): string[] {
  const datas = (opcoes?.["datas"] ?? []) as string[];
  const anos = (opcoes?.["anos"] ?? []) as number[];
  const meses = (opcoes?.["meses"] ?? []) as number[];

  const cleanDatas = datas.slice().sort();
  if (cleanDatas.length > 0) return cleanDatas;

  const hasAnos = anos && anos.length > 0;
  const hasMeses = meses && meses.length > 0;
  if (hasAnos && hasMeses) {
    const result: string[] = [];
    const sortedAnos = anos.slice().sort((a, b) => a - b);
    const sortedMeses = meses.slice().sort((a, b) => a - b);
    for (const a of sortedAnos) {
      for (const m of sortedMeses) {
        result.push(`${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`);
      }
    }
    return result.sort();
  }

  return [];
}

export function ufsForRegion(reg: string, allUfs: string[]): string[] {
  const mapped = REGIAO_UF_MAP[reg] ?? [];
  const result = allUfs.filter((u) => mapped.includes(u));
  return result.length > 0 ? result : allUfs.slice();
}

