export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { getNewsByStock } from "@/lib/news";
import { getAllStockMaster, getTwseHistory } from "@/lib/twse";
import type { NewsItem, PricePoint, Quote } from "@/lib/types";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type WatchlistDigest = {
  headline: string;
  paragraphs: string[];
  outlook: string;
  sourceCount: number;
  chartCount: number;
  targetDate: string;
  updatedAt: string;
  nextUpdateAt: string;
  provider: "openai" | "local-rules";
};

type DailyChartSignal = {
  code: string;
  name: string;
  latestDate: string | null;
  latestClose: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  volumeRatio: number | null;
  direction: "up" | "down" | "flat" | "unknown";
};

type CacheEntry = {
  expiresAt: number;
  data: WatchlistDigest;
};

const cache = new Map<string, CacheEntry>();

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function safeCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return uniq(
    input
      .map((item) => String(item || "").trim().toUpperCase())
      .filter((item): item is string => Boolean(item))
  ).slice(0, 12);
}

function taiwanDateString(dateLike: string | number | Date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(dateLike));
}

function isSameTaiwanDate(value: string, targetDate: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return taiwanDateString(time) === targetDate;
}

function textOf(news: NewsItem[]) {
  return news.map((item) => `${item.code} ${item.company} ${item.title} ${item.excerpt || ""} ${item.category || ""}`).join(" ");
}

function countWords(text: string, words: string[]) {
  return words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
}

function pctText(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function numText(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function cleanNewsTitle(item: NewsItem) {
  const source = item.source?.trim();
  const sourcePattern = source ? source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  return item.title
    .replace(/\s+/g, " ")
    .replace(sourcePattern ? new RegExp(`\\s[-－—]\\s${sourcePattern}$`) : /$^/, "")
    .trim();
}

function eventLine(item: NewsItem) {
  const category = item.category || "新聞事件";
  const title = cleanNewsTitle(item);
  return `${item.code} ${item.company}｜${category}｜${title}（${item.source}）`;
}

function compactJoin(items: string[], limit = 3) {
  return items.slice(0, limit).join("；");
}

function buildDailySignal(code: string, name: string, quote: Quote | undefined, history: PricePoint[]): DailyChartSignal {
  const valid = history.filter((point) => point.close !== null && point.close !== undefined).slice(-8);
  const latest = valid[valid.length - 1] || null;
  const previous = valid[valid.length - 2] || null;
  const latestClose = quote?.price ?? latest?.close ?? null;
  const previousClose = quote?.previousClose ?? previous?.close ?? null;
  const change = quote?.change ?? (latestClose !== null && previousClose ? latestClose - previousClose : null);
  const changePct = quote?.changePct ?? (change !== null && previousClose ? (change / previousClose) * 100 : null);
  const volume = quote?.volume ?? latest?.volume ?? null;
  const avgVolume = valid.slice(0, -1).map((point) => point.volume).filter((value): value is number => typeof value === "number" && value > 0);
  const avg = avgVolume.length ? avgVolume.reduce((sum, value) => sum + value, 0) / avgVolume.length : null;
  const volumeRatio = volume && avg ? volume / avg : null;
  const direction = changePct === null || changePct === undefined
    ? "unknown"
    : changePct > 0.05
      ? "up"
      : changePct < -0.05
        ? "down"
        : "flat";

  return {
    code,
    name,
    latestDate: latest?.date || quote?.updatedAt?.slice(0, 10) || null,
    latestClose,
    previousClose,
    change,
    changePct,
    volume,
    volumeRatio,
    direction
  };
}

function chartSentence(signals: DailyChartSignal[]) {
  const valid = signals.filter((item) => item.direction !== "unknown");
  const up = valid.filter((item) => item.direction === "up");
  const down = valid.filter((item) => item.direction === "down");
  const flat = valid.filter((item) => item.direction === "flat");
  const strongest = [...valid].sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))[0];
  const weakest = [...valid].sort((a, b) => (a.changePct ?? 999) - (b.changePct ?? 999))[0];
  const active = valid.filter((item) => (item.volumeRatio ?? 0) >= 1.2).sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0))[0];

  const breadth = valid.length
    ? `自選股最新日線中，上漲 ${up.length} 檔、下跌 ${down.length} 檔、持平 ${flat.length} 檔。`
    : "目前自選股缺少足夠日線資料，盤勢判讀會以可取得報價為主。";
  const leader = strongest
    ? `相對強勢為 ${strongest.code} ${strongest.name}（${pctText(strongest.changePct)}），相對弱勢為 ${weakest?.code} ${weakest?.name}（${pctText(weakest?.changePct)}）。`
    : "目前尚無法穩定排序強弱。";
  const volume = active
    ? `${active.code} ${active.name} 成交量相對近期均量較高，量能約為近期均量的 ${active.volumeRatio?.toFixed(1)} 倍。`
    : "成交量目前未見明顯放大訊號，後續仍要留意量價是否同步。";

  return { breadth, leader, volume, up, down, flat, strongest, weakest, active };
}

