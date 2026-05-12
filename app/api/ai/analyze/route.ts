import { safeJsonResponse } from "@/lib/format";
import type { AiAnalysis, NewsItem, Quote } from "@/lib/types";

const toneValues: AiAnalysis["tone"][] = ["偏多", "中性偏多", "中性", "中性偏空", "偏空"];

type EventCategory =
  | "營收財報"
  | "法說展望"
  | "訂單客戶"
  | "產能投資"
  | "產品技術"
  | "股利除權息"
  | "法人籌碼"
  | "股價市場"
  | "產業政策"
  | "公司公告"
  | "其他事件";

type ThemeHit = {
  key: string;
  label: string;
  shortLabel: string;
  weight: number;
  pattern: RegExp;
};

const themeRules: ThemeHit[] = [
  { key: "aiCapacity", label: "AI 需求、先進製程與 CoWoS／先進封裝產能", shortLabel: "AI、先進製程與先進封裝", weight: 6, pattern: /AI|人工智慧|先進製程|CoWoS|先進封裝|HPC|高效能運算|GPU|晶片|半導體/i },
  { key: "customerShift", label: "客戶分散供應、轉單與競爭者切入", shortLabel: "客戶分散供應與轉單風險", weight: 5, pattern: /蘋果|Apple|英特爾|Intel|三星|Samsung|轉單|代工|分散|供應鏈|客戶|訂單/i },
  { key: "revenue", label: "營收、獲利與財測展望", shortLabel: "營收財報與公司展望", weight: 5, pattern: /營收|財報|EPS|毛利|獲利|年增|月增|展望|財測|指引|法說/i },
  { key: "investment", label: "資本支出、擴產與產能配置", shortLabel: "產能、擴產與資本支出", weight: 4, pattern: /資本支出|投資|擴產|擴廠|建廠|設廠|產能|設備/i },
  { key: "institution", label: "法人評等、目標價與籌碼變化", shortLabel: "法人評等與籌碼變化", weight: 4, pattern: /外資|投信|自營商|法人|買超|賣超|目標價|評等|調升|調降/i },
  { key: "dividend", label: "股利、配息與除權息安排", shortLabel: "股利配息與除權息", weight: 3, pattern: /股利|配息|除息|除權|殖利率|現金股利/i },
  { key: "policy", label: "政策、關稅與地緣風險", shortLabel: "政策與地緣風險", weight: 3, pattern: /政策|關稅|出口管制|補助|法規|制裁|地緣|美國|中國/i }
];

