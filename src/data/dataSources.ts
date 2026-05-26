// dataSources.ts — Curated catalog of all data sources that feed SectorData.
//
// Each entry's `key` must match the `source_key` returned by the
// `get_data_sources_freshness()` Supabase RPC (migration 20260526200000).
// The one exception is `yahoo_finance`, which has no Supabase table.
//
// staleAfterHours  = typical cron interval × 1.5  (yellow status)
// overdueAfterHours = typical cron interval × 3   (red status)

export type DataSourceCategory =
  | "anp-production"
  | "anp-distribution"
  | "imports"
  | "vessels"
  | "manual"
  | "news";

export interface DataSource {
  /** Stable key matching source_key from get_data_sources_freshness(); 'yahoo_finance' is special. */
  key: string;
  /** Short display name (English). */
  name: string;
  /** 1–2 sentence description shown when the row is expanded (English). */
  description: string;
  category: DataSourceCategory;
  /** Institution or system that publishes the data. */
  source: string;
  /** Canonical URL for the data source, or null for local Excel files. */
  sourceUrl: string | null;
  /** UTC cron expression (matches GitHub Actions schedule), or null for real-time / ad-hoc. */
  cronUtc: string | null;
  /** Human-readable English schedule description. */
  cronDescription: string;
  /** Frequency at which the upstream source publishes new data. */
  sourceFrequency: string;
  /** Dashboards that consume this source. Empty array means no dedicated dashboard. */
  dashboards: { slug: string; title: string }[];
  /** Supabase table name, or null (yahoo_finance). */
  supabaseTable: string | null;
  /** True for real-time/high-frequency sources — enables the infinite pulse dot. */
  isRealtime: boolean;
  /** Hours after last_update before status turns yellow (stale). */
  staleAfterHours: number;
  /** Hours after last_update before status turns red (overdue). */
  overdueAfterHours: number;
}

