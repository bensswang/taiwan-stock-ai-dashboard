export type Market = "上市" | "上櫃" | "ETF" | "未知";

export interface StockMaster {
  code: string;
  name: string;
  shortName?: string;
  market: Market;
  industry?: string;
  aliases?: string[];
  issuedShares?: number | null;
}

export interface Quote {
  code: string;
  name: string;
  market: Market;
  industry?: string;
  price: number | null;
  previousClose?: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  turnover?: number | null;
  marketCap: number | null;
  updatedAt: string;
  source: string;
  note?: string;
}

export interface PricePoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface NewsItem {
  id: string;
  code: string;
  company: string;
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  excerpt?: string;
  category?: string;
}

export interface AiAnalysis {
  tone: "偏多" | "中性偏多" | "中性" | "中性偏空" | "偏空";
  summary: string;
  keyPoints: string[];
  risks: string[];
  sourceCount: number;
  updatedAt: string;
  provider: "openai" | "local-rules";
}
