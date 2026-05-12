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
  industry?: string;
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

const categoryText: Record<string, string> = {
  營收財報: "營收、獲利或財測展望",
  法說展望: "法說會與公司展望",
  訂單客戶: "客戶、訂單或供應鏈分配",
  產能投資: "產能、擴產或資本支出",
  產品技術: "產品、技術或 AI 供應鏈",
  股利除權息: "股利、配息與除權息",
  法人籌碼: "法人評等與籌碼變化",
  股價市場: "股價、量能與市場反應",
  產業政策: "政策、關稅或地緣風險",
  公司公告: "公司公告或重大訊息",
  新聞事件: "公司與產業消息"
};

const industryMap: Record<string, string> = {
  "24": "半導體",
  "25": "電腦週邊",
  "28": "電子零組件",
  "17": "金融保險",
  "15": "航運",
  ETF: "ETF"
};

const bannedVisiblePhrases = [
  "這一段是把新聞歸納成共同脈絡，不逐條搬標題。",
  "不逐條搬標題",
  "不硬套利多或利空模板",
  "不把舊消息包裝成今天事件",
  "不把舊新聞包裝成今日利多或利空",
  "摘要只整理事件與盤勢，不提供買賣建議。",
  "不提供買賣建議。"
];

function cleanVisibleText(value: string) {
  let next = String(value || "").replace(/\s+/g, " ").trim();
  for (const phrase of bannedVisiblePhrases) next = next.replaceAll(phrase, "");
  return next.replace(/\s+([，。；])/g, "$1").replace(/。{2,}/g, "。").trim();
}

function listText(items: string[]) {
  const unique = Array.from(new Set(items.filter(Boolean)));
  if (unique.length <= 1) return unique[0] || "公司與產業消息";
  if (unique.length === 2) return `${unique[0]}與${unique[1]}`;
  return `${unique.slice(0, -1).join("、")}與${unique[unique.length - 1]}`;
}

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

