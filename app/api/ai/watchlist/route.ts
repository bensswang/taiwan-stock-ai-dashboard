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
  const text = textOf(todayNews);
  const aiScore = countWords(text, ["AI", "人工智慧", "伺服器", "HPC", "CoWoS", "晶片", "先進製程"]);
  const etfScore = countWords(text, ["ETF", "除息", "配息", "高股息", "資金流", "受益人"]);
  const chipScore = countWords(text, ["半導體", "台積電", "聯發科", "IC", "晶圓", "封測"]);
  const fundScore = countWords(text, ["外資", "法人", "買超", "賣超", "成交量", "籌碼"]);
  const chart = chartSentence(signals);

  const byCode = new Map<string, number>();
  for (const item of todayNews) byCode.set(item.code, (byCode.get(item.code) || 0) + 1);
  const topNews = Array.from(byCode.entries()).sort((a, b) => b[1] - a[1])[0];
  const themes = [
    aiScore > 0 || chipScore > 0 ? "AI / 半導體" : null,
    etfScore > 0 ? "ETF / 資金流" : null,
    fundScore > 0 ? "法人籌碼" : null
  ].filter((item): item is string => Boolean(item)).join("、") || "盤中量價變化與大盤連動";

  const headline = todayNews.length
    ? `今日自選股消息主要集中在 ${themes}；${chart.breadth}${chart.strongest ? ` 短線強勢焦點落在 ${chart.strongest.code} ${chart.strongest.name}。` : ""}`
    : `今日尚未取得明確自選股新聞，改以當日圖表與最新報價判讀；${chart.breadth}${chart.strongest ? ` 目前相對強勢為 ${chart.strongest.code} ${chart.strongest.name}。` : ""}`;

  const newsParagraph = todayNews.length
    ? `本次只納入今日消息，共整理 ${codes.length} 檔自選股、${todayNews.length} 則新聞。${topNews ? `${topNews[0]} 今日新聞數相對較多，可優先確認是否有公司事件、產業題材或法人觀點變化。` : "今日新聞量分散，暫時沒有單一股票明顯集中。"}`
    : `本次只納入今日消息，但目前沒有抓到自選股的當日新聞，因此摘要改以當日走勢、漲跌幅與成交量變化為主。這樣可以避免用舊新聞誤判今天的盤勢。`;

  return {
    headline,
    paragraphs: [
      newsParagraph,
      `${chart.leader} ${chart.volume}`,
      `自選股組合中同時包含大盤型 ETF、槓桿 ETF、高股息 ETF 與科技權值股，因此今日判讀重點不是單看新聞數，而是要看權值股、ETF 與加權指數是否同步。若只有單一股票上漲但多數自選股偏弱，代表資金可能較分散。`
    ],
    outlook: "後續可優先觀察台積電與聯發科是否延續強弱方向、0050 與 00631L 是否跟加權指數同步、0056 與 00878 是否有資金流或除息題材，以及成交量是否配合放大。",
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
          "如果今日新聞為 0 則，也必須根據最新日線圖表、漲跌幅、成交量與自選股結構做當日盤勢分析。",
          "請用繁體中文，語氣像財經資訊摘要，不要提供買賣建議，不要捏造未提供的事實。",
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
            headline: { type: "string", description: "一段 80-180 字的當日總結。若今日無新聞，要明確說明以圖表與行情判讀。" },
            paragraphs: { type: "array", items: { type: "string" }, description: "3 段補充，每段 50-130 字，必須包含新聞與量價/圖表觀察。" },
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
