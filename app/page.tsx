"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AiAnalysis, NewsItem, PricePoint, Quote, StockMaster } from "@/lib/types";

type Theme = "dark" | "light";
type RangeKey = "1w" | "1m" | "3m" | "1y";
type ChartMode = "single" | "watchlist";
type CompositeMetric = "relative" | "marketCap";
type FuturesSession = "regular" | "after" | "combined";
type FuturesRange = "today" | "2d" | "3d" | "4d" | "5d";
type TaiexRange = "1w" | "1m" | "1y";

type WatchlistDigest = {
  headline: string;
  paragraphs: string[];
  outlook: string;
  sourceCount?: number;
  chartCount?: number;
  targetDate?: string;
  updatedAt?: string;
  nextUpdateAt?: string;
  provider?: "groq" | "local-rules";
};

type AiStatus = {
  configured: boolean;
  mode: "groq" | "missing-key";
  model: string | null;
  checkedAt?: string;
};

type FuturesPoint = {
  date: string;
  label: string;
  contract: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  session: "regular" | "after" | "combined";
  source: string;
};

type TaiexPoint = {
  date: string;
  label: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  source: string;
  updatedAt?: string;
};

const ranges: { key: RangeKey; label: string }[] = [
  { key: "1w", label: "一周" },
  { key: "1m", label: "一個月" },
  { key: "3m", label: "三個月" },
  { key: "1y", label: "一年" }
];

const taiexRanges: { key: TaiexRange; label: string; shortLabel: string }[] = [
  { key: "1w", label: "近一周", shortLabel: "周" },
  { key: "1m", label: "近一個月", shortLabel: "月" },
  { key: "1y", label: "近一年", shortLabel: "年" }
];

const defaultWatchlist = ["0050", "00631L", "0056", "00878", "2330", "2454"];

const QUOTE_REFRESH_MS = 30_000;
const SELECTED_REFRESH_MS = 30_000;
const CHART_REFRESH_MS = 5 * 60 * 1000;
const NEWS_REFRESH_MS = 60 * 60 * 1000;
const WATCHLIST_DIGEST_REFRESH_MS = 12 * 60 * 60 * 1000;
const WATCHLIST_DIGEST_STORAGE_KEY = "tw-stock-watchlist-digest-cache-v1";

const fallbackWatchlistDigest: WatchlistDigest = {
  headline:
    "自選股 AI 摘要尚未產生；請先確認 Groq API Key 已設定，或按「重新整理」重新整理。",
  paragraphs: [
    "AI 摘要現在只會使用 Groq 產生；若未設定 GROQ_API_KEY，不會再用本地模板假裝成 AI 摘要。"
  ],
  outlook:
    "設定 API Key 後重新部署，再回到網站按頁面上方「重新整理」即可。",
  sourceCount: 0,
  chartCount: 0
};


type WatchlistDigestCachePayload = {
  data: WatchlistDigest;
  savedAt: string;
  expiresAt: string;
};

function formatTimeFromIso(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function readWatchlistDigestCache(): WatchlistDigestCachePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WATCHLIST_DIGEST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WatchlistDigestCachePayload>;
    const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt).getTime() : 0;
    if (!parsed.data?.headline || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return parsed as WatchlistDigestCachePayload;
  } catch {
    return null;
  }
}

function saveWatchlistDigestCache(data: WatchlistDigest) {
  if (typeof window === "undefined") return;
  try {
    const savedAt = new Date().toISOString();
    const expiresAt = data.nextUpdateAt || new Date(Date.now() + WATCHLIST_DIGEST_REFRESH_MS).toISOString();
    window.localStorage.setItem(WATCHLIST_DIGEST_STORAGE_KEY, JSON.stringify({ data, savedAt, expiresAt }));
  } catch {}
}

const chartColors = ["#22d3ee", "#a78bfa", "#f59e0b", "#ef4444", "#10b981", "#6366f1", "#ec4899", "#14b8a6"];