function localDigest(codes: string[], quotes: Quote[], todayNews: NewsItem[], signals: DailyChartSignal[], targetDate: string): WatchlistDigest {
  const now = new Date();
  const chart = chartSentence(signals);
  const eventRows = todayNews.slice(0, 8).map(eventLine);
  const topEvents = compactJoin(eventRows, 3);
  const byCode = new Map<string, NewsItem[]>();
  for (const item of todayNews) {
    const list = byCode.get(item.code) || [];
    list.push(item);
    byCode.set(item.code, list);
  }
  const focusedStocks = Array.from(byCode.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .map(([code, items]) => `${code} ${items[0]?.company || ""}：${items.slice(0, 2).map((item) => cleanNewsTitle(item)).join("；")}`);

  const headline = todayNews.length
    ? `今日自選股抓到 ${todayNews.length} 則當日消息，重點不是只判斷強弱，而是先看事件本身：${topEvents}。${chart.strongest ? `量價上目前相對突出的是 ${chart.strongest.code} ${chart.strongest.name}（${pctText(chart.strongest.changePct)}）。` : ""}`
    : `今日尚未抓到自選股的明確新聞，先保留既有畫面並改用當日報價與圖表判讀；${chart.breadth}${chart.strongest ? ` 目前相對突出的是 ${chart.strongest.code} ${chart.strongest.name}（${pctText(chart.strongest.changePct)}）。` : ""}`;

  const newsParagraph = todayNews.length
    ? `今日實際事件：${eventRows.slice(0, 5).join("；")}。這些內容只根據新聞標題、來源與時間整理，若要確認營收數字、訂單金額或公司說法，仍應點原文。`
    : `今日新聞來源暫時沒有明確事件，因此不硬套利多／利空模板；這一段會改看最新成交價、漲跌幅與成交量，避免把舊消息誤當成今天事件。`;

  const focusParagraph = focusedStocks.length
    ? `新聞集中度：${focusedStocks.join("；")}。若同一家公司有多則相似標題，可能是同一事件被不同媒體轉載，不能直接解讀成多個獨立事件。`
    : `自選股今日新聞分散或不足，量價面可先看 ${chart.leader} ${chart.volume}`;

  const chartParagraph = `${chart.breadth}${chart.leader} ${chart.volume} 這是輔助判斷，不取代新聞事件本身。`;

  return {
    headline,
    paragraphs: [newsParagraph, focusParagraph, chartParagraph],
    outlook: todayNews.length
      ? "後續先追蹤上述事件是否有公司公告、法說補充、法人報告或成交量延續；若只有標題沒有細節，介面會保留原文連結，避免摘要自行補不存在的數字。"
      : "後續等當日新聞補齊後再重新整理；在沒有新聞時，先觀察台積電、聯發科與 ETF 是否同步，以及成交量是否配合放大，不直接下買賣結論。",
    sourceCount: todayNews.length,
    chartCount: signals.filter((item) => item.latestClose !== null).length,
    targetDate,
    updatedAt: now.toISOString(),
    nextUpdateAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    provider: "local-rules"
  };
}

async function openAiDigest(codes: string[], quotes: Quote[], todayNews: NewsItem[], signals: DailyChartSignal[], targetDate: string): Promise<WatchlistDigest | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const now = new Date();

  const payload = {
    model,
    input: [
      {
        role: "system",
        content: [
          "你是台股資訊整理助理。請整理網站儀表板中的「自選股當日重點」。",
          "只能以今日新聞與最新日線/報價資料判讀。不要使用近五天或過去新聞當作今日事件。",
          "最重要：不要套用『強勢／弱勢／資金青睞』模板。headline 與 paragraphs 必須先說明今天實際發生了什麼事，例如公司公告、營收財報、法說、訂單、客戶、產能、股利、法人評等或政策。",
          "如果今日新聞為 0 則，也必須明說沒有抓到明確當日新聞，再根據最新日線圖表、漲跌幅、成交量與自選股結構做盤勢整理。",
          "若資料只提供新聞標題，不得捏造標題以外的營收數字、訂單金額、客戶名或公司說法。",
          "請用繁體中文，語氣像財經資訊摘要，不要提供買賣建議。",
          "輸出必須是 JSON，欄位為 headline、paragraphs、outlook。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ targetDate, codes, quotes, todayNews: todayNews.slice(0, 60), chartSignals: signals }, null, 2)
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "watchlist_daily_digest",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            headline: { type: "string", description: "一段 80-180 字的當日總結。必須包含今天實際事件；若今日無新聞，要明確說明以圖表與行情判讀。" },
            paragraphs: { type: "array", items: { type: "string" }, description: "3 段補充，每段 50-130 字；至少一段列出具體新聞事件，至少一段說明量價/圖表觀察。" },
            outlook: { type: "string", description: "一段 60-140 字後續觀察。" }
          },
          required: ["headline", "paragraphs", "outlook"]
        }
      }
    }
  };

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`OpenAI API failed: ${res.status}`);
    const json = await res.json();
    const content = json.output_text || json.output?.[0]?.content?.[0]?.text;
    if (!content) throw new Error("OpenAI API returned empty content");
    const parsed = JSON.parse(content);
    return {
      headline: String(parsed.headline || ""),
      paragraphs: Array.isArray(parsed.paragraphs) ? parsed.paragraphs.map(String).slice(0, 4) : [],
      outlook: String(parsed.outlook || ""),
      sourceCount: todayNews.length,
      chartCount: signals.filter((item) => item.latestClose !== null).length,
      targetDate,
      updatedAt: now.toISOString(),
      nextUpdateAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
      provider: "openai"
    };
  } catch (error) {
    console.warn("openAiDigest fallback", error);
    return null;
  }
}

