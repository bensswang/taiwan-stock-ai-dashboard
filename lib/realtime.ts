import type { Quote, StockMaster } from "./types";
import { parseNumber } from "./format";
import { getAllStockMaster, getTwseDailyQuotes } from "./twse";

const TWSE_MIS_STOCK_INFO = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

// TWSE MIS 欄位常見意義：
// c=代號, n=名稱, z=最近成交價, y=昨收, o=開盤, h=最高, l=最低,
// v=累計成交量, d=資料日期, t=資料時間, ex=tse/otc。
type MisStockRow = Record<string, string | number | null | undefined>;

type MisStockResponse = {
  msgArray?: MisStockRow[];
  userDelay?: number;
  rtcode?: string;
  rtmessage?: string;
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function channelFor(code: string, stock?: StockMaster) {
  const normalized = normalizeCode(code);
  const prefix = stock?.market === "上櫃" ? "otc" : "tse";
  return `${prefix}_${normalized}.tw`;
}

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseMisNumber(value: unknown): number | null {
  const text = asText(value);
  if (!text || text === "-" || text === "--" || text.toLowerCase() === "null") return null;
  return parseNumber(text);
}

function misDateTime(row: MisStockRow): string {
  const d = asText(row.d);
  const t = asText(row.t);
  if (/^\d{8}$/.test(d) && /^\d{1,2}:\d{2}:\d{2}$/.test(t)) {
    const yyyy = d.slice(0, 4);
    const mm = d.slice(4, 6);
    const dd = d.slice(6, 8);
    const hhmmss = t.length === 7 ? `0${t}` : t;
    const date = new Date(`${yyyy}-${mm}-${dd}T${hhmmss}+08:00`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function mapMisRow(row: MisStockRow, stock?: StockMaster): Quote | null {
  const code = normalizeCode(asText(row.c) || stock?.code || "");
  if (!code) return null;

  const price = parseMisNumber(row.z);
  const previousClose = parseMisNumber(row.y);
  const open = parseMisNumber(row.o);
  const high = parseMisNumber(row.h);
  const low = parseMisNumber(row.l);
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const volume = parseMisNumber(row.v);
  const turnover = price && volume ? price * volume * 1000 : null;
  const name = asText(row.n) || stock?.shortName || stock?.name || code;
  const ex = asText(row.ex);

  return {
    code,
    name,
    market: stock?.market || (ex === "otc" ? "上櫃" : "上市"),
    industry: stock?.industry,
    price,
    previousClose,
    open,
    high,
    low,
    change,
    changePct,
    volume,
    turnover,
    marketCap: stock?.issuedShares && price ? stock.issuedShares * price : null,
    updatedAt: misDateTime(row),
    source: "TWSE MIS 近即時行情 getStockInfo.jsp",
    note: "TWSE MIS 為基本市況報導資料，盤中較接近即時；實際延遲仍以資料來源為準。"
  } satisfies Quote;
}

async function fetchMisRows(channels: string[], revalidate = 15): Promise<MisStockRow[]> {
  if (!channels.length) return [];
  const url = `${TWSE_MIS_STOCK_INFO}?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0&_=${Date.now()}`;
  const res = await fetch(url, {
    next: { revalidate },
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://mis.twse.com.tw/stock/fibest.jsp?stock=2330",
      "User-Agent": "taiwan-stock-ai-dashboard-v19/1.0"
    }
  });
  if (!res.ok) throw new Error(`TWSE MIS failed: ${res.status}`);
  const json = (await res.json()) as MisStockResponse;
  return Array.isArray(json.msgArray) ? json.msgArray : [];
}

export async function getRealtimeQuotes(codes: string[]): Promise<Quote[]> {
  const wanted = Array.from(new Set(codes.map(normalizeCode).filter((code): code is string => Boolean(code))));
  if (!wanted.length) return [];

  const stocks = await getAllStockMaster();
  const byCode = new Map(stocks.map((item) => [normalizeCode(item.code), item]));
  const channels = wanted.map((code) => channelFor(code, byCode.get(code)));
  const rows = (await Promise.allSettled(chunk(channels, 80).map((group) => fetchMisRows(group))))
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  const rowByCode = new Map(rows.map((row) => [normalizeCode(asText(row.c)), row]));
  const mapped = wanted
    .map((code) => mapMisRow(rowByCode.get(code) || {}, byCode.get(code)))
    .filter((item): item is Quote => Boolean(item && item.price !== null));

  return mapped;
}

export async function getRealtimeQuote(code: string): Promise<Quote | null> {
  const [quote] = await getRealtimeQuotes([code]);
  return quote || null;
}

export async function getQuotesWithRealtimeOverlay(): Promise<Quote[]> {
  const daily = await getTwseDailyQuotes();
  const codes = daily.map((item) => item.code);

  try {
    const realtime = await getRealtimeQuotes(codes);
    const realtimeByCode = new Map(realtime.map((item) => [item.code, item]));
    return daily.map((item) => {
      const live = realtimeByCode.get(item.code);
      return live ? { ...item, ...live, turnover: live.turnover ?? item.turnover ?? null } : item;
    });
  } catch (error) {
    console.warn("TWSE MIS realtime overlay failed; falling back to daily quotes", error);
    return daily;
  }
}

export async function getBatchQuotesWithFallback(codes: string[]): Promise<Quote[]> {
  const wanted = Array.from(new Set(codes.map(normalizeCode).filter((code): code is string => Boolean(code))));
  if (!wanted.length) return [];

  const realtime = await getRealtimeQuotes(wanted).catch(() => [] as Quote[]);
  const realtimeByCode = new Map(realtime.map((item) => [item.code, item]));
  const missing = wanted.filter((code) => !realtimeByCode.has(code));

  if (missing.length) {
    const daily = await getTwseDailyQuotes().catch(() => [] as Quote[]);
    const dailyByCode = new Map(daily.map((item) => [normalizeCode(item.code), item]));
    for (const code of missing) {
      const fallback = dailyByCode.get(code);
      if (fallback) realtimeByCode.set(code, fallback);
    }
  }

  return wanted.map((code) => realtimeByCode.get(code)).filter((item): item is Quote => Boolean(item));
}