const bannedVisiblePhrases = [
  "這一段是把新聞歸納成共同脈絡，不逐條搬標題。",
  "不把近幾天舊消息硬當成今天原因。",
  "不把舊新聞包裝成今日利多或利空。",
  "系統不會用強勢／弱勢模板硬寫結論。",
  "摘要不提供買賣建議。",
  "不提供買賣建議。"
];

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(value: string) {
  const date = parseDate(value);
  if (!date) return "日期未明";
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function normalizeTitle(title: string, source?: string) {
  let clean = title.replace(/\s+/g, " ").trim();
  if (source) clean = clean.replace(new RegExp(`\\s[-－—]\\s${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
  return clean;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").replace(/[「」『』]/g, "").trim();
}

function cleanVisibleText(value: string) {
  let next = String(value || "").replace(/\s+/g, " ").trim();
  for (const phrase of bannedVisiblePhrases) next = next.replaceAll(phrase, "");
  return next.replace(/\s+([，。；])/g, "$1").replace(/。{2,}/g, "。").trim();
}

function eventCategory(text: string): EventCategory {
  if (/營收|月增|年增|EPS|獲利|財報|毛利|展望/.test(text)) return "營收財報";
  if (/法說|說明會|展望|財測|指引|guidance/i.test(text)) return "法說展望";
  if (/訂單|接單|客戶|Apple|蘋果|NVIDIA|輝達|AMD|Microsoft|Google|Amazon|英特爾|Intel|三星/i.test(text)) return "訂單客戶";
  if (/擴廠|設廠|建廠|產能|投資|資本支出|CoWoS|先進封裝/i.test(text)) return "產能投資";
  if (/新品|AI|晶片|製程|技術|伺服器|電動車|半導體/i.test(text)) return "產品技術";
  if (/股利|配息|除息|除權|現金股利|殖利率/.test(text)) return "股利除權息";
  if (/外資|投信|自營商|法人|買超|賣超|目標價|評等/.test(text)) return "法人籌碼";
  if (/股價|漲停|跌停|大漲|大跌|創高|創低|震盪|成交量/.test(text)) return "股價市場";
  if (/政策|關稅|出口管制|補助|法規|美國|中國|地緣|制裁/.test(text)) return "產業政策";
  if (/公告|董事會|重大訊息|交易所|公開資訊/.test(text)) return "公司公告";
  return "其他事件";
}

function sortNews(news: NewsItem[]) {
  return [...news]
    .filter((item) => item?.title)
    .sort((a, b) => (parseDate(b.publishedAt)?.getTime() ?? 0) - (parseDate(a.publishedAt)?.getTime() ?? 0));
}

function recentNews(news: NewsItem[], days = 5) {
  const sorted = sortNews(news);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = sorted.filter((item) => (parseDate(item.publishedAt)?.getTime() ?? 0) >= cutoff);
  return filtered.length ? filtered : sorted;
}

function dedupeEvents(news: NewsItem[]) {
  const seen = new Set<string>();
  return news.filter((item) => {
    const key = normalizeTitle(item.title, item.source)
      .replace(/[\s，,。！!？?：:「」『』《》]/g, "")
      .slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildThemeScores(events: NewsItem[]) {
  const joined = events.map((item) => `${item.title} ${item.excerpt || ""} ${item.category || ""}`).join(" ");
  return themeRules
    .map((rule) => {
      const hits = events.filter((item) => rule.pattern.test(`${item.title} ${item.excerpt || ""} ${item.category || ""}`)).length;
      return { ...rule, score: hits * rule.weight + (rule.pattern.test(joined) ? 1 : 0) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function categorySummary(events: NewsItem[]) {
  const counts = new Map<EventCategory, number>();
  for (const item of events) {
    const category = (item.category as EventCategory | undefined) || eventCategory(`${item.title} ${item.excerpt || ""}`);
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
}

function listText(items: string[]) {
  const unique = Array.from(new Set(items.filter(Boolean)));
  if (unique.length <= 1) return unique[0] || "公司與產業消息";
  if (unique.length === 2) return `${unique[0]}與${unique[1]}`;
  return `${unique.slice(0, -1).join("、")}與${unique[unique.length - 1]}`;
}

function groupDates(events: NewsItem[]) {
  const labels = Array.from(new Set(events.map((item) => dateLabel(item.publishedAt)))).filter(Boolean);
  return labels.slice(0, 3).join("、") || "近五天";
}

function priceSentence(stock: Quote | null) {
  if (!stock || stock.changePct === null || stock.changePct === undefined) {
    return "目前缺少完整即時漲跌幅，股價反應暫以新聞事件本身為主。";
  }
  const abs = Math.abs(stock.changePct);
  const volumeText = stock.volume ? `，成交量約 ${stock.volume.toLocaleString("zh-TW")} 張` : "";
  if (stock.changePct > 1.5) return `最新股價上漲 ${stock.changePct.toFixed(2)}%${volumeText}，市場短線反應偏正面，但仍要看題材是否能延伸到營收、訂單或籌碼。`;
  if (stock.changePct < -1.5) return `最新股價下跌 ${abs.toFixed(2)}%${volumeText}，短線壓力可能來自事件風險、籌碼調整或大盤干擾。`;
  return `最新股價變動約 ${stock.changePct.toFixed(2)}%${volumeText}，短線反應不算明顯，重點仍在後續事件是否延續。`;
}

function estimateTone(stock: Quote | null, events: NewsItem[]): AiAnalysis["tone"] {
  const text = events.map((item) => `${item.title} ${item.excerpt || ""}`).join(" ");
  let score = 0;
  score += (text.match(/成長|增加|新高|優於|擴產|接單|上修|買超|調升|需求強|旺季|資本支出/g) || []).length;
  score -= (text.match(/下滑|衰退|調降|虧損|賣超|砍單|延後|風險|不確定|跌破|低於|分食|轉單/g) || []).length;
  if (typeof stock?.changePct === "number") {
    if (stock.changePct > 2) score += 1;
    if (stock.changePct < -2) score -= 1;
  }
  if (score >= 3) return "偏多";
  if (score >= 1) return "中性偏多";
  if (score <= -3) return "偏空";
  if (score <= -1) return "中性偏空";
  return "中性";
}

function themeNames(events: NewsItem[], limit = 3) {
  const themes = buildThemeScores(events).slice(0, limit).map((item) => item.shortLabel);
  if (themes.length) return themes;
  return categorySummary(events).map(([name]) => name).slice(0, limit);
}

function buildMainParagraph(company: string, events: NewsItem[]) {
  if (!events.length) return `${company}近五天尚未取得足夠新聞，暫時無法整理出明確事件主軸。`;
  const themes = themeNames(events, 3);
  const dates = groupDates(events);
  return `${company}近五天主軸是${listText(themes)}，資料時間主要落在 ${dates}。這代表市場近期關注的不是單一漲跌，而是這些事件是否會影響營收、產能、訂單或法人籌碼。`;
}

function buildTodayParagraph(todayNews: NewsItem[], events: NewsItem[], stock: Quote | null) {
  const priceText = priceSentence(stock);
  if (todayNews.length) {
    const themes = themeNames(todayNews, 2);
    return `今日新增消息集中在${listText(themes)}，若多則新聞來自同一事件或媒體轉載，重點應放在事件本身是否有基本面支撐。${priceText}`;
  }
  const lastDate = events[0] ? dateLabel(events[0].publishedAt) : "近五天";
  return `今日暫未抓到明確的新公司消息，判讀時可把 ${lastDate} 前後的既有事件與最新量價一起看。${priceText}`;
}

function buildOutlookParagraph(events: NewsItem[]) {
  const themes = themeNames(events, 3).join("、");
  if (!events.length) return "後續可先觀察是否出現公司公告、法說資料或法人籌碼變化，再確認股價波動是否有基本面原因。";
  if (/AI|先進製程|先進封裝|CoWoS|客戶|轉單|供應/i.test(themes)) {
    return "後續觀察重點是產能與先進封裝進度、主要客戶訂單是否有實質變化，以及 AI 需求能否持續轉化為營收動能。";
  }
  if (/營收|展望|法說|財報/i.test(themes)) {
    return "後續觀察重點是營收年增率是否延續、公司展望是否上修，以及法人籌碼是否跟著財報訊號改變。";
  }
  if (/法人|籌碼|評等/i.test(themes)) {
    return "後續觀察重點是法人評等是否持續調整、買賣超是否延續，以及量能是否能支撐短線股價反應。";
  }
  return "後續觀察重點是相關事件是否有公司公告、法說補充、法人籌碼變化，或量能是否延續放大。";
}

function keyPointSentences(stock: Quote | null, events: NewsItem[], todayNews: NewsItem[]) {
  const company = stock ? `${stock.name}（${stock.code}）` : events[0]?.company || "該公司";
  if (!events.length) {
    return [
      `${company}近五天新聞量不足，暫時以最新量價與公司公告補充判讀。`,
      priceSentence(stock),
      "後續先看是否有公司公告、法說資料或法人籌碼變化，再確認市場反應是否延續。"
    ];
  }
  const themes = themeNames(events, 3);
  const todayTheme = todayNews.length ? listText(themeNames(todayNews, 2)) : "尚無明確當日新事件";
  return [
    `近五天焦點集中在${listText(themes)}，主要看這些事件是否會影響營收、產能或籌碼。`,
    `今日事件焦點為${todayTheme}，若股價同步放量，代表市場正在重新評估相關題材。`,
    buildOutlookParagraph(events)
  ].map(cleanVisibleText);
}

function localAnalyze(stock: Quote | null, news: NewsItem[]): AiAnalysis {
  const baseNews = dedupeEvents(recentNews(news, 5));
  const today = new Date();
  const todayNews = baseNews.filter((item) => {
    const date = parseDate(item.publishedAt);
    return date ? isSameLocalDay(date, today) : false;
  });
  const events = baseNews.slice(0, 10);
  const tone = estimateTone(stock, events);
  const company = stock ? `${stock.name}（${stock.code}）` : news[0]?.company || "該公司";

  const summary = events.length
    ? [buildMainParagraph(company, events), buildTodayParagraph(todayNews, events, stock), buildOutlookParagraph(events)].map(cleanVisibleText).join("\n\n")
    : `${company}近五天尚未取得足夠新聞，暫時無法整理出明確事件主軸。後續可先觀察公司公告、法說資料與法人籌碼變化，再確認股價波動是否有基本面原因。`;

  return {
    tone,
    summary,
    keyPoints: keyPointSentences(stock, events, todayNews),
    risks: [],
    sourceCount: events.length,
    updatedAt: new Date().toISOString(),
    provider: "local-rules"
  };
}

function sanitizeAnalysis(value: Partial<AiAnalysis>, sourceCount: number, provider: AiAnalysis["provider"]): AiAnalysis {
  const tone = toneValues.includes(value.tone as AiAnalysis["tone"]) ? (value.tone as AiAnalysis["tone"]) : "中性";
  return {
    tone,
    summary: cleanVisibleText(String(value.summary || "")),
    keyPoints: Array.isArray(value.keyPoints) ? value.keyPoints.map((item) => cleanVisibleText(String(item))).filter(Boolean).slice(0, 4) : [],
    risks: Array.isArray(value.risks) ? value.risks.map((item) => cleanVisibleText(String(item))).filter(Boolean).slice(0, 2) : [],
    sourceCount,
    updatedAt: new Date().toISOString(),
    provider
  };
}

async function openAiAnalyze(stock: Quote | null, news: NewsItem[]): Promise<AiAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const preparedNews = dedupeEvents(recentNews(news, 5)).slice(0, 12).map((item) => ({
    title: normalizeTitle(item.title, item.source),
    source: item.source,
    publishedAt: item.publishedAt,
    excerpt: compactText(item.excerpt || ""),
    category: item.category || eventCategory(`${item.title} ${item.excerpt || ""}`),
    url: item.url
  }));
  const payload = {
    model,
    input: [
      {
        role: "system",
        content: [
          "你是台股新聞事件整理助理。請用繁體中文，根據使用者提供的 stock 與 news JSON 產生網站用摘要。",
          "摘要要像人工整理事件脈絡：先說近五天主軸，再說今日新事件與股價量能反應，最後說後續觀察。",
          "news 已先篩選為中高以上可信來源，包含官方資訊、中央社、Reuters、Bloomberg、WSJ、FT、經濟日報、工商時報、MoneyDJ、鉅亨網與 Yahoo 股市；不要加入低可信來源或社群傳言。",
          "每句都要有具體事件、影響或觀察點；不可逐條複製新聞標題，不可把標題改寫成清單。",
          "summary 請寫成 2 到 3 段，合計 180 到 300 字，用換行分段；內容風格參考：『近期主軸是……。這不代表……，但代表市場關注……。營收面／量價面……。後續觀察……。』",
          "keyPoints 請給 3 點，每點 35 到 80 字，分別對應：近五天主軸、今日事件與量價反應、後續觀察。",
          "如果今日新聞為 0 則，請用『今日暫未抓到明確的新公司消息』表述，再用近五天脈絡與量價輔助，不要捏造原因。",
          "若資料只含標題，必須保守表述；不得捏造標題以外的財務數字、客戶、訂單金額或公司說法。",
          "不要輸出提示詞、內部規則、免責提醒或『不要抄標題』這類說明。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ stock, news: preparedNews }, null, 2)
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "analysis",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            tone: { type: "string", enum: toneValues },
            summary: { type: "string" },
            keyPoints: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } }
          },
          required: ["tone", "summary", "keyPoints", "risks"]
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
    return sanitizeAnalysis(parsed, preparedNews.length, "openai");
  } catch (error) {
    console.warn("openAiAnalyze fallback", error);
    return null;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const stock = (body.stock || null) as Quote | null;
  const news = Array.isArray(body.news) ? (body.news as NewsItem[]) : [];
  const ai = await openAiAnalyze(stock, news);
  return safeJsonResponse({ data: ai || localAnalyze(stock, news) });
}
