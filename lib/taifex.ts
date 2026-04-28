import { parseNumber } from "./format";

export type FuturesSession = "regular" | "after" | "combined";
export type FuturesPoint = {
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
  session: FuturesSession;
  source: string;
};

const TAIFEX_DAILY_EXCEL = "https://www.taifex.com.tw/cht/3/futDailyMarketExcel";

function twDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function isoFromSlashDate(value: string) {
  const parts = value.trim().split(/[/-]/).map((part) => part.padStart(2, "0"));
  if (parts.length !== 3) return "";
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function parseSignedNumber(value: string): number | null {
  const raw = value.replace(/\s+/g, "").replace(/,/g, "");
  const sign = raw.includes("▼") || raw.includes("-") ? -1 : 1;
  const numeric = raw.replace(/[▲▼+%]/g, "").replace(/^-/, "");
  const n = Number(numeric);
  return Number.isFinite(n) ? sign * n : null;
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildUrl(session: FuturesSession, date?: Date) {
  const params = new URLSearchParams();
  if (session === "after") params.set("marketCode", "1");
  if (date) {
    params.set("queryDate", twDate(date));
    params.set("commodity_id", "TX");
  }
  const query = params.toString();
  return query ? `${TAIFEX_DAILY_EXCEL}?${query}` : TAIFEX_DAILY_EXCEL;
}

async function fetchTaifexHtml(session: FuturesSession, date?: Date) {
  const res = await fetch(buildUrl(session, date), {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      "User-Agent": "taiwan-stock-ai-dashboard-v3/1.0"
    }
  });
  if (!res.ok) throw new Error(`期交所資料讀取失敗：${res.status}`);
  return res.text();
}

function parseTxFrontMonth(html: string, session: FuturesSession): FuturesPoint | null {
  const text = stripHtml(html);
  const dateMatch = text.match(/日期：\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/);
  const date = dateMatch ? isoFromSlashDate(dateMatch[1]) : new Date().toISOString().slice(0, 10);
  const rowMatch = text.match(/\bTX\s+(\d{6}(?:W\d)?)\s+(-|[\d,.]+)\s+(-|[\d,.]+)\s+(-|[\d,.]+)\s+(-|[\d,.]+)\s+([▲▼+\-]?\s*[\d,.]+)\s+([▲▼+\-]?\s*[\d,.]+)%\s+(-|[\d,]+)/);
  if (!rowMatch) return null;
  const [, contract, open, high, low, close, change, changePct, volume] = rowMatch;
  return {
    date,
    label: date.slice(5).replace("-", "/"),
    contract,
    open: parseNumber(open),
    high: parseNumber(high),
    low: parseNumber(low),
    close: parseNumber(close),
    change: parseSignedNumber(change),
    changePct: parseSignedNumber(changePct),
    volume: parseNumber(volume),
    session,
    source: session === "after" ? "TAIFEX 期貨每日交易行情（盤後）" : "TAIFEX 期貨每日交易行情（一般 / 合併）"
  };
}

async function fetchOne(session: FuturesSession, date?: Date) {
  const html = await fetchTaifexHtml(session === "combined" ? "regular" : session, date);
  return parseTxFrontMonth(html, session);
}

function candidateDates(days: number) {
  const dates: Date[] = [];
  const now = new Date();
  for (let i = 0; dates.length < Math.max(days * 3, 8) && i < 21; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const day = d.getDay();
    if (day !== 0 && day !== 6) dates.push(d);
  }
  return dates;
}

export async function getTaifexTxSeries(rawSession: string, rawRange: string): Promise<FuturesPoint[]> {
  const session: FuturesSession = rawSession === "regular" || rawSession === "after" || rawSession === "combined" ? rawSession : "combined";
  const days = rawRange === "today" ? 1 : rawRange === "2d" ? 2 : rawRange === "3d" ? 3 : rawRange === "4d" ? 4 : 5;
  const dates = candidateDates(days);

  const results = await Promise.allSettled(dates.map((date) => fetchOne(session, date)));
  const byDate = new Map<string, FuturesPoint>();
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    byDate.set(`${result.value.date}-${result.value.session}`, result.value);
  }

  if (byDate.size === 0) {
    const latest = await fetchOne(session);
    if (latest) byDate.set(`${latest.date}-${latest.session}`, latest);
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);
}