export const DATA_SOURCES: DataSource[] = [
  // ── ANP PRODUCTION ──────────────────────────────────────────────────────────

  {
    key: "anp_cdp_diaria",
    name: "Daily production by field",
    description:
      "Field-level daily oil and gas production extracted from ANP's Power BI public API. Updated 3× per day. Feeds the CDP Diária dashboard.",
    category: "anp-production",
    source: "ANP",
    sourceUrl: "https://app.powerbi.com/view?r=eyJrIjoiMzQ4NTY0MGMtOTI0Yy00ZmMwLWFkMzQtNTlmMDkyYzRlNmYyIiwidCI6IjNhMWYxMDVlLTViYjAtNGZjNC04YmYyLTliMDJjZmI4NTMwYSJ9",
    cronUtc: "0 10,15,20 * * *",
    cronDescription: "3× per day at 10:00, 15:00, 20:00 UTC",
    sourceFrequency: "Daily",
    dashboards: [{ slug: "anp-cdp-diaria", title: "ANP CDP Diária" }],
    supabaseTable: "anp_cdp_diaria",
    isRealtime: false,
    staleAfterHours: 12,
    overdueAfterHours: 24,
  },
  {
    key: "anp_cdp_diaria_instalacao",
    name: "Daily production by installation",
    description:
      "Installation-level daily oil and gas production from ANP Power BI. Companion to the field-level table — same ETL, finer granularity.",
    category: "anp-production",
    source: "ANP",
    sourceUrl: "https://app.powerbi.com/view?r=eyJrIjoiMzQ4NTY0MGMtOTI0Yy00ZmMwLWFkMzQtNTlmMDkyYzRlNmYyIiwidCI6IjNhMWYxMDVlLTViYjAtNGZjNC04YmYyLTliMDJjZmI4NTMwYSJ9",
    cronUtc: "0 10,15,20 * * *",
    cronDescription: "3× per day at 10:00, 15:00, 20:00 UTC",
    sourceFrequency: "Daily",
    dashboards: [{ slug: "anp-cdp-diaria", title: "ANP CDP Diária" }],
    supabaseTable: "anp_cdp_diaria_instalacao",
    isRealtime: false,
    staleAfterHours: 12,
    overdueAfterHours: 24,
  },
  {
    key: "anp_cdp_diaria_poco",
    name: "Daily production by well",
    description:
      "Well-level daily oil and gas production from ANP Power BI (~180k rows). Same Power BI ETL as the field and installation tables.",
    category: "anp-production",
    source: "ANP",
    sourceUrl: "https://app.powerbi.com/view?r=eyJrIjoiMzQ4NTY0MGMtOTI0Yy00ZmMwLWFkMzQtNTlmMDkyYzRlNmYyIiwidCI6IjNhMWYxMDVlLTViYjAtNGZjNC04YmYyLTliMDJjZmI4NTMwYSJ9",
    cronUtc: "0 10,15,20 * * *",
    cronDescription: "3× per day at 10:00, 15:00, 20:00 UTC",
    sourceFrequency: "Daily",
    dashboards: [{ slug: "anp-cdp-diaria", title: "ANP CDP Diária" }],
    supabaseTable: "anp_cdp_diaria_poco",
    isRealtime: false,
    staleAfterHours: 12,
    overdueAfterHours: 24,
  },
  {
    key: "anp_cdp_producao",
    name: "Monthly production by well (CDP)",
    description:
      "Monthly per-well production from ANP's APEX CDP portal, scraped via Selenium + ddddocr CAPTCHA solver. Covers oil, gas, and water production back to 2000.",
    category: "anp-production",
    source: "ANP",
    sourceUrl: "https://cdp.anp.gov.br/",
    cronUtc: "0 8 5 * *",
    cronDescription: "Monthly on day 5 at 08:00 UTC (+ incremental every ~2h via external cron-job.org)",
    sourceFrequency: "Monthly",
    dashboards: [
      { slug: "anp-cdp", title: "ANP CDP Production" },
      { slug: "anp-cdp-bsw", title: "ANP CDP — BSW" },
      { slug: "anp-cdp-depletion", title: "ANP CDP — Depletion" },
    ],
    supabaseTable: "anp_cdp_producao",
    isRealtime: false,
    staleAfterHours: 48,
    overdueAfterHours: 96,
  },
  {
    key: "anp_voip",
    name: "Recoverable reserves (VOIP/VGIP)",
    description:
      "Annual ANP Volume of Oil Initially in Place (VOIP) and Gas Initially in Place (VGIP) data by field and basin. Published once per year in May.",
    category: "anp-production",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/concessao-e-producao",
    cronUtc: "0 12 1 5 *",
    cronDescription: "Annual on May 1st at 12:00 UTC",
    sourceFrequency: "Annual",
    dashboards: [
      { slug: "anp-cdp-bsw", title: "ANP CDP — BSW" },
      { slug: "anp-cdp-depletion", title: "ANP CDP — Depletion" },
    ],
    supabaseTable: "anp_voip",
    isRealtime: false,
    staleAfterHours: 4380,   // 6 months before flagging stale on annual data
    overdueAfterHours: 8760, // 1 year
  },

  // ── ANP DISTRIBUTION ────────────────────────────────────────────────────────

  {
    key: "vendas",
    name: "Monthly fuel sales (ANP)",
    description:
      "ANP's official monthly fuel sales data by distributor, product, segment, region, and UF. Updated when ANP publishes the prior month's bulletin.",
    category: "anp-distribution",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/venda-de-derivados-de-petroleo-e-biocombustiveis",
    cronUtc: null,
    cronDescription: "Ad-hoc — triggered by external cron-job.org when ANP publishes a new bulletin",
    sourceFrequency: "Monthly",
    dashboards: [
      { slug: "sales-volumes", title: "Sales Volumes" },
      { slug: "market-share", title: "Market Share" },
    ],
    supabaseTable: "vendas",
    isRealtime: false,
    staleAfterHours: 720,  // 30 days
    overdueAfterHours: 1440,
  },
  {
    key: "anp_precos_produtores",
    name: "Producer fuel prices",
    description:
      "Weekly producer-level fuel prices published by ANP. Covers diesel, gasoline, ethanol, LPG, and other products at the refinery/producer level.",
    category: "anp-distribution",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/precos-de-combustiveis",
    cronUtc: "0 12 * * 1",
    cronDescription: "Weekly on Mondays at 12:00 UTC",
    sourceFrequency: "Weekly",
    dashboards: [{ slug: "anp-prices", title: "ANP Prices" }],
    supabaseTable: "anp_precos_produtores",
    isRealtime: false,
    staleAfterHours: 252,  // 10.5 days
    overdueAfterHours: 504,
  },
  {
    key: "anp_glp",
    name: "LPG distribution volumes",
    description:
      "Monthly LPG (P13, commercial, industrial) distribution volumes by distributor. Published alongside ANP producer prices.",
    category: "anp-distribution",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/precos-de-combustiveis",
    cronUtc: "0 12 * * 1",
    cronDescription: "Weekly on Mondays at 12:00 UTC",
    sourceFrequency: "Monthly",
    dashboards: [{ slug: "anp-prices", title: "ANP Prices" }],
    supabaseTable: "anp_glp",
    isRealtime: false,
    staleAfterHours: 252,
    overdueAfterHours: 504,
  },
  {
    key: "anp_lpc",
    name: "Retail pump prices (LPC)",
    description:
      "Weekly ANP retail-level pump prices (Levantamento de Preços ao Consumidor) by municipality, product, and fuel station count.",
    category: "anp-distribution",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/precos-de-combustiveis",
    cronUtc: "30 14 * * 3",
    cronDescription: "Weekly on Wednesdays at 14:30 UTC",
    sourceFrequency: "Weekly",
    dashboards: [{ slug: "anp-prices", title: "ANP Prices" }],
    supabaseTable: "anp_lpc",
    isRealtime: false,
    staleAfterHours: 252,
    overdueAfterHours: 504,
  },
  {
    key: "anp_precos_distribuicao",
    name: "Distribution-level fuel prices",
    description:
      "Monthly ANP distribution prices by distributor, product, and UF. Published around the 5th of each month and also updated weekly.",
    category: "anp-distribution",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/precos-de-combustiveis",
    cronUtc: "0 14 5 * *",
    cronDescription: "Monthly on day 5 at 14:00 UTC + weekly on Tuesdays at 14:30 UTC",
    sourceFrequency: "Monthly",
    dashboards: [{ slug: "anp-prices", title: "ANP Prices" }],
    supabaseTable: "anp_precos_distribuicao",
    isRealtime: false,
    staleAfterHours: 252,
    overdueAfterHours: 504,
  },
  {
    key: "anp_subsidy_diesel_reference",
    name: "Diesel subsidy reference prices",
    description:
      "ANP-published diesel reference prices (PDRR) by region used to calculate subsidy entitlements. Extracted from PDF bulletins via pdfplumber.",
    category: "anp-distribution",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/combustiveis/precos-de-referencia-para-o-diesel",
    cronUtc: "30 11 * * *",
    cronDescription: "Daily at 11:30 UTC",
    sourceFrequency: "Daily",
    dashboards: [{ slug: "subsidy-tracker", title: "Subsidy Tracker" }],
    supabaseTable: "anp_subsidy_diesel_reference",
    isRealtime: false,
    staleAfterHours: 36,
    overdueAfterHours: 72,
  },
  {
    key: "anp_subsidy_history",
    name: "Diesel subsidy rate history",
    description:
      "Historical log of diesel subsidy rates (BRL/L) since policy inception, with effective-from dates. Manual entries curated from government decrees.",
    category: "anp-distribution",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/combustiveis/precos-de-referencia-para-o-diesel",
    cronUtc: null,
    cronDescription: "Ad-hoc — updated when new subsidy decree drops",
    sourceFrequency: "Ad-hoc",
    dashboards: [{ slug: "subsidy-tracker", title: "Subsidy Tracker" }],
    supabaseTable: "anp_subsidy_history",
    isRealtime: false,
    staleAfterHours: 720,
    overdueAfterHours: 2160,
  },

  // ── IMPORTS & EXPORTS ───────────────────────────────────────────────────────

  {
    key: "mdic_comex",
    name: "MDIC Comex Stat (trade flows)",
    description:
      "Brazil's foreign trade statistics from MDIC Comex Stat. Filtered to fuel NCMs. Feeds the Imports & Exports FOB price panel (Panel C).",
    category: "imports",
    source: "MDIC",
    sourceUrl: "https://comexstat.mdic.gov.br/",
    cronUtc: "0 14 * * *",
    cronDescription: "Daily at 14:00 UTC",
    sourceFrequency: "Monthly",
    dashboards: [{ slug: "imports-exports", title: "Imports & Exports" }],
    supabaseTable: "mdic_comex",
    isRealtime: false,
    staleAfterHours: 36,
    overdueAfterHours: 72,
  },
  {
    key: "anp_daie",
    name: "ANP fuel import/export volumes (DAIE)",
    description:
      "Monthly fuel import and export volumes from ANP's DAIE (Dados de Abastecimento e Importação/Exportação) dataset, by product and operation type.",
    category: "imports",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/abastecimento",
    cronUtc: "0 13 1 * *",
    cronDescription: "Monthly on day 1 at 13:00 UTC",
    sourceFrequency: "Monthly",
    dashboards: [{ slug: "imports-exports", title: "Imports & Exports" }],
    supabaseTable: "anp_daie",
    isRealtime: false,
    staleAfterHours: 720,
    overdueAfterHours: 1440,
  },
  {
    key: "anp_desembaracos",
    name: "ANP customs clearances",
    description:
      "Monthly ANP customs clearance records enriched with CNPJ and importer name (since 2026-05-25 reform). Covers NCM-level import volumes and origins.",
    category: "imports",
    source: "ANP",
    sourceUrl: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/abastecimento",
    cronUtc: "0 13 1 * *",
    cronDescription: "Monthly on day 1 at 13:00 UTC",
    sourceFrequency: "Monthly",
    dashboards: [{ slug: "imports-exports", title: "Imports & Exports" }],
    supabaseTable: "anp_desembaracos",
    isRealtime: false,
    staleAfterHours: 720,
    overdueAfterHours: 1440,
  },

  // ── VESSELS ─────────────────────────────────────────────────────────────────

  {
    key: "navios_diesel",
    name: "Diesel import line-up",
    description:
      "Scheduled diesel import line-ups at Brazilian fuel ports, scraped from Porto de Itaqui and partner port systems every 6 hours via Selenium.",
    category: "vessels",
    source: "Porto de Itaqui",
    sourceUrl: "https://www.itaqui.ma.gov.br/programacao",
    cronUtc: "0 */6 * * *",
    cronDescription: "Every 6 hours",
    sourceFrequency: "Real-time",
    dashboards: [{ slug: "navios-diesel", title: "Diesel Imports Line-Up" }],
    supabaseTable: "navios_diesel",
    isRealtime: false,
    staleAfterHours: 9,
    overdueAfterHours: 18,
  },
  {
    key: "vessel_positions",
    name: "AIS vessel positions",
    description:
      "Real-time AIS vessel position updates streamed via AISStream WebSocket. Feeds the early-warning radar for diesel imports to Brazilian ports.",
    category: "vessels",
    source: "AISStream",
    sourceUrl: "https://aisstream.io/",
    cronUtc: null,
    cronDescription: "Real-time WebSocket stream (every 6h + 15min incremental sync)",
    sourceFrequency: "Real-time",
    dashboards: [{ slug: "navios-diesel", title: "Diesel Imports Line-Up" }],
    supabaseTable: "vessel_positions",
    isRealtime: true,
    staleAfterHours: 9,
    overdueAfterHours: 18,
  },
  {
    key: "port_arrivals",
    name: "Port arrival events",
    description:
      "Port-call arrival events detected by the AIS pipeline. Generated when a tracked vessel enters the geofence of a monitored Brazilian fuel port.",
    category: "vessels",
    source: "AISStream",
    sourceUrl: "https://aisstream.io/",
    cronUtc: "15 */6 * * *",
    cronDescription: "Every 6h + 15min (after AIS sync)",
    sourceFrequency: "Real-time",
    dashboards: [{ slug: "navios-diesel", title: "Diesel Imports Line-Up" }],
    supabaseTable: "port_arrivals",
    isRealtime: true,
    staleAfterHours: 9,
    overdueAfterHours: 18,
  },
  {
    key: "import_candidates",
    name: "AIS import candidates",
    description:
      "Global AIS scan scoring vessels 0–100 as likely diesel-import candidates based on vessel type, flag, origin port, and routing patterns.",
    category: "vessels",
    source: "AISStream",
    sourceUrl: "https://aisstream.io/",
    cronUtc: "0 */4 * * *",
    cronDescription: "Every 4 hours",
    sourceFrequency: "Real-time",
    dashboards: [{ slug: "navios-diesel", title: "Diesel Imports Line-Up" }],
    supabaseTable: "import_candidates",
    isRealtime: true,
    staleAfterHours: 6,
    overdueAfterHours: 12,
  },

  // ── MANUAL ──────────────────────────────────────────────────────────────────

  {
    key: "d_g_margins",
    name: "Diesel & gasoline margin model",
    description:
      "Weekly diesel and gasoline margin breakdown by component (base fuel, biofuel, federal tax, state tax, distribution and resale margin). Maintained as an Excel workbook.",
    category: "manual",
    source: "Manual",
    sourceUrl: null,
    cronUtc: "0 0 * * 1",
    cronDescription: "Weekly on Mondays (manual Excel upload via GitHub Actions)",
    sourceFrequency: "Weekly",
    dashboards: [{ slug: "diesel-gasoline-margins", title: "Diesel and Gasoline Margins" }],
    supabaseTable: "d_g_margins",
    isRealtime: false,
    staleAfterHours: 252,
    overdueAfterHours: 504,
  },
  {
    key: "price_bands",
    name: "Price bands model",
    description:
      "Petrobras and parity-derived price bands by fuel type, including import parity, export parity, and subsidy-adjusted variants. Manual Excel upload.",
    category: "manual",
    source: "Manual",
    sourceUrl: null,
    cronUtc: null,
    cronDescription: "Ad-hoc manual upload",
    sourceFrequency: "Ad-hoc",
    dashboards: [
      { slug: "price-bands", title: "Price Bands" },
      { slug: "subsidy-tracker", title: "Subsidy Tracker" },
    ],
    supabaseTable: "price_bands",
    isRealtime: false,
    staleAfterHours: 336,  // 14 days
    overdueAfterHours: 672,
  },

  // ── NEWS & MARKETS ───────────────────────────────────────────────────────────

  {
    key: "news_articles",
    name: "News Hunter articles",
    description:
      "Live oil & gas news articles matched against user keyword sets, scanned across ~60 sources every ~5 minutes via the external News Hunter scanner service.",
    category: "news",
    source: "News Hunter scanner",
    sourceUrl: "https://github.com/IBBAOG/news-hunter-scanner",
    cronUtc: null,
    cronDescription: "Continuous — external scanner runs every ~5 minutes via cron-job.org",
    sourceFrequency: "Real-time",
    dashboards: [{ slug: "news-hunter", title: "News Hunter" }],
    supabaseTable: "news_articles",
    isRealtime: true,
    staleAfterHours: 1,
    overdueAfterHours: 3,
  },
  {
    key: "yahoo_finance",
    name: "Yahoo Finance market data",
    description:
      "Real-time stock quotes, historical OHLCV data, and futures curves from Yahoo Finance, proxied through the Next.js /api/stocks/* routes to avoid CORS.",
    category: "news",
    source: "Yahoo Finance",
    sourceUrl: "https://finance.yahoo.com/",
    cronUtc: null,
    cronDescription: "Real-time — proxied on demand per user session",
    sourceFrequency: "Real-time",
    dashboards: [{ slug: "stocks", title: "Market Watch" }],
    supabaseTable: null,
    isRealtime: true,
    staleAfterHours: 1,
    overdueAfterHours: 4,
  },
];