function pctText(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function cleanNewsTitle(item: NewsItem) {
  const source = item.source?.trim();
  const sourcePattern = source ? source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  return item.title
    .replace(/\s+/g, " ")
    .replace(sourcePattern ? new RegExp(`\\s[-－—]\\s${sourcePattern}$`) : /$^/, "")
    .trim();
}

function dedupeNews(news: NewsItem[]) {
  const seen = new Set<string>();
  return news.filter((item) => {
    const key = cleanNewsTitle(item).replace(/[\s，,。！!？?：:「」『』《》]/g, "").slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readableIndustry(value?: string | null) {
  if (!value) return "未分類";
  const trimmed = value.trim();
  return industryMap[trimmed] || industryMap[trimmed.padStart(2, "0")] || trimmed;
}

function categoryLabel(value?: string) {
  if (!value) return "公司與產業消息";
  return categoryText[value] || value;
}

function inferEventThemes(news: NewsItem[]) {
  const text = news.map((item) => `${item.code} ${item.company} ${item.title} ${item.excerpt || ""} ${item.category || ""}`).join(" ");
  const themes: string[] = [];
  if (/AI|人工智慧|輝達|NVIDIA|GPU|伺服器|CoWoS|先進封裝|先進製程|半導體/i.test(text)) themes.push("AI、先進製程與先進封裝供應鏈");
  if (/蘋果|Apple|英特爾|Intel|三星|Samsung|轉單|代工|客戶|供應鏈|訂單/i.test(text)) themes.push("客戶分散供應與轉單風險");
  if (/營收|財報|EPS|獲利|毛利|年增|月增|展望|財測|法說/i.test(text)) themes.push("營收財報與公司展望");
  if (/外資|投信|自營商|法人|買超|賣超|目標價|評等|調升|調降/i.test(text)) themes.push("法人籌碼與評價調整");
  if (/股利|配息|除息|除權|殖利率/i.test(text)) themes.push("股利配息與除權息題材");
  if (/政策|關稅|出口管制|補助|制裁|地緣|美國|中國/i.test(text)) themes.push("政策與地緣風險");
  if (/航運|運價|貨櫃|散裝/i.test(text)) themes.push("航運報價與景氣循環");
  if (/金融|金控|銀行|壽險|匯損|升息|降息|利率/i.test(text)) themes.push("金融股利差、匯率與資產品質");
  return themes.slice(0, 3);
}

function topCategories(news: NewsItem[]) {
  const counts = new Map<string, number>();
  for (const item of news) {
    const label = categoryLabel(item.category || "新聞事件");
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
}

function topNewsStocks(news: NewsItem[]) {
  const byCode = new Map<string, NewsItem[]>();
  for (const item of news) {
    const list = byCode.get(item.code) || [];
    list.push(item);
    byCode.set(item.code, list);
  }
  return Array.from(byCode.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .map(([code, items]) => ({
      code,
      company: items[0]?.company || code,
      count: items.length,
      categories: topCategories(items).map(([name]) => name)
    }));
}

function buildDailySignal(code: string, name: string, industry: string | undefined, quote: Quote | undefined, history: PricePoint[]): DailyChartSignal {
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
    industry,
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

function chartContext(signals: DailyChartSignal[]) {
  const valid = signals.filter((item) => item.direction !== "unknown");
  const up = valid.filter((item) => item.direction === "up");
  const down = valid.filter((item) => item.direction === "down");
  const flat = valid.filter((item) => item.direction === "flat");
  const strongest = [...valid].sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))[0] || null;
  const weakest = [...valid].sort((a, b) => (a.changePct ?? 999) - (b.changePct ?? 999))[0] || null;
  const active = valid.filter((item) => (item.volumeRatio ?? 0) >= 1.2).sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0))[0] || null;
  const byIndustry = new Map<string, { count: number; avgPct: number; items: DailyChartSignal[] }>();
  for (const item of valid) {
    const key = readableIndustry(item.industry);
    const record = byIndustry.get(key) || { count: 0, avgPct: 0, items: [] };
    record.count += 1;
    record.avgPct += item.changePct || 0;
    record.items.push(item);
    byIndustry.set(key, record);
  }
  const industries = Array.from(byIndustry.entries())
    .map(([name, record]) => ({ ...record, name, avgPct: record.count ? record.avgPct / record.count : 0 }))
    .sort((a, b) => Math.abs(b.avgPct) - Math.abs(a.avgPct));
  return { valid, up, down, flat, strongest, weakest, active, industries };
}

function breadthText(chart: ReturnType<typeof chartContext>) {
  if (!chart.valid.length) return "目前自選股缺少足夠報價與日線資料，整體強弱暫時只能保守判讀。";
  const bias = chart.up.length > chart.down.length ? "偏強" : chart.down.length > chart.up.length ? "偏弱" : "震盪";
  return `今日自選股整體${bias}，可判讀的 ${chart.valid.length} 檔中有 ${chart.up.length} 檔上漲、${chart.down.length} 檔下跌、${chart.flat.length} 檔持平。`;
}

function industryText(chart: ReturnType<typeof chartContext>) {
  const top = chart.industries.slice(0, 2).filter((item) => item.name !== "未分類");
  if (!top.length) return "產業分布暫時沒有明顯共同方向。";
  return `變動較集中的類股是${top.map((item) => `${item.name}平均 ${pctText(item.avgPct)}`).join("、")}，代表今天不是每檔股票平均變動，而是有特定族群影響自選股表現。`;
}

function leaderText(chart: ReturnType<typeof chartContext>) {
  const parts: string[] = [];
  if (chart.strongest) parts.push(`相對支撐是 ${chart.strongest.code} ${chart.strongest.name}（${pctText(chart.strongest.changePct)}）`);
  if (chart.weakest) parts.push(`主要拖累是 ${chart.weakest.code} ${chart.weakest.name}（${pctText(chart.weakest.changePct)}）`);
  if (chart.active) parts.push(`${chart.active.code} ${chart.active.name} 量能約為近期均量的 ${chart.active.volumeRatio?.toFixed(1)} 倍`);
  return parts.length ? `${parts.join("；")}。` : "目前尚無法穩定排序相對支撐、拖累與量能放大個股。";
}

function eventInsight(todayNews: NewsItem[]) {
  const news = dedupeNews(todayNews);
  if (!news.length) {
    return {
      themeText: "今日未抓到明確的自選股公司新聞，重點先放在最新報價、成交量與自選股結構。",
      focusText: "沒有明確事件時，應優先觀察跌幅較大、成交量放大、或明顯弱於大盤的個股，等待後續新聞或公告補齊原因。",
      headlineTheme: "量價與族群結構",
      categories: [] as [string, number][],
      stocks: [] as ReturnType<typeof topNewsStocks>,
      count: 0
    };
  }
  const themes = inferEventThemes(news);
  const categories = topCategories(news);
  const stocks = topNewsStocks(news);
  const categoryPhrase = categories.length
    ? categories.map(([name, count]) => `${name}${count > 1 ? ` ${count} 則` : ""}`).join("、")
    : "公司與產業消息";
  const stockPhrase = stocks.length
    ? stocks.map((item) => `${item.code} ${item.company}`).join("、")
    : "多檔自選股";
  const headlineTheme = themes.length ? listText(themes.slice(0, 2)) : categoryPhrase;
  return {
    themeText: `今日自選股消息焦點集中在${headlineTheme}，涉及 ${stockPhrase}。`,
    focusText: `這些消息要和股價與成交量一起看；若多家媒體都在報導同一題材，代表市場焦點集中，但不等於多個獨立原因同時發生。`,
    headlineTheme,
    categories,
    stocks,
    count: news.length
  };
}

function headlineText(chart: ReturnType<typeof chartContext>, events: ReturnType<typeof eventInsight>) {
  if (!chart.valid.length) return "今日自選股資料仍在補齊，先等待行情與圖表更新後再判讀整體方向。";
  const bias = chart.up.length > chart.down.length ? "偏強" : chart.down.length > chart.up.length ? "偏弱" : "震盪";
  const leader = chart.industries.filter((item) => item.name !== "未分類")[0]?.name;
  const leadText = leader ? `，主要受${leader}類股影響` : "";
  return `今日自選股整體${bias}${leadText}；消息焦點集中在${events.headlineTheme}。`;
}

function localDigest(codes: string[], quotes: Quote[], todayNews: NewsItem[], signals: DailyChartSignal[], targetDate: string): WatchlistDigest {
  const now = new Date();
  const chart = chartContext(signals);
  const events = eventInsight(todayNews);
  const headline = cleanVisibleText(headlineText(chart, events));

  const paragraphs = [
    `整體表現：${breadthText(chart)} ${industryText(chart)}`,
    `主要事件：${events.themeText} ${events.focusText}`,
    `資金動向：${leaderText(chart)} 若跌幅較大的個股同時成交量放大，代表市場可能正在重新評估相關題材；相對穩定的 ETF、金融或低波動標的，則可能提供自選股組合支撐。`,
    `今日關注：優先留意跌幅大、量能放大、且與新聞事件有關的個股；若今日新聞不足，則先看它是否只是跟隨大盤震盪，避免把單日價格波動過度解讀。`
  ].map(cleanVisibleText);

  return {
    headline,
    paragraphs,
    outlook: cleanVisibleText("後續觀察外資與投信買賣超、主要支撐與拖累個股是否延續，以及今日新聞是否有公司公告、法說或公開資訊補充。"),
    sourceCount: events.count,
    chartCount: signals.filter((item) => item.latestClose !== null).length,
    targetDate,
    updatedAt: now.toISOString(),
    nextUpdateAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    provider: "local-rules"
  };
}

function sanitizeDigest(value: Partial<WatchlistDigest>, sourceCount: number, chartCount: number, targetDate: string, provider: WatchlistDigest["provider"]): WatchlistDigest {
  const now = new Date();
  return {
    headline: cleanVisibleText(String(value.headline || "今日自選股資料已更新，請查看下方整體表現、主要事件與資金動向。")),
    paragraphs: Array.isArray(value.paragraphs)
      ? value.paragraphs.map((item) => cleanVisibleText(String(item))).filter(Boolean).slice(0, 4)
      : [],
    outlook: cleanVisibleText(String(value.outlook || "後續觀察主要支撐與拖累個股、成交量是否延續，以及是否有公司公告或法說資料補充。")),
    sourceCount,
    chartCount,
    targetDate,
    updatedAt: now.toISOString(),
    nextUpdateAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    provider
  };
}

async function openAiDigest(codes: string[], quotes: Quote[], todayNews: NewsItem[], signals: DailyChartSignal[], targetDate: string): Promise<WatchlistDigest | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const now = new Date();
  const preparedNews = dedupeNews(todayNews).slice(0, 60).map((item) => ({
    code: item.code,
    company: item.company,
    title: cleanNewsTitle(item),
    source: item.source,
    publishedAt: item.publishedAt,
    category: item.category || "新聞事件",
    excerpt: item.excerpt || ""
  }));

  const payload = {
    model,
    input: [
      {
        role: "system",
        content: [
          "你是台股資訊整理助理。請整理網站首頁的「自選股當日重點」。",
          "使用者要的是整個自選股組合今天發生什麼事：整體方向、主要族群、共同事件、支撐/拖累個股、量能變化與後續觀察。",
          "todayNews 已先篩選為中高以上可信來源，包含官方資訊、中央社、Reuters、Bloomberg、WSJ、FT、經濟日報、工商時報、MoneyDJ、鉅亨網與 Yahoo 股市；不要加入低可信來源或社群傳言。",
          "headline 只放一句主結論，60 到 110 字，不要把四段內容濃縮重複一次。",
          "paragraphs 固定 4 段，且依序以『整體表現：』『主要事件：』『資金動向：』『今日關注：』開頭。每段要有事件、原因或觀察，不要只寫偏強/偏弱。",
          "只能以今日新聞與最新日線/報價資料判讀。若今日新聞為 0 則，明說今日未抓到明確公司新聞，再用量價、漲跌幅、成交量與自選股結構整理。",
          "不可逐條複製新聞標題，不可把 prompt、內部規則或摘要方法說明寫進摘要。",
          "若資料只含標題，請保守表述；不得捏造標題以外的營收數字、訂單金額、客戶說法或投資建議。",
          "outlook 60 到 120 字，聚焦後續觀察事項。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ targetDate, codes, quotes, todayNews: preparedNews, chartSignals: signals }, null, 2)
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
            headline: { type: "string" },
            paragraphs: { type: "array", items: { type: "string" } },
            outlook: { type: "string" }
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
    return sanitizeDigest(parsed, preparedNews.length, signals.filter((item) => item.latestClose !== null).length, targetDate, "openai");
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
  const todayNews = dedupeNews(
    newsGroups
      .flat()
      .filter((item) => isSameTaiwanDate(item.publishedAt, targetDate))
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  );

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
    const industry = quote?.industry || master?.industry;
    return buildDailySignal(code, name, industry, quote, historyMap.get(code) || []);
  });

  const ai = await openAiDigest(codes, quotes, todayNews, signals, targetDate);
  return ai || localDigest(codes, quotes, todayNews, signals, targetDate);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const codes = safeCodes(body.watchlist || body.codes);
  const quotes = Array.isArray(body.quotes) ? (body.quotes as Quote[]) : [];
  const force = Boolean(body.force);
  if (!codes.length) return Response.json({ error: "請提供自選股清單" }, { status: 400 });

  const targetDate = taiwanDateString();
  const key = `${targetDate}:${codes.slice().sort().join(",")}`;
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) {
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
