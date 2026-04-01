export interface StockQuote {
  symbol: string;
  shortName: string;
  longName: string;
  currency: string;
  regularMarketPrice: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketOpen: number;
  regularMarketPreviousClose: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketTime: string;
  regularMarketVolume: number;
  marketCap: number;
}

export interface HistoricalDataPoint {
  date: number;   // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ChartMode = "candlestick" | "line";
export type TimeRange = "1d" | "3d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "max";

export interface StockSearchResult {
  symbol: string;
  shortName: string;
  exchange: string;
  type: string;
}

export interface PortfolioGroup {
  name: string;
  tickers: string[];
}

export interface StockPortfolio {
  id: string;
  user_id: string;
  name: string;
  tickers: string[];
  groups: PortfolioGroup[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