async function buildDigest(codes: string[], quotes: Quote[]): Promise<WatchlistDigest> {
  const targetDate = taiwanDateString();
  const masters = await getAllStockMaster().catch(() => []);
  const newsGroups = await Promise.all(
    codes.map(async (code) => {
      const quote = quotes.find((q) => q.code === code);
      const master = masters.find((s) => s.code === code);
      const company = quote?.name || master?.shortName || master?.name || code;
      try {
        return await getNewsByStock(code, company);
      } catch {
        return [] as NewsItem[];
      }
    })
  );
  const todayNews = newsGroups
    .flat()
    .filter((item) => isSameTaiwanDate(item.publishedAt, targetDate))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const histories = await Promise.all(
    codes.map(async (code) => {
      try {
        return [code, await getTwseHistory(code, "1w")] as const;
      } catch {
        return [code, [] as PricePoint[]] as const;
      }
    })
  );
  const historyMap = new Map(histories);
  const signals = codes.map((code) => {
    const quote = quotes.find((q) => q.code === code);
    const master = masters.find((s) => s.code === code);
    const name = quote?.name || master?.shortName || master?.name || code;
    return buildDailySignal(code, name, quote, historyMap.get(code) || []);
  });

  const ai = await openAiDigest(codes, quotes, todayNews, signals, targetDate);
  return ai || localDigest(codes, quotes, todayNews, signals, targetDate);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const codes = safeCodes(body.watchlist || body.codes);
  const quotes = Array.isArray(body.quotes) ? (body.quotes as Quote[]) : [];
  if (!codes.length) return Response.json({ error: "請提供自選股清單" }, { status: 400 });

  const targetDate = taiwanDateString();
  const key = `${targetDate}:${codes.slice().sort().join(",")}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ data: cached.data, cached: true, ttlHours: 12 }, {
      headers: { "Cache-Control": "s-maxage=43200, stale-while-revalidate=3600" }
    });
  }

  const data = await buildDigest(codes, quotes);
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return Response.json({ data, cached: false, ttlHours: 12 }, {
    headers: { "Cache-Control": "s-maxage=43200, stale-while-revalidate=3600" }
  });
}
