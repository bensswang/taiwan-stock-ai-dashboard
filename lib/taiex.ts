import { parseNumber } from "./format";

export type TaiexRange = "1w" | "1m" | "1y";

export type TaiexPoint = {
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

type MisIndexRow = Record<string, string | number | null | undefined>;
type MisIndexResponse = { msgArray?: MisIndexRow[] };

type TwseTaiexHistoryResponse = {
  fields?: string[];
  data?: string[][];
  stat?: string;
};

async function fetchJson<T>(url: string, revalidate = 60): Promise<T> {
  const res = await fetch(url, {
    next: { revalidate },
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "taiwan-stock-ai-dashboard-v19/1.0"
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fetch failed ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}

function normalizeTaiexRange(range: string | null | undefined): TaiexRange {
  if (range === "1m" || range === "1y") return range;
  return "1w";
}

function yahooRange(range: TaiexRange) {
  if (range === "1y") return "1y";
  return "1mo";
}

function wantedCount(range: TaiexRange) {
  if (range === "1y") return 252;
  if (range === "1m") return 23;
  return 7;
}

function monthsToFetch(range: TaiexRange) {
  if (range === "1y") return 13;
  if (range === "1m") return 3;
  return 2;
}

function formatDateParam(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}${month}01`;
}

function monthParams(range: TaiexRange) {
  const today = new Date();
  return Array.from({ length: monthsToFetch(range) }, (_, index) => {
    const d = new Date(today.getFullYear(), today.getMonth() - index, 1);
    return formatDateParam(d);
  });
}

function shortDate(iso: string) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseMisNumber(value: unknown): number | null {
  const text = asText(value);
  if (!text || text === "-" || text === "--" || text.toLowerCase() === "null") return null;
  return parseNumber(text);
}

function fieldIndex(fields: string[] | undefined, keyword: string, fallback: number) {
  if (!fields?.length) return fallback;
  const index = fields.findIndex((field) => String(field).includes(keyword));
  return index >= 0 ? index : fallback;
}

function parseTwseHistoryDate(value: unknown): string | null {
  const text = asText(value);
  const normalized = text.replace(/-/g, "/");
  const parts = normalized.split("/").map((item) => item.trim());
  if (parts.length >= 3) {
    const rawYear = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (Number.isFinite(rawYear) && Number.isFinite(month) && Number.isFinite(day)) {
      const year = rawYear < 1911 ? rawYear + 1911 : rawYear;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return null;
}

async function fetchTwseTaiexMonth(dateParam: string): Promise<TaiexPoint[]> {
  const urls = [
    `https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${dateParam}`,
    `https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${dateParam}`
  ];

  for (const url of urls) {
    try {
      const json = await fetchJson<TwseTaiexHistoryResponse>(url, 60 * 60);
      const fields = json.fields || [];
      const dateIndex = fieldIndex(fields, "日期", 0);
      const openIndex = fieldIndex(fields, "開盤", 1);
      const highIndex = fieldIndex(fields, "最高", 2);
      const lowIndex = fieldIndex(fields, "最低", 3);
      const closeIndex = fieldIndex(fields, "收盤", 4);

      const rows: TaiexPoint[] = [];

      for (const row of json.data || []) {
        const date = parseTwseHistoryDate(row[dateIndex]);
        if (!date) continue;

        const point: TaiexPoint = {
          date,
          label: shortDate(date),
          open: parseNumber(row[openIndex]),
          high: parseNumber(row[highIndex]),
          low: parseNumber(row[lowIndex]),
          close: parseNumber(row[closeIndex]),
          change: null,
          changePct: null,
          volume: null,
          source: "TWSE 加權指數歷史日線"
        };

        if (point.close !== null && Number.isFinite(point.close)) rows.push(point);
      }

      return rows;
    } catch {
      // Try the next TWSE endpoint shape.
    }
  }

  return [];
}

async function getTwseTaiexHistory(range: TaiexRange): Promise<TaiexPoint[]> {
  const results = await Promise.allSettled(monthParams(range).map((dateParam) => fetchTwseTaiexMonth(dateParam)));
  return results
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((a, b) => a.date.localeCompare(b.date));
}

function misDate(row: MisIndexRow): string {
  const d = asText(row.d);
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return new Date().toISOString().slice(0, 10);
}

function misDateTime(row: MisIndexRow): string {
  const d = asText(row.d);
  const t = asText(row.t);
  if (/^\d{8}$/.test(d) && /^\d{1,2}:\d{2}:\d{2}$/.test(t)) {
    const hhmmss = t.length === 7 ? `0${t}` : t;
    const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${hhmmss}+08:00`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

async function getTwseMisTaiex(): Promise<TaiexPoint | null> {
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_=${Date.now()}`;
  const res = await fetch(url, {
    next: { revalidate: 15 },
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://mis.twse.com.tw/stock/fibest.jsp?stock=t00",
      "User-Agent": "taiwan-stock-ai-dashboard-v19/1.0"
    }
  });
  if (!res.ok) return null;
  const json = (await res.json()) as MisIndexResponse;
  const row = json.msgArray?.[0];
  if (!row) return null;

  const close = parseMisNumber(row.z);
  const previousClose = parseMisNumber(row.y);
  const change = close !== null && previousClose !== null ? close - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const date = misDate(row);
  if (close === null) return null;

  return {
    date,
    label: shortDate(date),
    open: parseMisNumber(row.o),
    high: parseMisNumber(row.h),
    low: parseMisNumber(row.l),
    close,
    change,
    changePct,
    volume: parseMisNumber(row.v),
    source: "TWSE MIS 近即時加權指數",
    updatedAt: misDateTime(row)
  };
}

export async function getTaiexSeries(rangeInput = "1w"): Promise<TaiexPoint[]> {
  const range = normalizeTaiexRange(rangeInput);
  const count = wantedCount(range);
  const url = `https://query1.finance.yahoo.com/v9/finance/chart/${encodeURIComponent("^TWII")}?range=${yahooRange(range)}&interval=1d`;

  const [yahooResult, twseHistoryResult, realtimeResult] = await Promise.allSettled([
    fetchJson<YahooChartResponse>(url, 60),
    getTwseTaiexHistory(range),
    getTwseMisTaiex()
  ]);

  const json = yahooResult.status === "fulfilled" ? yahooResult.value : {};
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  const yahooRows: TaiexPoint[] = [];

  if (quote) {
    timestamps.forEach((timestamp, index) => {
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      const point: TaiexPoint = {
        date,
        label: shortDate(date),
        open: quote.open?.[index] ?? null,
        high: quote.high?.[index] ?? null,
        low: quote.low?.[index] ?? null,
        close: quote.close?.[index] ?? null,
        change: null,
        changePct: null,
        volume: quote.volume?.[index] ?? null,
        source: "Yahoo Finance chart API / ^TWII"
      };
      if (point.close !== null && Number.isFinite(point.close)) yahooRows.push(point);
    });
  }

  const twseHistoryRows = twseHistoryResult.status === "fulfilled" ? twseHistoryResult.value : [];
  const map = new Map<string, TaiexPoint>();

  for (const row of yahooRows) map.set(row.date, row);
  for (const row of twseHistoryRows) {
    const current = map.get(row.date);
    map.set(row.date, current ? { ...row, ...current, source: `${current.source}；${row.source}` } : row);
  }

  const realtime = realtimeResult.status === "fulfilled" ? realtimeResult.value : null;
  if (realtime) {
    const current = map.get(realtime.date);
    map.set(realtime.date, current ? { ...current, ...realtime } : realtime);
  }

  const sorted = Array.from(map.values())
    .filter((row) => row.close !== null && Number.isFinite(row.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  const wanted = sorted.slice(-count);
  return wanted.map((row, index) => {
    const sortedIndex = sorted.findIndex((item) => item.date === row.date);
    const previous = index > 0
      ? wanted[index - 1]?.close ?? null
      : sorted[sortedIndex - 1]?.close ?? result?.meta?.previousClose ?? result?.meta?.chartPreviousClose ?? null;
    const change = row.change ?? (row.close !== null && previous ? row.close - previous : null);
    const changePct = row.changePct ?? (change !== null && previous ? (change / previous) * 100 : null);
    return {
      ...row,
      label: shortDate(row.date),
      close: row.close !== null ? parseNumber(row.close) : null,
      open: row.open !== null ? parseNumber(row.open) : null,
      high: row.high !== null ? parseNumber(row.high) : null,
      low: row.low !== null ? parseNumber(row.low) : null,
      volume: row.volume !== null ? parseNumber(row.volume) : null,
      change,
      changePct
    } satisfies TaiexPoint;
  });
}
