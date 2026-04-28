import type { NewsItem, PricePoint, Quote, StockMaster } from "./types";

export const MANUAL_ETFS: StockMaster[] = [
  { code: "0050", name: "元大台灣50", shortName: "元大50", market: "ETF", industry: "ETF", aliases: ["元大50", "台灣50", "0050"] },
  { code: "00631L", name: "元大台灣50正2", shortName: "元大50正二", market: "ETF", industry: "槓桿型ETF", aliases: ["元大50正2", "元大50正二", "台灣50正2", "台灣50正二", "00631L"] },
  { code: "0056", name: "元大高股息", shortName: "高股息", market: "ETF", industry: "ETF", aliases: ["0056", "高股息"] },
  { code: "00878", name: "國泰永續高股息", shortName: "國泰永續高股息", market: "ETF", industry: "ETF", aliases: ["00878", "國泰高股息"] },
  { code: "00981A", name: "熱門台股 ETF", shortName: "00981A", market: "ETF", industry: "主動式ETF", aliases: ["00981A", "熱門ETF", "台股ETF"] }
];

export const FALLBACK_STOCKS: StockMaster[] = [
  ...MANUAL_ETFS,
  { code: "2330", name: "台積電", shortName: "台積電", market: "上市", industry: "半導體", aliases: ["TSMC", "台積"] },
  { code: "2317", name: "鴻海", shortName: "鴻海", market: "上市", industry: "電子代工", aliases: ["Foxconn"] },
  { code: "2454", name: "聯發科", shortName: "聯發科", market: "上市", industry: "IC設計", aliases: ["MediaTek"] },
  { code: "2303", name: "聯電", shortName: "聯電", market: "上市", industry: "半導體", aliases: ["UMC"] },
  { code: "2308", name: "台達電", shortName: "台達電", market: "上市", industry: "電源管理", aliases: ["台達"] },
  { code: "2882", name: "國泰金", shortName: "國泰金", market: "上市", industry: "金融保險", aliases: ["國泰"] },
  { code: "2603", name: "長榮", shortName: "長榮", market: "上市", industry: "航運", aliases: ["長榮海運"] },
  { code: "6446", name: "藥華藥", shortName: "藥華藥", market: "上市", industry: "生技醫療", aliases: [] }
];

const fallbackQuoteMap: Record<string, Partial<Quote>> = {
  "0050": { price: 182.35, previousClose: 181.1, open: 181.4, high: 183.1, low: 180.95, volume: 24180 },
  "00631L": { price: 241.6, previousClose: 236.9, open: 237.8, high: 242.2, low: 237.0, volume: 32560 },
  "0056": { price: 37.18, previousClose: 37.0, open: 37.02, high: 37.25, low: 36.94, volume: 40800 },
  "00878": { price: 22.78, previousClose: 22.72, open: 22.74, high: 22.84, low: 22.66, volume: 68240 },
  "00981A": { price: 12.58, previousClose: 12.12, open: 12.18, high: 12.62, low: 12.15, volume: 98600 },
  "2330": { price: 875, previousClose: 863, open: 866, high: 878, low: 861, volume: 51230 },
  "2317": { price: 156.5, previousClose: 158, open: 158, high: 159, low: 155.5, volume: 38900 },
  "2454": { price: 1245, previousClose: 1220, open: 1220, high: 1255, low: 1215, volume: 16480 },
  "2303": { price: 48.85, previousClose: 49.2, open: 49.25, high: 49.4, low: 48.65, volume: 28540 },
  "2308": { price: 398, previousClose: 391, open: 392, high: 401, low: 390, volume: 15680 },
  "2882": { price: 64.2, previousClose: 63.4, open: 63.5, high: 64.6, low: 63.2, volume: 20560 },
  "2603": { price: 173.5, previousClose: 178, open: 178, high: 179, low: 172, volume: 41750 },
  "6446": { price: 612, previousClose: 643, open: 641, high: 645, low: 608, volume: 7820 }
};

export function makeFallbackQuote(stock: StockMaster): Quote {
  const q = fallbackQuoteMap[stock.code] ?? { price: 100, previousClose: 99, open: 99, high: 101, low: 98, volume: 1000 };
  const price = q.price ?? null;
  const previousClose = q.previousClose ?? null;
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;
  return {
    code: stock.code,
    name: stock.shortName || stock.name,
    market: stock.market,
    industry: stock.industry,
    price,
    previousClose,
    open: q.open ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    volume: q.volume ?? null,
    turnover: price && q.volume ? price * q.volume * 1000 : null,
    change,
    changePct,
    marketCap: stock.issuedShares && price ? stock.issuedShares * price : null,
    updatedAt: new Date().toISOString(),
    source: "fallback-demo",
    note: "外部資料暫時無法取得時使用的備援樣本。"
  };
}

export function makeFallbackHistory(code: string, basePrice = 100): PricePoint[] {
  const today = new Date();
  const points: PricePoint[] = [];
  for (let i = 95; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const wave = Math.sin(i * 0.24 + code.length) * basePrice * 0.05;
    const drift = (95 - i) * basePrice * 0.0006;
    const close = Math.max(basePrice + wave + drift, 1);
    points.push({
      date: d.toISOString().slice(0, 10),
      open: close * 0.995,
      high: close * 1.012,
      low: close * 0.988,
      close,
      volume: Math.round(1000 + Math.abs(Math.sin(i)) * 8000)
    });
  }
  return points;
}

export function makeFallbackNews(code: string, company = "台股公司"): NewsItem[] {
  return [
    {
      id: `${code}-fallback-1`,
      code,
      company,
      title: `${company} 近期營運與產業動態受到市場關注`,
      source: "fallback-demo",
      publishedAt: new Date().toISOString(),
      url: `https://news.google.com/search?q=${encodeURIComponent(company)}`,
      excerpt: "外部新聞暫時無法取得時顯示的備援摘要。請開啟原文連結確認完整內容。",
      category: "新聞"
    },
    {
      id: `${code}-fallback-2`,
      code,
      company,
      title: `${company} 投資人持續觀察後續公告與法人說明會重點`,
      source: "fallback-demo",
      publishedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      url: `https://news.google.com/search?q=${encodeURIComponent(`${company} 法說會`)}`,
      excerpt: "此專案保留原文連結，不直接重製新聞全文；AI 摘要會根據標題、來源與摘要欄位整理。",
      category: "法說會"
    }
  ];
}
