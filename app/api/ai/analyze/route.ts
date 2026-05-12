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

function eventCategory(text: string): EventCategory {
  if (/營收|月增|年增|EPS|獲利|財報|毛利|展望/.test(text)) return "營收財報";
  if (/法說|說明會|展望|財測|指引|guidance/i.test(text)) return "法說展望";
  if (/訂單|接單|客戶|Apple|蘋果|NVIDIA|輝達|AMD|Microsoft|Google|Amazon/i.test(text)) return "訂單客戶";
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
    const key = normalizeTitle(item.title, item.source).replace(/[\s，,。！!？?：:「」『』]/g, "").slice(0, 36);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventLine(item: NewsItem) {
  const title = normalizeTitle(item.title, item.source);
  const category = item.category || eventCategory(`${title} ${item.excerpt || ""}`);
  return `${dateLabel(item.publishedAt)}｜${category}｜${title}（${item.source}）`;
}

function estimateTone(stock: Quote | null, events: NewsItem[]): AiAnalysis["tone"] {
  const text = events.map((item) => `${item.title} ${item.excerpt || ""}`).join(" ");
  let score = 0;
  score += (text.match(/成長|增|新高|優於|擴產|接單|上修|買超|調升|需求強|旺季/g) || []).length;
  score -= (text.match(/下滑|衰退|調降|虧損|賣超|砍單|延後|風險|不確定|跌破|低於/g) || []).length;
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

function localAnalyze(stock: Quote | null, news: NewsItem[]): AiAnalysis {
  const baseNews = dedupeEvents(recentNews(news, 5));
  const today = new Date();
  const todayNews = baseNews.filter((item) => {
    const date = parseDate(item.publishedAt);
    return date ? isSameLocalDay(date, today) : false;
  });
  const events = baseNews.slice(0, 6);
  const tone = estimateTone(stock, events);
  const company = stock ? `${stock.name}（${stock.code}）` : news[0]?.company || "該公司";
  const eventSummary = events.slice(0, 3).map((item) => normalizeTitle(item.title, item.source));
  const todayPhrase = todayNews.length
    ? `今天可見 ${todayNews.length} 則消息，重點是：${todayNews.slice(0, 2).map((item) => normalizeTitle(item.title, item.source)).join("；")}。`
    : "今天目前沒有抓到明確的新消息，以下以近五天新聞做整理。";
  const pricePhrase = stock?.changePct == null
    ? "目前缺少最新漲跌幅資料，因此不把股價方向當成主要判斷依據。"
    : `最新漲跌幅約 ${stock.changePct.toFixed(2)}%，這只作為市場反應參考，不取代新聞事件本身。`;

  return {
    tone,
    summary: events.length
      ? `${company}近五天主要不是單純強弱勢判斷，而是這幾件事：${eventSummary.join("；")}。${todayPhrase}${pricePhrase}`
      : `${company}目前沒有足夠新聞資料可整理具體事件；建議先查看公開資訊觀測站、公司公告或新聞原文。`,
    keyPoints: events.length
      ? events.map(eventLine)
      : ["目前沒有抓到可辨識的新聞標題，因此不硬套強勢／弱勢模板。"],
    risks: [
      "目前新聞資料多半來自標題、來源與時間，若標題資訊不足，應開啟原文確認細節。",
      "若多則新聞其實來自同一事件，應避免把重複轉載誤判成多個獨立利多或利空。",
      "股價變動可能反映大盤、產業或籌碼因素，不一定完全由單一新聞造成。"
    ],
    sourceCount: events.length,
    updatedAt: new Date().toISOString(),
    provider: "local-rules"
  };
}

async function openAiAnalyze(stock: Quote | null, news: NewsItem[]): Promise<AiAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const preparedNews = dedupeEvents(recentNews(news, 5)).slice(0, 10).map((item) => ({
    title: normalizeTitle(item.title, item.source),
    source: item.source,
    publishedAt: item.publishedAt,
    excerpt: item.excerpt || "",
    category: item.category || eventCategory(`${item.title} ${item.excerpt || ""}`),
    url: item.url
  }));
  const payload = {
    model,
    input: [
      {
        role: "system",
        content: [
          "你是台股新聞事件整理助理。請用繁體中文，根據使用者提供的 stock 與 news JSON 產生摘要。",
          "重點：不要套用『強勢／弱勢／買盤』模板；優先說明新聞中實際發生的事件，例如營收、法說、訂單、客戶、產能、股利、法人評等、政策或公司公告。",
          "summary 要先回答『近五天發生了什麼事』與『今天是否有新消息』，不能只說情緒偏多或偏空。",
          "keyPoints 每點都要包含日期或來源，並用具體事件開頭。",
          "若資料只含標題，必須明說判斷受限；不得捏造標題以外的財務數字、客戶、訂單或公司說法。",
          "不提供買賣建議。"
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
    return {
      ...parsed,
      sourceCount: preparedNews.length,
      updatedAt: new Date().toISOString(),
      provider: "openai"
    } as AiAnalysis;
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
