import type { PricePoint, Quote, StockMaster } from "./types";
import { MANUAL_ETFS } from "./mock";
import { parseNumber, rocDateToIso, toYmd } from "./format";

const TWSE_BASE = "https://openapi.twse.com.tw/v1";
const TWSE_STOCK_DAY_ALL = `${TWSE_BASE}/exchangeReport/STOCK_DAY_ALL`;
const TWSE_LISTED_COMPANIES = `${TWSE_BASE}/opendata/t187ap03_L`;
const TWSE_HISTORY = "https://www.twse.com.tw/exchangeReport/STOCK_DAY";

// TPEx official OpenAPI. This endpoint is commonly used as a broad OTC stock list.
const TPEX_MAINBOARD_PERATIO = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis";

async function fetchJson<T>(url: string, revalidate = 300): Promise<T> {
  const res = await fetch(url, {
    next: { revalidate },
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "taiwan-stock-ai-dashboard-v19/1.0"
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fetch failed ${res.status}: ${url} ${text.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}

function mustHaveRows<T>(rows: T[], label: string): T[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${label} returned no rows`);
  return rows;
}

function valueOf(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function isEtfCode(code: string, name = "") {
  return /^00\d/.test(code) || /ETF|ETN|指數股票型|主動式/.test(name);
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function monthQueryDatesBack(months: number): Date[] {
  const now = new Date();
  const dates: Date[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    // TWSE STOCK_DAY is month-based. Querying the first calendar day of each month
    // is more stable than using "today" or month-end, especially for some ETFs.
    dates.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  }
  return dates;
}

function cutoffIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function sanitizeHistory(points: PricePoint[]): PricePoint[] {
  const cleaned = points.filter((p) => p.date && isNumber(p.close) && p.close > 0);
  if (cleaned.length < 4) return cleaned;

  const last = cleaned[cleaned.length - 1];
  const recent = cleaned.slice(Math.max(0, cleaned.length - 6), -1).map((p) => p.close).filter(isNumber);
  if (recent.length < 3 || !isNumber(last.close)) return cleaned;

  const avg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const prev = cleaned[cleaned.length - 2]?.close ?? null;

  // Guard against obvious bad tail points such as a stale/failed parse that becomes an
  // implausibly tiny final close, which would create a fake vertical crash on the chart.
  if (avg > 0 && last.close < avg * 0.4 && isNumber(prev) && prev > avg * 0.7) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
}

function mergeStockMasters(...groups: StockMaster[][]): StockMaster[] {
  const map = new Map<string, StockMaster>();
  for (const group of groups) {
    for (const item of group) {
      if (!item.code) continue;
      const current = map.get(item.code);
      if (!current) {
        map.set(item.code, item);
        continue;
      }
      const aliases = [...(current.aliases || []), ...(item.aliases || [])].filter((alias): alias is string => Boolean(alias));
      map.set(item.code, {
        ...current,
        ...item,
        name: current.name.length >= item.name.length ? current.name : item.name,
        shortName: current.shortName || item.shortName,
        industry: current.industry || item.industry,
        aliases: Array.from(new Set(aliases)),
        issuedShares: current.issuedShares ?? item.issuedShares ?? null
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export async function getTwseListedStocks(): Promise<StockMaster[]> {
  const rows = await fetchJson<Record<string, unknown>[]>(TWSE_LISTED_COMPANIES, 24 * 60 * 60);
  const mapped: StockMaster[] = [];

  for (const row of mustHaveRows(rows, "TWSE listed companies")) {
    const code = valueOf(row, ["公司代號", "Code", "證券代號"]);
    const name = valueOf(row, ["公司名稱", "Name", "證券名稱"]);
    const shortName = valueOf(row, ["公司簡稱", "簡稱", "Name"]);
    if (!code || !name) continue;

    const englishAlias = valueOf(row, ["英文簡稱", "英文名稱", "English Name"]);
    mapped.push({
      code,
      name,
      shortName: shortName || name,
      market: "上市",
      industry: valueOf(row, ["產業別", "Industry"]) || undefined,
      aliases: englishAlias ? [englishAlias] : [],
      issuedShares: parseNumber(row["已發行普通股數或TDR原股發行股數"])
    });
  }

  return mustHaveRows(mapped, "mapped TWSE listed companies");
}

export async function getTwseDailySecuritiesMaster(): Promise<StockMaster[]> {
  const rows = await fetchJson<Record<string, unknown>[]>(TWSE_STOCK_DAY_ALL, 60);
  const mapped: StockMaster[] = [];

  for (const row of mustHaveRows(rows, "TWSE daily securities")) {
    const code = valueOf(row, ["Code", "證券代號", "代號"]);
    const name = valueOf(row, ["Name", "證券名稱", "名稱"]);
    if (!code || !name) continue;

    const market: StockMaster["market"] = isEtfCode(code, name) ? "ETF" : "上市";
    mapped.push({
      code,
      name,
      shortName: name,
      market,
      industry: market === "ETF" ? "ETF" : undefined,
      aliases: []
    });
  }

  return mustHaveRows(mapped, "mapped TWSE daily securities");
}

export async function getTpexMainboardStocks(): Promise<StockMaster[]> {
  try {
    const rows = await fetchJson<Record<string, unknown>[]>(TPEX_MAINBOARD_PERATIO, 24 * 60 * 60);
    const mapped: StockMaster[] = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const code = valueOf(row, ["SecuritiesCompanyCode", "SecurityCode", "Code", "股票代號", "證券代號", "代號"]);
      const name = valueOf(row, ["CompanyName", "SecuritiesCompanyName", "SecurityName", "Name", "股票名稱", "證券名稱", "名稱"]);
      if (!code || !name) continue;
      mapped.push({ code, name, shortName: name, market: "上櫃", industry: undefined, aliases: [] });
    }

    return mapped;
  } catch {
    return [];
  }
}

export async function getAllStockMaster(): Promise<StockMaster[]> {
  const [listed, twseDaily, tpex] = await Promise.allSettled([
    getTwseListedStocks(),
    getTwseDailySecuritiesMaster(),
    getTpexMainboardStocks()
  ]);
  const groups: StockMaster[][] = [];
  if (listed.status === "fulfilled") groups.push(listed.value);
  if (twseDaily.status === "fulfilled") groups.push(twseDaily.value);
  if (tpex.status === "fulfilled") groups.push(tpex.value);

  const merged = mergeStockMasters(...groups, MANUAL_ETFS);
  return mustHaveRows(merged, "all stock master");
}

export async function searchAllStockMaster(q: string, limit = 50): Promise<StockMaster[]> {
  const query = normalizeKey(q);
  const all = await getAllStockMaster();
  if (!query) return all.slice(0, Math.min(limit, 200));
  return all
    .filter((stock) => {
      const haystack = [stock.code, stock.name, stock.shortName, stock.market, stock.industry, ...(stock.aliases || [])]
        .filter((item): item is string => Boolean(item))
        .map((item) => normalizeKey(item))
        .join(" ");
      return haystack.includes(query);
    })
    .slice(0, Math.min(limit, 200));
}

export async function getTwseDailyQuotes(): Promise<Quote[]> {
  const [stocks, rows] = await Promise.all([
    getAllStockMaster(),
    fetchJson<Record<string, unknown>[]>(TWSE_STOCK_DAY_ALL, 60)
  ]);
  const byCode = new Map(stocks.map((s) => [s.code, s]));
  const quotes: Quote[] = [];

  for (const row of mustHaveRows(rows, "TWSE daily quotes")) {
    const code = valueOf(row, ["Code", "證券代號", "代號"]);
    if (!code) continue;

    const fallbackName = valueOf(row, ["Name", "證券名稱", "名稱"]) || code;
    const stock = byCode.get(code) ?? {
      code,
      name: fallbackName,
      shortName: fallbackName,
      market: isEtfCode(code, fallbackName) ? "ETF" as const : "上市" as const
    };
    const price = parseNumber(row["ClosingPrice"] ?? row["收盤價"]);
    const open = parseNumber(row["OpeningPrice"] ?? row["開盤價"]);
    const high = parseNumber(row["HighestPrice"] ?? row["最高價"]);
    const low = parseNumber(row["LowestPrice"] ?? row["最低價"]);
    const change = parseNumber(row["Change"] ?? row["漲跌價差"]);
    const previousClose = isNumber(price) && isNumber(change) ? price - change : null;
    const changePct = isNumber(change) && previousClose ? (change / previousClose) * 100 : null;
    const volume = parseNumber(row["TradeVolume"] ?? row["成交股數"]);
    const turnover = parseNumber(row["TradeValue"] ?? row["成交金額"]);

    quotes.push({
      code,
      name: stock.shortName || stock.name,
      market: stock.market,
      industry: stock.industry,
      price,
      previousClose,
      open,
      high,
      low,
      change,
      changePct,
      volume: volume !== null ? Math.round(volume / 1000) : null,
      turnover,
      marketCap: stock.issuedShares && price ? stock.issuedShares * price : null,
      updatedAt: new Date().toISOString(),
      source: "TWSE OpenAPI /exchangeReport/STOCK_DAY_ALL"
    });
  }

  return mustHaveRows(quotes, "mapped TWSE daily quotes");
}

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
      };
    }>;
  };
};

function yahooSymbol(code: string): string {
  return `${normalizeCode(code)}.TW`;
}

function yahooRange(range: string): string {
  if (range === "1w") return "1mo";
  if (range === "1m") return "2mo";
  if (range === "1y") return "1y";
  return "6mo";
}

async function getYahooQuote(code: string, stock?: StockMaster): Promise<Quote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v9/finance/chart/${encodeURIComponent(yahooSymbol(code))}?range=5d&interval=1d`;
    const json = await fetchJson<YahooChartResponse>(url, 60);
    const result = json.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const close = quote?.close || [];
    const open = quote?.open || [];
    const high = quote?.high || [];
    const low = quote?.low || [];
    const volume = quote?.volume || [];
    const lastIndex = close.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
    if (lastIndex === undefined) return null;
    const price = close[lastIndex] ?? result?.meta?.regularMarketPrice ?? null;
    const previousClose = result?.meta?.previousClose ?? result?.meta?.chartPreviousClose ?? (lastIndex > 0 ? close[lastIndex - 1] : null) ?? null;
    const change = isNumber(price) && isNumber(previousClose) ? price - previousClose : null;
    const changePct = isNumber(change) && previousClose ? (change / previousClose) * 100 : null;

    return {
      code: normalizeCode(code),
      name: stock?.shortName || stock?.name || normalizeCode(code),
      market: stock?.market || "未知",
      industry: stock?.industry,
      price,
      previousClose,
      open: open[lastIndex] ?? null,
      high: high[lastIndex] ?? null,
      low: low[lastIndex] ?? null,
      change,
      changePct,
      volume: volume[lastIndex] !== null && volume[lastIndex] !== undefined ? Math.round((volume[lastIndex] || 0) / 1000) : null,
      marketCap: null,
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance chart API fallback"
    };
  } catch (error) {
    console.warn("getYahooQuote fallback failed", error);
    return null;
  }
}

async function getYahooHistory(code: string, range: string): Promise<PricePoint[]> {
  const url = `https://query1.finance.yahoo.com/v9/finance/chart/${encodeURIComponent(yahooSymbol(code))}?range=${yahooRange(range)}&interval=1d`;
  const json = await fetchJson<YahooChartResponse>(url, 60 * 60);
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  const close = quote?.close || [];
  const open = quote?.open || [];
  const high = quote?.high || [];
  const low = quote?.low || [];
  const volume = quote?.volume || [];
  const points: PricePoint[] = [];

  for (const [index, ts] of timestamps.entries()) {
    const point: PricePoint = {
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: open[index] ?? null,
      high: high[index] ?? null,
      low: low[index] ?? null,
      close: close[index] ?? null,
      volume: volume[index] ?? null
    };
    if (isNumber(point.close)) points.push(point);
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getTwseQuote(code: string): Promise<Quote | null> {
  const normalizedCode = normalizeCode(code);
  const quotes = await getTwseDailyQuotes();
  const found = quotes.find((q) => q.code === normalizedCode);
  if (found) return found;
  const stock = (await getAllStockMaster()).find((s) => s.code === normalizedCode);
  return getYahooQuote(normalizedCode, stock);
}

export async function getTwseHistory(code: string, range: string): Promise<PricePoint[]> {
  const normalizedCode = normalizeCode(code);
  const days = range === "1w" ? 7 : range === "1m" ? 31 : range === "3m" ? 93 : 366;
  const months = range === "1w" ? 2 : range === "1m" ? 3 : range === "3m" ? 5 : 14;
  const dates = monthQueryDatesBack(months);
  const settled = await Promise.allSettled(
    dates.map(async (date) => {
      const url = `${TWSE_HISTORY}?response=json&date=${toYmd(date)}&stockNo=${encodeURIComponent(normalizedCode)}`;
      const json = await fetchJson<{ data?: unknown[][]; stat?: string }>(url, 60 * 60 * 6);
      return json.data ?? [];
    })
  );

  const byDate = new Map<string, PricePoint>();
  for (const batch of settled) {
    if (batch.status !== "fulfilled") continue;
    for (const row of batch.value) {
      const point: PricePoint = {
        date: rocDateToIso(String(row[0] ?? "")),
        volume: parseNumber(row[1]),
        open: parseNumber(row[3]),
        high: parseNumber(row[4]),
        low: parseNumber(row[5]),
        close: parseNumber(row[6])
      };
      if (point.date && isNumber(point.close) && point.close > 0) byDate.set(point.date, point);
    }
  }

  try {
    const yahooPoints = await getYahooHistory(normalizedCode, range);
    for (const point of yahooPoints) byDate.set(point.date, point);
  } catch (error) {
    console.warn("getYahooHistory failed", error);
  }

  const points = sanitizeHistory(Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)));
  const cutoff = cutoffIso(days);
  const filtered = points.filter((p) => p.date >= cutoff);

  // Prefer the requested range, but if the source temporarily misses the latest month
  // still return the cleanest largest available window instead of injecting bad values.
  if (filtered.length >= Math.min(5, points.length)) return filtered;
  return points.slice(-days);
}