function cn(...items: Array<string | false | null | undefined>) {
  return items.filter((item): item is string => Boolean(item)).join(" ");
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function formatMarketCap(value: number | null | undefined) {
  if (!value) return "待資料";
  if (value >= 1_0000_0000_0000) return `${(value / 1_0000_0000_0000).toFixed(2)} 兆`;
  if (value >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(1)} 億`;
  return value.toLocaleString("zh-TW");
}

function estimateTurnover(quote: Quote) {
  if (quote.turnover !== null && quote.turnover !== undefined && !Number.isNaN(quote.turnover)) return quote.turnover;
  if (!quote.price || !quote.volume) return null;
  // 若資料源未直接提供成交金額，才用價格 × 張數 × 1000 股估算。
  return quote.price * quote.volume * 1000;
}

function formatTurnover(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (value >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(1)} 億`;
  if (value >= 1_0000) return `${(value / 1_0000).toFixed(0)} 萬`;
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function formatChartValue(value: unknown, metric: CompositeMetric) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  if (metric === "marketCap") return formatMarketCap(n);
  const sign = n >= 100 ? "+" : "";
  return `${n.toFixed(2)}（${sign}${(n - 100).toFixed(2)}%）`;
}

function formatShortDate(value?: string | null) {
  if (!value) return "--";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function formatPctValue(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function splitTextParagraphs(value: string) {
  return value
    .split(/\n{2,}|(?<=。)\s+(?=[^。]{10,})/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sectionLabelParts(value: string) {
  const match = value.match(/^(整體表現|主要事件|資金動向|今日關注)：(.+)$/);
  if (!match) return null;
  return { label: match[1], body: match[2] };
}

function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function formatShare(count: number, total: number) {
  if (!total) return "--";
  return `${((count / total) * 100).toFixed(1)}%`;
}

const twseIndustryCodeMap: Record<string, string> = {
  "01": "水泥",
  "02": "食品",
  "03": "塑膠",
  "04": "紡織",
  "05": "電機機械",
  "06": "電器電纜",
  "08": "玻璃陶瓷",
  "09": "造紙",
  "10": "鋼鐵",
  "11": "橡膠",
  "12": "汽車",
  "14": "建材營造",
  "15": "航運",
  "16": "觀光餐旅",
  "17": "金融保險",
  "18": "貿易百貨",
  "20": "其他",
  "21": "化學",
  "22": "生技醫療",
  "23": "油電燃氣",
  "24": "半導體",
  "25": "電腦週邊",
  "26": "光電",
  "27": "通訊網路",
  "28": "電子零組件",
  "29": "電子通路",
  "30": "資訊服務",
  "31": "其他電子",
  "32": "文化創意",
  "33": "農業科技",
  "34": "電子商務",
  "80": "管理股票"
};

function readableIndustry(raw?: string | null) {
  const value = raw?.trim();
  if (!value) return "未分類";
  const code = value.padStart(2, "0");
  return twseIndustryCodeMap[code] || twseIndustryCodeMap[value] || value;
}

function topIndustryText(items: Quote[], limit = 3) {
  const industries = new Map<string, number>();
  for (const item of items) {
    const industry = readableIndustry(item.industry);
    industries.set(industry, (industries.get(industry) || 0) + 1);
  }
  const top = Array.from(industries.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return top.length ? top.map(([name, count]) => `${name}：${count} 檔`).join("　") : "待資料";
}

function quoteDisplayName(quote: Quote) {
  const name = quote.name?.trim();
  if (!name || name === quote.code) return quote.code;
  const shortName = name.length > 8 ? `${name.slice(0, 8)}…` : name;
  return `${quote.code} ${shortName}`;
}

function quoteMoveLabel(quote: Quote) {
  return `${quoteDisplayName(quote)}　${formatPctValue(quote.changePct)}`;
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function quoteToStockMaster(quote: Quote): StockMaster {
  return {
    code: quote.code,
    name: quote.name || quote.code,
    shortName: quote.name || quote.code,
    market: quote.market,
    industry: quote.industry,
    aliases: []
  };
}

const QUICK_STOCKS: StockMaster[] = [
  { code: "2330", name: "台灣積體電路製造", shortName: "台積電", market: "上市", industry: "半導體", aliases: ["TSMC"] },
  { code: "2317", name: "鴻海精密", shortName: "鴻海", market: "上市", industry: "電子零組件", aliases: ["Foxconn"] },
  { code: "2454", name: "聯發科技", shortName: "聯發科", market: "上市", industry: "半導體", aliases: ["MediaTek"] },
  { code: "2303", name: "聯華電子", shortName: "聯電", market: "上市", industry: "半導體" },
  { code: "2308", name: "台達電子", shortName: "台達電", market: "上市", industry: "電子零組件" },
  { code: "2412", name: "中華電信", shortName: "中華電", market: "上市", industry: "通信網路" },
  { code: "2881", name: "富邦金融控股", shortName: "富邦金", market: "上市", industry: "金融保險" },
  { code: "2882", name: "國泰金融控股", shortName: "國泰金", market: "上市", industry: "金融保險" },
  { code: "2884", name: "玉山金融控股", shortName: "玉山金", market: "上市", industry: "金融保險" },
  { code: "2885", name: "元大金融控股", shortName: "元大金", market: "上市", industry: "金融保險" },
  { code: "2891", name: "中國信託金融控股", shortName: "中信金", market: "上市", industry: "金融保險" },
  { code: "3711", name: "日月光投資控股", shortName: "日月光投控", market: "上市", industry: "半導體" },
  { code: "2382", name: "廣達電腦", shortName: "廣達", market: "上市", industry: "電腦及週邊" },
  { code: "3231", name: "緯創資通", shortName: "緯創", market: "上市", industry: "電腦及週邊" },
  { code: "2357", name: "華碩電腦", shortName: "華碩", market: "上市", industry: "電腦及週邊" },
  { code: "6669", name: "緯穎科技服務", shortName: "緯穎", market: "上市", industry: "電腦及週邊" },
  { code: "3008", name: "大立光電", shortName: "大立光", market: "上市", industry: "光電" },
  { code: "3034", name: "聯詠科技", shortName: "聯詠", market: "上市", industry: "半導體" },
  { code: "2379", name: "瑞昱半導體", shortName: "瑞昱", market: "上市", industry: "半導體" },
  { code: "2395", name: "研華", shortName: "研華", market: "上市", industry: "電腦及週邊" },
  { code: "2603", name: "長榮海運", shortName: "長榮", market: "上市", industry: "航運" },
  { code: "2609", name: "陽明海運", shortName: "陽明", market: "上市", industry: "航運" },
  { code: "2615", name: "萬海航運", shortName: "萬海", market: "上市", industry: "航運" },
  { code: "1301", name: "台灣塑膠", shortName: "台塑", market: "上市", industry: "塑膠" },
  { code: "1303", name: "南亞塑膠", shortName: "南亞", market: "上市", industry: "塑膠" },
  { code: "2002", name: "中國鋼鐵", shortName: "中鋼", market: "上市", industry: "鋼鐵" },
  { code: "1216", name: "統一企業", shortName: "統一", market: "上市", industry: "食品" },
  { code: "2207", name: "和泰汽車", shortName: "和泰車", market: "上市", industry: "汽車" },
  { code: "5871", name: "中租控股", shortName: "中租-KY", market: "上市", industry: "其他" },
  { code: "0050", name: "元大台灣50", shortName: "元大台灣50", market: "ETF", industry: "ETF", aliases: ["0050"] },
  { code: "0056", name: "元大高股息", shortName: "元大高股息", market: "ETF", industry: "ETF" },
  { code: "006208", name: "富邦台50", shortName: "富邦台50", market: "ETF", industry: "ETF" },
  { code: "00631L", name: "元大台灣50正2", shortName: "元大台灣50正2", market: "ETF", industry: "ETF" },
  { code: "00632R", name: "元大台灣50反1", shortName: "元大台灣50反1", market: "ETF", industry: "ETF" },
  { code: "00878", name: "國泰永續高股息", shortName: "國泰永續高股息", market: "ETF", industry: "ETF" },
  { code: "00919", name: "群益台灣精選高息", shortName: "群益台灣精選高息", market: "ETF", industry: "ETF" },
  { code: "00929", name: "復華台灣科技優息", shortName: "復華台灣科技優息", market: "ETF", industry: "ETF" },
  { code: "00940", name: "元大台灣價值高息", shortName: "元大台灣價值高息", market: "ETF", industry: "ETF" },
  { code: "00981A", name: "主動統一台股增長", shortName: "00981A", market: "ETF", industry: "ETF" }
];

function codeCandidateFromQuery(value: string): StockMaster | null {
  const code = normalizeSearchText(value).toUpperCase();
  if (!/^[0-9A-Z]{4,6}$/.test(code)) return null;
  return { code, name: code, shortName: code, market: code.startsWith("00") ? "ETF" : "未知", industry: code.startsWith("00") ? "ETF" : undefined, aliases: [] };
}


function stockMatches(stock: StockMaster, query: string) {
  const haystack = [stock.code, stock.name, stock.shortName, stock.market, stock.industry, ...(stock.aliases || [])]
    .filter((item): item is string => Boolean(item))
    .map(normalizeSearchText)
    .join(" ");
  return haystack.includes(query);
}

function scoreStock(stock: StockMaster, query: string) {
  const code = normalizeSearchText(stock.code);
  const name = normalizeSearchText(stock.name);
  const shortName = normalizeSearchText(stock.shortName || "");
  if (code === query) return 0;
  if (code.startsWith(query)) return 1;
  if (shortName === query || name === query) return 2;
  if (shortName.startsWith(query) || name.startsWith(query)) return 3;
  if (code.includes(query)) return 4;
  return 5;
}

function localSearchStocks(value: string, quoteList: Quote[], limit = 12): StockMaster[] {
  const query = normalizeSearchText(value);
  if (!query) return [];
  const byCode = new Map<string, StockMaster>();

  for (const item of QUICK_STOCKS) {
    if (stockMatches(item, query)) byCode.set(item.code, item);
  }

  for (const quote of quoteList) {
    if (!quote.code) continue;
    const stock = quoteToStockMaster(quote);
    if (stockMatches(stock, query)) byCode.set(stock.code, stock);
  }

  const codeCandidate = codeCandidateFromQuery(value);
  if (codeCandidate && !byCode.has(codeCandidate.code)) byCode.set(codeCandidate.code, codeCandidate);

  return Array.from(byCode.values())
    .sort((a, b) => scoreStock(a, query) - scoreStock(b, query) || a.code.localeCompare(b.code))
    .slice(0, limit);
}

function mergeStockResults(primary: StockMaster[], secondary: StockMaster[], limit = 12) {
  const map = new Map<string, StockMaster>();
  for (const item of [...primary, ...secondary]) {
    if (!item?.code || map.has(item.code)) continue;
    map.set(item.code, item);
  }
  return Array.from(map.values()).slice(0, limit);
}

function moveColorClass(value?: number | null) {
  return (value ?? 0) > 0 ? "text-red-500" : (value ?? 0) < 0 ? "text-emerald-500" : "text-slate-500";
}

function moveStrokeColor(value?: number | null, fallback = "#22d3ee") {
  return (value ?? 0) > 0 ? "#ef4444" : (value ?? 0) < 0 ? "#10b981" : fallback;
}

function Change({ quote, large = false }: { quote: Quote; large?: boolean }) {
  const pct = quote.changePct;
  const change = quote.change;
  const positive = (pct ?? 0) > 0;
  const color = moveColorClass(pct);
  const sign = positive ? "+" : "";
  return (
    <span className={cn(color, "font-bold", large ? "text-2xl" : "text-sm")}>
      {change === null || pct === null ? "--" : `${sign}${formatNumber(change)} / ${sign}${pct.toFixed(2)}%`}
    </span>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone?: "up" | "down" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
        tone === "up" && "border-red-500/20 bg-red-500/10 text-red-500",
        tone === "down" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-500",
        tone === "warn" && "border-amber-500/20 bg-amber-500/10 text-amber-500",
        !tone && "border-slate-500/20 bg-slate-500/10 text-slate-500"
      )}
    >
      {children}
    </span>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-500/30 p-8 text-center">
      <p className="font-bold">{title}</p>
      {text && <p className="mt-2 text-sm text-slate-500">{text}</p>}
    </div>
  );
}


function TaiexPanel({ isDark }: { isDark: boolean }) {
  const [points, setPoints] = useState<TaiexPoint[]>([]);
  const [range, setRange] = useState<TaiexRange>("1w");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState("");
  const hasTaiexDataRef = useRef(false);
  const latest = points[points.length - 1] || null;
  const activeRange = taiexRanges.find((item) => item.key === range)?.label || "近一周";
  const changeTone = moveColorClass(latest?.change);
  const lineStroke = moveStrokeColor(latest?.change);
  const changeText = latest && latest.change !== null
    ? `${latest.change > 0 ? "+" : ""}${formatNumber(latest.change, 2)} / ${formatPctValue(latest.changePct)}`
    : "--";

  useEffect(() => {
    let ignore = false;
    async function loadTaiex(options?: { silent?: boolean }) {
      const silent = options?.silent ?? false;
      if (!silent && !hasTaiexDataRef.current) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/market/taiex?range=${range}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "無法取得台灣加權指數資料");
        if (!ignore) {
          const nextPoints = Array.isArray(json.data) ? json.data : [];
          if (nextPoints.length) {
            hasTaiexDataRef.current = true;
            setPoints(nextPoints);
            setLastCheck(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
          }
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "台灣加權指數資料更新失敗，已保留上一筆資料");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadTaiex();
    const timer = window.setInterval(() => loadTaiex({ silent: true }), 30_000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [range]);

  return (
    <div className={cn("rounded-3xl border p-4", isDark ? "border-white/10 bg-slate-950/70" : "border-slate-200 bg-slate-50")}>
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className={cn("text-xs font-bold", isDark ? "text-slate-400" : "text-slate-500")}>現貨市場</p>
          <h3 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">台灣加權指數</h3>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap gap-2">
            {taiexRanges.map((item) => (
              <button
                key={item.key}
                onClick={() => setRange(item.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-bold transition",
                  range === item.key
                    ? "bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
                    : isDark
                      ? "bg-white/10 text-slate-200 hover:bg-white/15"
                      : "bg-white text-slate-600 shadow-sm hover:bg-slate-100"
                )}
              >
                {item.shortLabel}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Badge>{points.length ? `${points.length} 筆` : loading ? "載入中" : "0 筆"}</Badge>
            <span className={cn("text-[11px]", isDark ? "text-slate-500" : "text-slate-500")}>更新：{lastCheck || "--"}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[0.85fr_1.15fr]">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
            <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>最新指數</p>
            <p className="mt-1 text-lg font-black">{formatNumber(latest?.close, 2)}</p>
          </div>
          <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
            <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>漲跌</p>
            <p className={cn("mt-1 text-lg font-black", changeTone)}>{changeText}</p>
          </div>
          <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
            <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>成交量</p>
            <p className="mt-1 text-lg font-black">{formatNumber(latest?.volume, 0)}</p>
          </div>
          <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
            <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>目前區間</p>
            <p className="mt-1 text-lg font-black">{activeRange}</p>
          </div>
        </div>

        <div className="h-56">
          {points.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={isDark ? "rgba(148,163,184,.15)" : "rgba(15,23,42,.1)"} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: isDark ? "#020617" : "#fff", border: "1px solid rgba(148,163,184,.25)", borderRadius: 16 }}
                  formatter={(value) => [formatNumber(Number(value), 2), "加權指數"]}
                  labelFormatter={(label) => `日期 ${label}`}
                />
                <Line type="linear" dataKey="close" name="加權指數" stroke={lineStroke} strokeWidth={3} dot={false} activeDot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-500/30 text-center">
              <p className="text-base font-black">加權指數讀取中</p>
              <p className={cn("mt-2 text-xs leading-5", isDark ? "text-slate-400" : "text-slate-500")}>{error || "稍後重新整理"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FuturesPanel({ session, setSession, range, setRange, isDark }: {
  session: FuturesSession;
  setSession: (value: FuturesSession) => void;
  range: FuturesRange;
  setRange: (value: FuturesRange) => void;
  isDark: boolean;
}) {
  const [points, setPoints] = useState<FuturesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFuturesDataRef = useRef(false);
  const sessionTabs: { key: FuturesSession; label: string }[] = [
    { key: "regular", label: "一般" },
    { key: "after", label: "盤後" },
    { key: "combined", label: "合併" }
  ];
  const rangeTabs: { key: FuturesRange; label: string }[] = [
    { key: "today", label: "當日" },
    { key: "2d", label: "二日" },
    { key: "3d", label: "三日" },
    { key: "4d", label: "四日" },
    { key: "5d", label: "五日" }
  ];

  const activeSession = sessionTabs.find((item) => item.key === session)?.label || "合併";
  const activeRange = rangeTabs.find((item) => item.key === range)?.label || "五日";
  const latest = points[points.length - 1] || null;
  const changeTone = moveColorClass(latest?.change);
  const changeText = latest && latest.change !== null
    ? `${latest.change > 0 ? "+" : ""}${formatNumber(latest.change, 0)} / ${formatPctValue(latest.changePct)}`
    : "--";

  useEffect(() => {
    let ignore = false;
    async function loadFutures(options?: { silent?: boolean }) {
      const silent = options?.silent ?? false;
      if (!silent && !hasFuturesDataRef.current) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/futures?session=${session}&range=${range}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "無法取得台指期資料");
        if (!ignore) {
          const nextPoints = Array.isArray(json.data) ? json.data : [];
          if (nextPoints.length) {
            hasFuturesDataRef.current = true;
            setPoints(nextPoints);
          }
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "台指期資料更新失敗，已保留上一筆資料");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadFutures();
    const timer = window.setInterval(() => loadFutures({ silent: true }), 30_000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [session, range]);

  return (
    <div>
      <TaiexPanel isDark={isDark} />
      <div className="mt-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="warn">台指期</Badge>
            <Badge>一般 / 盤後 / 合併</Badge>
          </div>
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">台指期盤前盤後走勢</h2>
        </div>
        <a
          href="https://www.wantgoo.com/futures/wtx%26"
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-300"
        >
          原始走勢
        </a>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {sessionTabs.map((item) => (
          <button key={item.key} onClick={() => setSession(item.key)} className={cn("rounded-full px-4 py-2 text-sm font-bold transition", session === item.key ? "bg-cyan-400 text-slate-950" : isDark ? "bg-white/10 text-slate-300" : "bg-slate-200 text-slate-700")}>{item.label}</button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {rangeTabs.map((item) => (
          <button key={item.key} onClick={() => setRange(item.key)} className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", range === item.key ? "border border-cyan-300 bg-white text-slate-950" : isDark ? "bg-white/10 text-slate-300" : "bg-slate-200 text-slate-700")}>{item.label}</button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
        <div className={cn("rounded-3xl border p-4", isDark ? "border-white/10 bg-slate-950/70" : "border-slate-200 bg-slate-50")}>
          <p className={cn("text-xs font-bold", isDark ? "text-slate-400" : "text-slate-500")}>選擇</p>
          <p className="mt-1 text-xl font-black">{activeSession} / {activeRange}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
              <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>契約</p>
              <p className="mt-1 text-lg font-black">{latest?.contract || "--"}</p>
            </div>
            <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
              <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>成交</p>
              <p className="mt-1 text-lg font-black">{formatNumber(latest?.close, 0)}</p>
            </div>
            <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
              <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>漲跌</p>
              <p className={cn("mt-1 text-lg font-black", changeTone)}>{changeText}</p>
            </div>
            <div className={cn("rounded-2xl border p-3", isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white")}>
              <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>成交量</p>
              <p className="mt-1 text-lg font-black">{formatNumber(latest?.volume, 0)}</p>
            </div>
          </div>
          <p className={cn("mt-3 text-xs leading-5", isDark ? "text-slate-500" : "text-slate-500")}>
            日期：{latest ? formatShortDate(latest.date) : "--"}
          </p>
          {error && <p className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">{error}</p>}
        </div>

        <div className={cn("rounded-3xl border p-4", isDark ? "border-white/10 bg-slate-950/70" : "border-slate-200 bg-slate-50")}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-bold">TX 走勢</p>
            <p className={cn("text-xs", isDark ? "text-slate-400" : "text-slate-500")}>{points.length ? `${points.length} 筆` : loading ? "載入中..." : "0 筆"}</p>
          </div>
          <div className="h-72">
            {points.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={isDark ? "rgba(148,163,184,.15)" : "rgba(15,23,42,.1)"} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} minTickGap={16} />
                  <YAxis tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: isDark ? "#020617" : "#fff", border: "1px solid rgba(148,163,184,.25)", borderRadius: 16 }}
                    formatter={(value, name) => [name === "volume" ? formatNumber(Number(value), 0) : formatNumber(Number(value), 0), name === "close" ? "成交" : "成交量"]}
                    labelFormatter={(label) => `日期 ${label}`}
                  />
                  <Line type="linear" dataKey="close" name="成交" stroke="#22d3ee" strokeWidth={3} dot={false} activeDot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-500/30 text-center">
                <p className="text-lg font-black">台指期讀取中</p>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}


export default function HomePage() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StockMaster[]>([]);
  const [searchingStocks, setSearchingStocks] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selectedCode, setSelectedCode] = useState("2330");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [range, setRange] = useState<RangeKey>("1m");
  const [chartMode, setChartMode] = useState<ChartMode>("single");
  const [compositeMetric, setCompositeMetric] = useState<CompositeMetric>("relative");
  const [futuresSession, setFuturesSession] = useState<FuturesSession>("combined");
  const [futuresRange, setFuturesRange] = useState<FuturesRange>("3d");
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [watchHistories, setWatchHistories] = useState<Record<string, PricePoint[]>>({});
  const [watchHistoryLoading, setWatchHistoryLoading] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(defaultWatchlist);
  const [loading, setLoading] = useState({ quotes: true, selected: true, history: true, news: true, analysis: false });
  const [error, setError] = useState<string | null>(null);
  const [lastQuoteCheck, setLastQuoteCheck] = useState<string>("");
  const [lastNewsCheck, setLastNewsCheck] = useState<string>("");
  const [watchlistDigest, setWatchlistDigest] = useState<WatchlistDigest>(fallbackWatchlistDigest);
  const [watchlistDigestLoading, setWatchlistDigestLoading] = useState(false);
  const [refreshingVisibleData, setRefreshingVisibleData] = useState(false);
  const [lastWatchlistDigestCheck, setLastWatchlistDigestCheck] = useState<string>("");
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const searchSeqRef = useRef(0);
  const selectedCodeRef = useRef(selectedCode);
  const selectedQuoteSeqRef = useRef(0);
  const historySeqRef = useRef(0);
  const newsSeqRef = useRef(0);
  const watchlistRef = useRef<string[]>(defaultWatchlist);
  const quotesRef = useRef<Quote[]>([]);

  const isDark = theme === "dark";
  const panel = isDark ? "border-white/10 bg-slate-900/85" : "border-slate-200 bg-white";
  const softPanel = isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-slate-50";
  const muted = isDark ? "text-slate-400" : "text-slate-500";
  const input = isDark ? "border-white/10 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950";
  const aiConfigured = aiStatus?.configured === true;
  const aiModeLabel = aiStatus ? (aiStatus.configured ? `Groq${aiStatus.model ? ` / ${aiStatus.model}` : ""}` : "未設定 API Key") : "檢查中";

  function stamp() {
    return new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }

  async function loadAiStatus() {
    try {
      const res = await fetch("/api/ai/status", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI 狀態檢查失敗");
      setAiStatus(json);
    } catch {
      setAiStatus({ configured: false, mode: "missing-key", model: null });
    }
  }

  async function loadQuotes(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent && quotes.length === 0) {
      setLoading((prev) => ({ ...prev, quotes: true }));
    }
    try {
      const res = await fetch("/api/stocks/quote", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "無法取得股票行情");
      const nextQuotes = Array.isArray(json.data) ? json.data : [];
      if (nextQuotes.length) {
        setQuotes(nextQuotes);
        setLastQuoteCheck(stamp());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "行情更新失敗，已保留上一筆資料");
    } finally {
      setLoading((prev) => ({ ...prev, quotes: false }));
    }
  }

  async function loadSelected(code: string, options: boolean | { silent?: boolean; resetAnalysis?: boolean } = true) {
    const normalizedCode = code.trim().toUpperCase();
    const requestSeq = ++selectedQuoteSeqRef.current;
    const silent = typeof options === "boolean" ? false : options.silent ?? false;
    const resetAnalysis = typeof options === "boolean" ? options : options.resetAnalysis ?? true;
    if (!silent && !selectedQuote) {
      setLoading((prev) => ({ ...prev, selected: true }));
    }
    if (resetAnalysis) setAnalysis(null);
    try {
      const res = await fetch(`/api/stocks/quote?code=${encodeURIComponent(normalizedCode)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "無法取得個股資料");
      if (json.data && requestSeq === selectedQuoteSeqRef.current && selectedCodeRef.current === normalizedCode) {
        setSelectedQuote(json.data);
      }
    } catch (err) {
      if (requestSeq === selectedQuoteSeqRef.current && selectedCodeRef.current === normalizedCode) {
        setError(err instanceof Error ? err.message : "個股更新失敗，已保留上一筆資料");
      }
    } finally {
      if (requestSeq === selectedQuoteSeqRef.current) {
        setLoading((prev) => ({ ...prev, selected: false }));
      }
    }
  }

  async function loadHistory(code: string, selectedRange: RangeKey, options?: { silent?: boolean }) {
    const normalizedCode = code.trim().toUpperCase();
    const requestSeq = ++historySeqRef.current;
    const silent = options?.silent ?? false;
    if (!silent && history.length === 0) {
      setLoading((prev) => ({ ...prev, history: true }));
    }
    try {
      const res = await fetch(`/api/stocks/history?code=${encodeURIComponent(normalizedCode)}&range=${selectedRange}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "無法取得歷史資料");
      const nextHistory = Array.isArray(json.data) ? json.data : [];
      if (requestSeq === historySeqRef.current && selectedCodeRef.current === normalizedCode) {
        setHistory(nextHistory);
      }
    } catch (err) {
      if (requestSeq === historySeqRef.current && selectedCodeRef.current === normalizedCode) {
        setError(err instanceof Error ? err.message : "趨勢圖更新失敗，已保留上一筆資料");
      }
    } finally {
      if (requestSeq === historySeqRef.current) {
        setLoading((prev) => ({ ...prev, history: false }));
      }
    }
  }

  async function loadWatchHistories(codes: string[], selectedRange: RangeKey) {
    if (!codes.length) {
      setWatchHistories({});
      return;
    }
    setWatchHistoryLoading(true);
    try {
      const targets = codes.slice(0, 8);
      const entries = await Promise.all(
        targets.map(async (code) => {
          try {
            const res = await fetch("/api/stocks/history?code=" + encodeURIComponent(code) + "&range=" + selectedRange, { cache: "no-store" });
            const json = await res.json();
            return [code, Array.isArray(json.data) ? json.data : []] as const;
          } catch {
            return [code, []] as const;
          }
        })
      );
      setWatchHistories((prev) => {
        const next: Record<string, PricePoint[]> = {};
        for (const code of targets) next[code] = prev[code] || [];
        for (const [code, points] of entries) {
          if (points.length) next[code] = points;
        }
        return next;
      });
    } finally {
      setWatchHistoryLoading(false);
    }
  }

  async function loadNews(code: string, company?: string, options?: { silent?: boolean }) {
    const normalizedCode = code.trim().toUpperCase();
    const requestSeq = ++newsSeqRef.current;
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading((prev) => ({ ...prev, news: true }));
      setNews([]);
      setAnalysis(null);
      setLastNewsCheck("");
    }
    try {
      const params = new URLSearchParams({ code: normalizedCode, days: "5" });
      if (company) params.set("company", company);
      const res = await fetch(`/api/news?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "無法取得新聞");
      const nextNews = (Array.isArray(json.data) ? json.data : [])
        .filter((item: NewsItem) => item.code === normalizedCode)
        .map((item: NewsItem) => ({ ...item, code: normalizedCode, company: json.company || item.company }));
      if (requestSeq === newsSeqRef.current && selectedCodeRef.current === normalizedCode) {
        setNews(nextNews);
        setLastNewsCheck(stamp());
      }
    } catch (err) {
      if (requestSeq === newsSeqRef.current && selectedCodeRef.current === normalizedCode) {
        setError(err instanceof Error ? err.message : "新聞更新失敗，已保留上一筆資料");
      }
    } finally {
      if (requestSeq === newsSeqRef.current) {
        setLoading((prev) => ({ ...prev, news: false }));
      }
    }
  }

  async function searchStocks(value: string) {
    setQuery(value);
    const trimmed = value.trim();
    searchSeqRef.current += 1;
    const currentSeq = searchSeqRef.current;

    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);

    if (!trimmed) {
      setSearchingStocks(false);
      setSearchResults([]);
      return;
    }

    // 先用已載入的行情清單在瀏覽器端搜尋，輸入後幾乎立即顯示結果。
    const localResults = localSearchStocks(trimmed, quotes, 12);
    setSearchResults(localResults);

    const exactLocalMatch = localResults.some((stock) => normalizeSearchText(stock.code) === normalizeSearchText(trimmed));
    if (localResults.length >= 8 || exactLocalMatch) {
      setSearchingStocks(false);
      return;
    }

    // 若本機清單不足，再延遲查完整主檔，避免每打一個字都打 API。
    setSearchingStocks(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(trimmed)}&limit=12`, { cache: "force-cache" });
        const json = await res.json();
        if (currentSeq !== searchSeqRef.current) return;
        const remoteResults = Array.isArray(json.data) ? json.data : [];
        setSearchResults(mergeStockResults(localResults, remoteResults, 12));
      } catch {
        if (currentSeq === searchSeqRef.current && !localResults.length) setSearchResults([]);
      } finally {
        if (currentSeq === searchSeqRef.current) setSearchingStocks(false);
      }
    }, 600);
  }

  async function analyzeNews() {
    if (!aiConfigured) {
      setError("尚未設定 GROQ_API_KEY；請先到 Netlify 設定環境變數並重新部署。AI 摘要不會使用本地模板替代。");
      return;
    }
    setLoading((prev) => ({ ...prev, analysis: true }));
    setAnalysis(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock: selectedQuote, news: selectedNews })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI 分析失敗");
      setAnalysis(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 分析失敗");
    } finally {
      setLoading((prev) => ({ ...prev, analysis: false }));
    }
  }

  async function loadWatchlistDigest(targetWatchlist?: string[], options?: { force?: boolean }) {
    const activeWatchlist = (targetWatchlist?.length ? targetWatchlist : watchlistRef.current).slice();
    const force = options?.force ?? false;

    if (!activeWatchlist.length) {
      setWatchlistDigest(fallbackWatchlistDigest);
      return;
    }
    if (aiStatus === null) return;
    if (!aiConfigured) {
      setWatchlistDigest({
        headline: "尚未設定 Groq API Key；自選股 AI 摘要暫停，行情、圖表與可信新聞仍可正常更新。",
        paragraphs: [
          "請到 Netlify 的 Environment variables 新增 GROQ_API_KEY，scope 需包含 Functions，重新部署後這裡才會顯示真正的 Groq 摘要。"
        ],
        outlook: "設定完成後按頁面上方「重新整理」，或等待下一次 12 小時自動整理。",
        sourceCount: 0,
        chartCount: 0
      });
      return;
    }

    if (!force) {
      const cached = readWatchlistDigestCache();
      if (cached) {
        setWatchlistDigest(cached.data);
        setLastWatchlistDigestCheck(formatTimeFromIso(cached.data.updatedAt || cached.savedAt) || "已快取");
        return;
      }
    }

    setWatchlistDigestLoading(true);
    try {
      const activeQuotes = quotesRef.current;
      const res = await fetch("/api/ai/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watchlist: activeWatchlist,
          quotes: activeQuotes.filter((quote) => activeWatchlist.includes(quote.code)),
          force
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "自選股 AI 摘要失敗");
      if (json.data?.headline) {
        setWatchlistDigest(json.data);
        saveWatchlistDigestCache(json.data);
        setLastWatchlistDigestCheck(formatTimeFromIso(json.data.updatedAt) || stamp());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "自選股 AI 摘要更新失敗，已保留上一筆整理");
    } finally {
      setWatchlistDigestLoading(false);
    }
  }

  async function refreshVisibleData() {
    if (refreshingVisibleData) return;
    setRefreshingVisibleData(true);
    setError(null);
    try {
      await Promise.all([
        loadQuotes({ silent: false }),
        loadSelected(selectedCode, { resetAnalysis: false }),
        loadHistory(selectedCode, range, { silent: false }),
        loadNews(selectedCodeRef.current, selectedQuote?.name, { silent: false }),
        chartMode === "watchlist" ? loadWatchHistories(watchlistRef.current, range) : Promise.resolve(),
        loadWatchlistDigest(watchlistRef.current, { force: true })
      ]);
    } finally {
      setRefreshingVisibleData(false);
    }
  }

  function selectStock(code: string, name?: string) {
    const normalizedCode = code.trim().toUpperCase();
    selectedCodeRef.current = normalizedCode;
    const localQuote = quotesRef.current.find((quote) => quote.code === normalizedCode) || null;
    setSelectedCode(normalizedCode);
    setSelectedQuote(localQuote);
    setHistory([]);
    setNews([]);
    setAnalysis(null);
    setLastNewsCheck("");
    setLoading((prev) => ({ ...prev, selected: true, history: true, news: true }));
    setQuery("");
    setSearchResults([]);
    loadSelected(normalizedCode);
    loadHistory(normalizedCode, range);
    loadNews(normalizedCode, name || localQuote?.name);
  }

  function toggleWatch(code: string) {
    setWatchlist((prev) => {
      const next = prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code];
      window.localStorage.setItem("tw-stock-watchlist", JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    selectedCodeRef.current = selectedCode;
  }, [selectedCode]);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    setSearchResults(localSearchStocks(query, quotes, 12));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("tw-stock-theme") as Theme | null;
    const storedWatch = window.localStorage.getItem("tw-stock-watchlist");
    if (storedTheme) setTheme(storedTheme);
    if (storedWatch) {
      try { setWatchlist(JSON.parse(storedWatch)); } catch {}
    }
    loadAiStatus();
    loadQuotes();
    loadSelected(selectedCode);
    loadHistory(selectedCode, range);
    loadNews(selectedCode);

    const quoteTimer = window.setInterval(() => {
      loadQuotes({ silent: true });
    }, QUOTE_REFRESH_MS);
    return () => {
      window.clearInterval(quoteTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => loadSelected(selectedCode, { silent: true, resetAnalysis: false }), SELECTED_REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadHistory(selectedCode, range, { silent: true });
      if (chartMode === "watchlist") {
        loadWatchHistories(watchlist, range);
      }
    }, CHART_REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode, range, chartMode, watchlist.join(",")]);


  useEffect(() => {
    const refreshed = quotes.find((q) => q.code === selectedCode);
    if (refreshed) setSelectedQuote(refreshed);
  }, [quotes, selectedCode]);

  useEffect(() => {
    if (aiStatus === null) return;
    loadWatchlistDigest(watchlistRef.current);
    const timer = window.setInterval(() => loadWatchlistDigest(watchlistRef.current, { force: true }), WATCHLIST_DIGEST_REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiStatus?.configured]);

  useEffect(() => {
    const timer = window.setInterval(() => loadNews(selectedCodeRef.current, undefined, { silent: true }), NEWS_REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem("tw-stock-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    loadHistory(selectedCode, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (chartMode === "watchlist") {
      loadWatchHistories(watchlist, range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartMode, range, watchlist.join(",")]);

  const watchQuotes = useMemo(() => {
    return watchlist
      .map((code) => quotes.find((q) => q.code === code))
      .filter((item): item is Quote => Boolean(item))
      .sort((a, b) => {
        const aPct = Number.isFinite(a.changePct ?? NaN) ? (a.changePct as number) : -9999;
        const bPct = Number.isFinite(b.changePct ?? NaN) ? (b.changePct as number) : -9999;
        if (bPct !== aPct) return bPct - aPct;
        return a.code.localeCompare(b.code);
      });
  }, [quotes, watchlist]);

  const watchSummary = useMemo(() => {
    const valid = watchQuotes.filter((q) => q.price !== null);
    const up = valid.filter((q) => (q.change ?? 0) > 0);
    const down = valid.filter((q) => (q.change ?? 0) < 0);
    const flat = valid.length - up.length - down.length;
    const missing = watchlist.filter((code) => !watchQuotes.some((q) => q.code === code && q.price !== null));
    const strongest = [...valid].sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))[0] || null;
    const weakest = [...valid].sort((a, b) => (a.changePct ?? 999) - (b.changePct ?? 999))[0] || null;
    const industries = new Map<string, number>();
    for (const q of valid) {
      const key = readableIndustry(q.industry);
      industries.set(key, (industries.get(key) || 0) + 1);
    }
    const topIndustry = Array.from(industries.entries()).sort((a, b) => b[1] - a[1])[0] || null;
    return { valid, up, down, flat, missing, strongest, weakest, topIndustry };
  }, [watchQuotes, watchlist]);

  const watchSummaryTitle = useMemo(() => {
    const parts = [
      watchSummary.up.length > 0 ? `上漲 ${watchSummary.up.length}` : null,
      watchSummary.down.length > 0 ? `下跌 ${watchSummary.down.length}` : null,
      watchSummary.flat > 0 ? `持平 ${watchSummary.flat}` : null,
      watchSummary.missing.length > 0 ? `待資料 ${watchSummary.missing.length}` : null
    ].filter((item): item is string => Boolean(item));
    return parts.length ? parts.join("、") : "尚無摘要";
  }, [watchSummary]);

  const compositeChart = useMemo(() => {
    const series = watchlist
      .map((code) => {
        const quote = quotes.find((q) => q.code === code);
        const data = (watchHistories[code] || []).filter((point) => point.close !== null && point.close !== undefined);
        const latestPrice = quote?.price ?? data[data.length - 1]?.close ?? null;
        const estimatedShares = quote?.marketCap && latestPrice ? quote.marketCap / latestPrice : null;
        return {
          code,
          name: quote?.name || code,
          data,
          base: data[0]?.close || null,
          estimatedShares
        };
      })
      .filter((item) => item.data.length > 1)
      .slice(0, 8);

    const allDates = Array.from(
      new Set(series.flatMap((item) => item.data.map((point) => point.date)))
    ).sort();

    const data = allDates.map((date) => {
      const row: Record<string, string | number | null> = { date };
      for (const item of series) {
        const point = item.data.find((p) => p.date === date);
        if (!point?.close) {
          row[item.code] = null;
          continue;
        }
        if (compositeMetric === "marketCap") {
          row[item.code] = item.estimatedShares ? Number((point.close * item.estimatedShares).toFixed(0)) : null;
        } else {
          row[item.code] = item.base ? Number(((point.close / item.base) * 100).toFixed(2)) : null;
        }
      }
      return row;
    });

    const missingMarketCap = compositeMetric === "marketCap"
      ? series.filter((item) => !item.estimatedShares).map((item) => item.code)
      : [];

    return { series, data, missingMarketCap };
  }, [watchHistories, watchlist, quotes, compositeMetric]);

  const marketStats = useMemo(() => {
    const valid = quotes.filter((q) => q.price !== null && q.change !== null && q.changePct !== null);
    const up = valid.filter((q) => (q.change ?? 0) > 0).sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));
    const down = valid.filter((q) => (q.change ?? 0) < 0).sort((a, b) => (a.changePct ?? 999) - (b.changePct ?? 999));
    const flat = valid.length - up.length - down.length;
    const nearLimitUp = valid.filter((q) => (q.changePct ?? 0) >= 6.5).sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));
    const nearLimitDown = valid.filter((q) => (q.changePct ?? 0) <= -6.5).sort((a, b) => (a.changePct ?? 999) - (b.changePct ?? 999));
    const upBuckets = {
      over3: up.filter((q) => (q.changePct ?? 0) >= 3).length,
      oneTo3: up.filter((q) => (q.changePct ?? 0) >= 1 && (q.changePct ?? 0) < 3).length,
      under1: up.filter((q) => (q.changePct ?? 0) > 0 && (q.changePct ?? 0) < 1).length
    };
    const downBuckets = {
      over3: down.filter((q) => (q.changePct ?? 0) <= -3).length,
      oneTo3: down.filter((q) => (q.changePct ?? 0) <= -1 && (q.changePct ?? 0) > -3).length,
      under1: down.filter((q) => (q.changePct ?? 0) < 0 && (q.changePct ?? 0) > -1).length
    };
    const sentiment = up.length > down.length * 1.25
      ? "市場氣氛：偏多"
      : down.length > up.length * 1.25
        ? "市場氣氛：偏弱"
        : "市場氣氛：震盪";
    return { valid, up, down, flat, nearLimitUp, nearLimitDown, upBuckets, downBuckets, sentiment };
  }, [quotes]);

  const topMovers = useMemo(() => {
    return [...quotes].sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0)).slice(0, 30);
  }, [quotes]);

  const selectedCompanyName = selectedQuote?.name || selectedCode;
  const selectedNews = useMemo(() => news.filter((item) => item.code === selectedCode), [news, selectedCode]);

  const popularRows = useMemo(() => {
    return quotes
      .filter((quote) => quote.price !== null && quote.volume !== null)
      .map((quote) => ({
        ...quote,
        turnover: estimateTurnover(quote) || 0
      }))
      .sort((a, b) => (b.turnover || 0) - (a.turnover || 0) || (b.volume || 0) - (a.volume || 0))
      .slice(0, 10)
      .map((quote, index) => ({
        rank: index + 1,
        code: quote.code,
        name: quote.name,
        price: quote.price,
        change: quote.change,
        changePct: quote.changePct,
        volume: quote.volume,
        turnover: quote.turnover,
        industry: quote.industry ? readableIndustry(quote.industry) : quote.market,
        market: quote.market,
        source: quote.source
      }));
  }, [quotes]);

  return (
    <main className={cn("min-h-screen transition", isDark ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-950")}>
      <header className={cn("sticky top-0 z-40 border-b backdrop-blur-xl", isDark ? "border-white/10 bg-slate-950/85" : "border-slate-200 bg-white/85")}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400 text-sm font-black text-slate-950">TW</div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">台股即時新聞盤</h1>
              <p className={cn("text-xs", muted)}>台指期｜加權指數｜自選股｜熱門排行</p>
            </div>
          </div>

          <div className="relative flex flex-col gap-3 md:flex-row md:items-center">
            <div className={cn("flex items-center rounded-full border px-4 py-2", input)}>
              <span className={cn("mr-2 text-xs font-bold", muted)}>搜尋</span>
              <input
                value={query}
                onChange={(event) => searchStocks(event.target.value)}
                placeholder="2330、台積電、00631L..."
                className="w-full bg-transparent text-sm outline-none md:w-96"
              />
            </div>
            {query && (
              <div className={cn("absolute right-0 top-12 z-50 max-h-96 w-full overflow-y-auto rounded-3xl border p-2 shadow-2xl md:w-[520px]", panel)}>
                {searchResults.length ? searchResults.map((stock) => (
                  <button key={stock.code} onClick={() => selectStock(stock.code, stock.shortName || stock.name)} className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition hover:bg-cyan-400/10">
                    <div>
                      <p className="font-bold">{stock.code} {stock.shortName || stock.name}</p>
                      <p className={cn("text-xs", muted)}>{stock.market} / {readableIndustry(stock.industry)}</p>
                    </div>
                    <Badge>{stock.market}</Badge>
                  </button>
                )) : searchingStocks ? <EmptyState title="搜尋中" text="正在查完整股票清單。" /> : <EmptyState title="找不到股票" text="請改用代號或公司簡稱。" />}
              </div>
            )}
            <div className={cn("hidden items-center rounded-full border px-3 py-2 text-xs font-bold md:flex", softPanel)}>
              自動更新：{lastQuoteCheck || "--"}
            </div>
            <div className={cn("hidden items-center rounded-full border px-3 py-2 text-xs font-bold md:flex", aiConfigured ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300" : "border-amber-400/30 bg-amber-400/10 text-amber-400")}>
              AI 模式：{aiModeLabel}
            </div>
            <button
              onClick={refreshVisibleData}
              disabled={refreshingVisibleData}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-70",
                softPanel
              )}
            >
              {refreshingVisibleData && <Spinner />}
              {refreshingVisibleData ? "更新中" : "重新整理"}
            </button>
            <button onClick={() => setTheme(isDark ? "light" : "dark")} className={cn("rounded-full border px-4 py-2 text-sm font-medium", softPanel)}>
              {isDark ? "淺色" : "深色"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        {error && (
          <div className="mb-5 rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-500">
            {error} <button className="ml-3 font-bold underline" onClick={() => setError(null)}>關閉</button>
          </div>
        )}

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className={cn("rounded-[2rem] border p-6 shadow-sm", panel)}>
            <FuturesPanel
              session={futuresSession}
              setSession={setFuturesSession}
              range={futuresRange}
              setRange={setFuturesRange}
              isDark={isDark}
            />
          </div>
          <div className="space-y-4">
            <WatchStatusCard
              summary={quotes.length ? watchSummaryTitle : "載入中"}
              validCount={watchSummary.valid.length}
              totalCount={watchlist.length}
              strongest={watchSummary.strongest}
              weakest={watchSummary.weakest}
              topIndustry={watchSummary.topIndustry}
              missingCount={watchSummary.missing.length}
              theme={theme}
            />
            <div className="grid grid-cols-2 content-start gap-4">
              <MarketBreadthCard
                title="市場上漲"
                count={marketStats.up.length}
                total={marketStats.valid.length}
                tone="up"
                headline={marketStats.sentiment}
                lines={[`漲幅 > 3%：${marketStats.upBuckets.over3} 檔`, `漲幅 1%～3%：${marketStats.upBuckets.oneTo3} 檔`, `漲幅 < 1%：${marketStats.upBuckets.under1} 檔`]}
                industryText={topIndustryText(marketStats.up)}
                examples={marketStats.up.slice(0, 3).map(quoteMoveLabel)}
                loading={!quotes.length && loading.quotes}
                theme={theme}
              />
              <MarketBreadthCard
                title="市場下跌"
                count={marketStats.down.length}
                total={marketStats.valid.length}
                tone="down"
                headline={marketStats.sentiment}
                lines={[`跌幅 > 3%：${marketStats.downBuckets.over3} 檔`, `跌幅 1%～3%：${marketStats.downBuckets.oneTo3} 檔`, `跌幅 < 1%：${marketStats.downBuckets.under1} 檔`]}
                industryText={topIndustryText(marketStats.down)}
                examples={marketStats.down.slice(0, 3).map(quoteMoveLabel)}
                loading={!quotes.length && loading.quotes}
                theme={theme}
              />
              <MarketBreadthCard
                title="接近漲停"
                count={marketStats.nearLimitUp.length}
                total={marketStats.valid.length}
                tone="limitUp"
                headline={marketStats.nearLimitUp.length > marketStats.nearLimitDown.length ? "短線強勢股較多" : "強勢股未明顯擴散"}
                lines={[`門檻：漲幅 ≥ 6.5%`, `佔比：${formatShare(marketStats.nearLimitUp.length, marketStats.valid.length)}`, `持平：${marketStats.flat} 檔`]}
                industryText={topIndustryText(marketStats.nearLimitUp)}
                examples={marketStats.nearLimitUp.slice(0, 3).map(quoteMoveLabel)}
                loading={!quotes.length && loading.quotes}
                theme={theme}
              />
              <MarketBreadthCard
                title="接近跌停"
                count={marketStats.nearLimitDown.length}
                total={marketStats.valid.length}
                tone="limitDown"
                headline={marketStats.nearLimitDown.length > marketStats.nearLimitUp.length ? "弱勢壓力較集中" : "跌停壓力較可控"}
                lines={[`門檻：跌幅 ≤ -6.5%`, `佔比：${formatShare(marketStats.nearLimitDown.length, marketStats.valid.length)}`, `有效行情：${formatCount(marketStats.valid.length)} 檔`]}
                industryText={topIndustryText(marketStats.nearLimitDown)}
                examples={marketStats.nearLimitDown.slice(0, 3).map(quoteMoveLabel)}
                loading={!quotes.length && loading.quotes}
                theme={theme}
              />
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className={cn("flex h-full min-h-0 flex-col rounded-[2rem] border p-5", panel)}>
            <div className="flex shrink-0 items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">自選股</h2>
              </div>
              <Badge>{watchlist.length} 檔</Badge>
            </div>
            <div className={cn("mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1", isDark ? "scrollbar-dark" : "scrollbar-light")}>
              {watchQuotes.length ? watchQuotes.map((quote) => (
                <button key={quote.code} onClick={() => selectStock(quote.code, quote.name)} className={cn("w-full rounded-3xl border p-4 text-left transition hover:-translate-y-0.5", selectedCode === quote.code ? "border-cyan-400 bg-cyan-400/10" : softPanel)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{quote.code} {quote.name}</p>
                      <p className={cn("mt-1 text-xs", muted)}>{quote.market} / {readableIndustry(quote.industry)}</p>
                    </div>
                    <Change quote={quote} />
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <p className="text-2xl font-black">{formatNumber(quote.price)}</p>
                    <Badge tone={(quote.changePct ?? 0) >= 6.5 ? "up" : (quote.changePct ?? 0) <= -6.5 ? "down" : undefined}>觀察</Badge>
                  </div>
                </button>
              )) : <EmptyState title="尚無自選股" text="搜尋後加入自選。" />}
            </div>
          </div>

          <div className={cn("rounded-[2rem] border p-5", panel)}>
            {selectedQuote ? (
              <>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-black">{selectedQuote.code} {selectedQuote.name}</h2>
                      <button onClick={() => toggleWatch(selectedQuote.code)} className={cn("rounded-full border px-3 py-1 text-xs font-bold", watchlist.includes(selectedQuote.code) ? "border-amber-400 bg-amber-400/15 text-amber-500" : softPanel)}>
                        {watchlist.includes(selectedQuote.code) ? "已加入自選" : "加入自選"}
                      </button>
                    </div>
                    <p className={cn("mt-1 text-sm", muted)}>{selectedQuote.market} / {readableIndustry(selectedQuote.industry)}</p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-4xl font-black">{formatNumber(selectedQuote.price)}</p>
                    <div className="mt-2"><Change quote={selectedQuote} large /></div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-5">
                  <Stat label="開盤" value={formatNumber(selectedQuote.open)} theme={theme} />
                  <Stat label="最高" value={formatNumber(selectedQuote.high)} theme={theme} />
                  <Stat label="最低" value={formatNumber(selectedQuote.low)} theme={theme} />
                  <Stat label="成交量" value={`${formatNumber(selectedQuote.volume, 0)} 張`} theme={theme} />
                  <Stat label="市值" value={formatMarketCap(selectedQuote.marketCap)} theme={theme} />
                </div>

                <div className={cn("mt-5 rounded-3xl border p-5", softPanel)}>
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="font-bold">價格趨勢</h3>
                      <p className={cn("mt-1 text-xs", muted)}>
                        {chartMode === "single" ? ranges.find((r) => r.key === range)?.label : compositeMetric === "relative" ? "相對指數" : "市值"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setChartMode("single")} className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", chartMode === "single" ? "bg-cyan-400 text-slate-950" : isDark ? "bg-white/10 text-slate-300" : "bg-slate-200 text-slate-700")}>個股</button>
                      <button onClick={() => setChartMode("watchlist")} className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", chartMode === "watchlist" ? "bg-cyan-400 text-slate-950" : isDark ? "bg-white/10 text-slate-300" : "bg-slate-200 text-slate-700")}>綜合</button>
                      {chartMode === "watchlist" && (
                        <>
                          <button onClick={() => setCompositeMetric("relative")} className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", compositeMetric === "relative" ? "bg-cyan-400 text-slate-950" : isDark ? "bg-white/10 text-slate-300" : "bg-slate-200 text-slate-700")}>相對指數</button>
                          <button onClick={() => setCompositeMetric("marketCap")} className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", compositeMetric === "marketCap" ? "bg-cyan-400 text-slate-950" : isDark ? "bg-white/10 text-slate-300" : "bg-slate-200 text-slate-700")}>市值</button>
                        </>
                      )}
                      {ranges.map((item) => (
                        <button key={item.key} onClick={() => setRange(item.key)} className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", range === item.key ? "bg-cyan-400 text-slate-950" : isDark ? "bg-white/10 text-slate-300" : "bg-slate-200 text-slate-700")}>{item.label}</button>
                      ))}
                    </div>
                  </div>
                  {chartMode === "watchlist" && compositeMetric === "marketCap" && compositeChart.missingMarketCap.length > 0 && (
                    <p className={cn("mb-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-500")}>
                      部分自選股缺少可用市值資料：{compositeChart.missingMarketCap.join("、")}，市值模式會略過這些線。
                    </p>
                  )}
                  <div className="h-72">
                    {chartMode === "single" ? (
                      loading.history && !history.length ? <EmptyState title="趨勢圖載入中" /> : history.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={history.map((p) => ({ ...p, close: p.close ?? 0 }))} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid stroke={isDark ? "rgba(148,163,184,.15)" : "rgba(15,23,42,.1)"} vertical={false} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} minTickGap={32} />
                            <YAxis tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} domain={["auto", "auto"]} />
                            <Tooltip contentStyle={{ background: isDark ? "#020617" : "#fff", border: "1px solid rgba(148,163,184,.25)", borderRadius: 16 }} />
                            <Line type="linear" dataKey="close" stroke={moveStrokeColor(selectedQuote.changePct)} strokeWidth={3} dot={false} activeDot={{ r: 3 }} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : <EmptyState title="沒有趨勢資料" />
                    ) : (
                      watchHistoryLoading && !compositeChart.series.length ? <EmptyState title="綜合圖載入中" /> : compositeChart.series.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={compositeChart.data} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                            <CartesianGrid stroke={isDark ? "rgba(148,163,184,.15)" : "rgba(15,23,42,.1)"} vertical={false} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} minTickGap={32} />
                            <YAxis tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} domain={["auto", "auto"]} tickFormatter={(value) => compositeMetric === "marketCap" ? formatMarketCap(Number(value)) : `${Number(value).toFixed(0)}`} />
                            <Tooltip contentStyle={{ background: isDark ? "#020617" : "#fff", border: "1px solid rgba(148,163,184,.25)", borderRadius: 16 }} formatter={(value, name) => [formatChartValue(value, compositeMetric), name]} />
                            <Legend />
                            {compositeChart.series.map((item, index) => (
                              <Line key={item.code} type="linear" dataKey={item.code} name={`${item.code} ${item.name}`} stroke={chartColors[index % chartColors.length]} strokeWidth={2.5} dot={false} connectNulls />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : <EmptyState title="沒有綜合趨勢資料" />
                    )}
                  </div>
                </div>
              </>
            ) : <EmptyState title="請選擇股票" />}
          </div>
        </section>

        <section className="mt-6 space-y-6">
          <div className={cn("rounded-[2rem] border p-5", panel)}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-xl font-bold">自選股當日重點</h2>
                <p className={cn("mt-1 text-sm", muted)}>整合當日新聞、量價與自選股結構；新增或移除自選股不會立刻重算，需按上方「重新整理」或等 12 小時自動整理。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{watchlist.length} 檔自選</Badge>
                <Badge tone={aiConfigured ? "up" : "warn"}>AI：{aiModeLabel}</Badge>
                <Badge tone="warn">{watchlistDigestLoading ? "AI整理中" : "每12小時整理"}</Badge>
                <Badge>今日 {watchlistDigest.sourceCount ?? 0} 則可信新聞</Badge>
                <Badge>{watchlistDigest.chartCount ?? 0} 檔圖表</Badge>
              </div>
            </div>

            <div className={cn("mt-5 rounded-3xl border p-6", isDark ? "border-cyan-400/25 bg-slate-950" : "border-cyan-200 bg-white")}>
              <div className="flex items-center gap-3">
                <span className={cn("inline-flex rounded-2xl px-3 py-1.5 text-sm font-black", isDark ? "bg-cyan-400/15 text-cyan-300" : "bg-cyan-50 text-cyan-600")}>AI 摘要</span>
                <span className={cn("text-sm font-semibold", muted)}>日期：{watchlistDigest.targetDate || "今日"}｜更新：{lastWatchlistDigestCheck || "--"}</span>
              </div>
              <p className="mt-5 text-xl font-black leading-9 md:text-2xl md:leading-10">{watchlistDigest.headline}</p>
              <div className="mt-5 grid gap-3 text-[15px] leading-8 md:text-base">
                {watchlistDigest.paragraphs.map((paragraph) => {
                  const parts = sectionLabelParts(paragraph);
                  return (
                    <p key={paragraph} className={muted}>
                      {parts ? <><span className={cn("font-bold", isDark ? "text-white" : "text-slate-900")}>{parts.label}：</span>{parts.body}</> : paragraph}
                    </p>
                  );
                })}
              </div>
            </div>

            <div className={cn("mt-5 rounded-3xl border p-5", softPanel)}>
              <p className="font-bold text-amber-500">後續留意</p>
              <p className={cn("mt-3 text-sm leading-8 md:text-base", muted)}>{watchlistDigest.outlook}</p>
            </div>
          </div>

          <div className={cn("rounded-[2rem] border p-5", panel)}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-xl font-bold">{selectedCompanyName} 近五天可信新聞與當日重點</h2>
                <p className={cn("mt-1 text-sm", muted)}>只納入中高以上可信來源，整合近五天新聞、今日事件與量價反應。AI 模式：{aiModeLabel}｜更新：{lastNewsCheck || "--"}</p>
              </div>
              <button onClick={analyzeNews} disabled={loading.analysis || !selectedNews.length || !aiConfigured} className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                {loading.analysis && <Spinner />}
                {loading.analysis ? "整理事件中" : aiConfigured ? "整理可信新聞與當日重點" : "尚未設定 API Key"}
              </button>
            </div>

            {analysis && (
              <div className={cn("mt-5 overflow-hidden rounded-3xl border", isDark ? "border-cyan-400/30 bg-slate-950" : "border-cyan-200 bg-white")}>
                <div className={cn("border-b p-5", isDark ? "border-white/10 bg-cyan-400/10" : "border-cyan-100 bg-cyan-50")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={analysis.tone.includes("多") ? "up" : analysis.tone.includes("空") ? "down" : "warn"}>{analysis.tone}</Badge>
                    <Badge tone="up">Groq 摘要</Badge>
                    <Badge>{analysis.sourceCount} 則可信新聞</Badge>
                  </div>
                  <h3 className="mt-3 text-2xl font-black">新聞摘要</h3>
                  <div className={cn("mt-3 space-y-4 text-lg leading-9 md:text-xl", muted)}>
                    {splitTextParagraphs(analysis.summary).map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </div>

                {analysis.keyPoints.length > 0 && (
                  <div className="p-5">
                    <p className="font-bold text-cyan-500">整理重點</p>
                    <ul className="mt-3 list-disc space-y-3 pl-5 text-base leading-8 md:text-lg">
                      {analysis.keyPoints.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {loading.news && !selectedNews.length ? <EmptyState title="新聞載入中" /> : selectedNews.length ? selectedNews.map((item) => (
                <article key={item.id} className={cn("rounded-3xl border p-5", softPanel)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{item.code} {item.company}</Badge>
                    <Badge>{item.category || "新聞"}</Badge>
                    {item.sourceTier && <Badge tone={item.sourceTier === "最高" ? "up" : item.sourceTier === "高" ? "warn" : undefined}>{item.sourceTier}可信</Badge>}
                    <span className={cn("text-xs", muted)}>{new Date(item.publishedAt).toLocaleString("zh-TW")} / {item.source}</span>
                  </div>
                  <h3 className="mt-3 font-bold leading-6">{item.title}</h3>
                  {item.excerpt && <p className={cn("mt-2 text-sm leading-6", muted)}>{item.excerpt}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a href={item.url} target="_blank" rel="noreferrer" className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-slate-950">開啟原文</a>
                  </div>
                </article>
              )) : <EmptyState title="近五天暫無中高以上可信來源新聞" /> }
            </div>

            <div className={cn("mt-6 rounded-3xl border p-5", softPanel)}>
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-xl font-black">熱門排行</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{quotes.length ? `${popularRows.length} 檔` : "載入中"}</Badge>
                  <Badge tone="warn">成交額</Badge>
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-3xl border border-slate-500/20">
                <div className={cn("hidden grid-cols-[58px_minmax(0,1.35fr)_0.85fr_1fr_1fr_1fr_112px] gap-3 px-4 py-3 text-xs font-bold md:grid", isDark ? "bg-slate-950/60 text-slate-400" : "bg-slate-100 text-slate-500")}>
                  <span>排行</span>
                  <span>代號 / 公司</span>
                  <span>成交價</span>
                  <span>漲跌幅</span>
                  <span>成交量</span>
                  <span>成交額</span>
                  <span>自選</span>
                </div>

                <div className="divide-y divide-slate-500/15">
                  {popularRows.length ? popularRows.map((item) => {
                    const inWatch = watchlist.includes(item.code);
                    return (
                      <div
                        key={item.code}
                        className={cn(
                          "grid w-full gap-3 px-4 py-4 transition hover:bg-cyan-400/10 md:grid-cols-[58px_minmax(0,1.35fr)_0.85fr_1fr_1fr_1fr_112px] md:items-center",
                          item.rank === 1 && (isDark ? "bg-amber-400/10" : "bg-amber-50")
                        )}
                      >
                        <button onClick={() => selectStock(item.code, item.name)} className="flex items-center gap-2 text-left md:block">
                          <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-2xl text-sm font-black", item.rank === 1 ? "bg-amber-400 text-slate-950" : isDark ? "bg-cyan-400/15 text-cyan-300" : "bg-cyan-50 text-cyan-600")}>#{item.rank}</span>
                          {item.rank === 1 && <span className="text-xs font-bold text-amber-500 md:hidden">第一</span>}
                        </button>

                        <button onClick={() => selectStock(item.code, item.name)} className="text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-black">{item.code}</span>
                            <span className={cn("font-semibold", muted)}>{item.name}</span>
                            {item.rank === 1 && <span className="hidden md:inline"><Badge tone="warn">第一</Badge></span>}
                          </div>
                          <p className={cn("mt-1 text-xs", muted)}>{item.market} / {item.industry}</p>
                        </button>

                        <button onClick={() => selectStock(item.code, item.name)} className="text-left">
                          <p className="text-xs md:hidden">成交價</p>
                          <p className="font-black">{formatNumber(item.price, 2)}</p>
                        </button>

                        <button onClick={() => selectStock(item.code, item.name)} className="text-left">
                          <p className="text-xs md:hidden">漲跌幅</p>
                          <p className={cn("font-black", moveColorClass(item.changePct))}>
                            {item.change === null || item.changePct === null ? "--" : `${item.change > 0 ? "+" : ""}${formatNumber(item.change, 2)} / ${formatPctValue(item.changePct)}`}
                          </p>
                        </button>

                        <button onClick={() => selectStock(item.code, item.name)} className="text-left">
                          <p className="text-xs md:hidden">成交量</p>
                          <p className="font-bold">{formatCount(item.volume)}</p>
                        </button>

                        <button onClick={() => selectStock(item.code, item.name)} className="text-left">
                          <p className="text-xs md:hidden">成交額</p>
                          <p className="font-bold">{formatTurnover(item.turnover)}</p>
                        </button>

                        <div className="flex items-center md:justify-end">
                          <button
                            onClick={() => toggleWatch(item.code)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-bold transition",
                              inWatch
                                ? "border-amber-400 bg-amber-400/15 text-amber-500"
                                : isDark
                                  ? "border-white/10 bg-white/5 text-slate-200 hover:border-cyan-400/60"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-cyan-400/60"
                            )}
                          >
                            {inWatch ? "已加入" : "加入自選"}
                          </button>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="p-5"><EmptyState title="熱門排行載入中" /></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function WatchStatusCard({
  summary,
  validCount,
  totalCount,
  strongest,
  weakest,
  topIndustry,
  missingCount,
  theme
}: {
  summary: ReactNode;
  validCount: number;
  totalCount: number;
  strongest: Quote | null;
  weakest: Quote | null;
  topIndustry: [string, number] | null;
  missingCount: number;
  theme: Theme;
}) {
  const isDark = theme === "dark";
  return (
    <div className={cn("rounded-3xl border p-5 shadow-sm", isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-white")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("text-sm", isDark ? "text-slate-400" : "text-slate-500")}>自選狀態</p>
          <p className="mt-2 text-3xl font-black leading-tight md:text-4xl">{summary}</p>
        </div>
        <Badge>{validCount}/{totalCount} 檔</Badge>
      </div>
      <div className={cn("mt-4 grid gap-2 text-xs", isDark ? "text-slate-300" : "text-slate-600")}>
        <div className="flex items-center justify-between gap-3">
          <span>最強</span>
          <span className={cn("font-bold", moveColorClass(strongest?.changePct))}>{strongest ? quoteMoveLabel(strongest) : "待資料"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>最弱</span>
          <span className={cn("font-bold", moveColorClass(weakest?.changePct))}>{weakest ? quoteMoveLabel(weakest) : "待資料"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>主要類別</span>
          <span className="text-right font-bold">{topIndustry ? `${topIndustry[0]}：${topIndustry[1]} 檔` : "待資料"}</span>
        </div>
        {missingCount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span>待資料</span>
            <span className="font-bold text-amber-500">{missingCount} 檔</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MarketBreadthCard({
  title,
  count,
  total,
  tone,
  headline,
  lines,
  industryText,
  examples,
  loading,
  theme
}: {
  title: string;
  count: number;
  total: number;
  tone: "up" | "down" | "limitUp" | "limitDown";
  headline: string;
  lines: string[];
  industryText: string;
  examples: string[];
  loading: boolean;
  theme: Theme;
}) {
  const isDark = theme === "dark";
  const isPositive = tone === "up" || tone === "limitUp";
  const accent = isPositive ? "text-red-500" : "text-emerald-500";
  const chipTone = isPositive ? "up" : "down";
  return (
    <div className={cn("rounded-3xl border p-4 shadow-sm", isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-white")}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("text-sm", isDark ? "text-slate-400" : "text-slate-500")}>{title}</p>
        <Badge tone={chipTone}>{formatShare(count, total)}</Badge>
      </div>
      <p className={cn("mt-2 text-3xl font-black tracking-tight", accent)}>{loading ? "載入中" : `${formatCount(count)} 檔`}</p>
      <p className={cn("mt-2 text-xs font-bold", isDark ? "text-slate-300" : "text-slate-600")}>{headline}</p>

      <div className={cn("mt-4 space-y-1.5 text-xs", isDark ? "text-slate-300" : "text-slate-600")}>
        {lines.map((line) => (
          <div key={line} className="flex items-center justify-between gap-3">
            <span>{line.split("：")[0]}</span>
            <span className="font-bold">{line.split("：").slice(1).join("：")}</span>
          </div>
        ))}
      </div>

      <div className={cn("mt-4 rounded-2xl border p-3 text-xs", isDark ? "border-white/10 bg-slate-950/40" : "border-slate-200 bg-slate-50")}>
        <p className={cn("font-bold", isDark ? "text-slate-300" : "text-slate-700")}>主要族群</p>
        <p className={cn("mt-1 leading-5", isDark ? "text-slate-400" : "text-slate-500")}>{industryText}</p>
      </div>

      <div className="mt-3">
        <p className={cn("mb-1.5 text-xs font-bold", isDark ? "text-slate-300" : "text-slate-700")}>
          {isPositive ? "強勢代表" : "弱勢代表"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(examples.length ? examples : ["暫無代表股"]).map((item) => (
            <span key={item} className={cn("rounded-full px-2 py-1 text-[11px] font-bold", isDark ? "bg-white/10 text-slate-300" : "bg-slate-100 text-slate-600")}>{item}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, theme }: { label: string; value: ReactNode; theme: Theme }) {
  const isDark = theme === "dark";
  return (
    <div className={cn("rounded-3xl border p-5 shadow-sm", isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-white")}>
      <p className={cn("text-sm", isDark ? "text-slate-400" : "text-slate-500")}>{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
