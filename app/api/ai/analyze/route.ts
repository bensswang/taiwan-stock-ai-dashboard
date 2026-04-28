export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { safeJsonResponse } from "@/lib/format";
import type { AiAnalysis, NewsItem, Quote } from "@/lib/types";

const THEME_RULES = [
  {
    key: "獲利能力",
    words: ["毛利", "營收", "獲利", "EPS", "財報", "季報", "年增", "成長", "法說", "財測"],
    point: "獲利能力仍是近期市場關注焦點。若新聞反覆提到營收、毛利率、財報或法說展望，代表投資人正在檢視公司是否能把需求轉化為實際獲利。",
    risk: "若後續財報或法說內容低於市場預期，股價容易出現評價修正或短線震盪。",
    watch: "後續可觀察營收年增率、毛利率變化、法說會對下季展望的說法。"
  },
  {
    key: "AI 與先進製程",
    words: ["AI", "人工智慧", "伺服器", "先進製程", "高效能運算", "HPC", "晶片", "CoWoS", "ASIC"],
    point: "AI 與高階運算題材仍是支撐市場關注度的重要因素。若新聞集中在 AI 晶片、先進製程或高效能運算需求，通常代表市場仍把公司放在 AI 供應鏈主軸中評價。",
    risk: "AI 題材若已經反映在股價中，短線需要留意利多鈍化與獲利了結壓力。",
    watch: "後續可觀察 AI 相關訂單能見度、產能擴充進度，以及市場是否仍願意給較高評價。"
  },
  {
    key: "產業景氣",
    words: ["景氣", "需求", "庫存", "手機", "PC", "消費性電子", "復甦", "產業", "供應鏈"],
    point: "產業景氣是判斷消息能否延續的重要背景。若新聞同時提到需求復甦、庫存調整或供應鏈狀況，代表市場不只看單一公司，也在觀察整體產業循環。",
    risk: "若 AI 需求強但其他終端需求未同步回升，股價可能受到基本面分歧影響。",
    watch: "後續可觀察同產業公司營收、庫存水位、終端需求是否同步改善。"
  },
  {
    key: "股價與籌碼",
    words: ["股價", "新高", "天價", "買超", "賣超", "外資", "法人", "成交量", "漲", "跌", "震盪"],
    point: "股價與籌碼訊號顯示市場已開始反映部分消息。若新聞大量提到股價創高、法人買賣或成交量，代表短線情緒與資金流向需要一起判斷。",
    risk: "若股價短期漲幅已大，遇到消息不如預期時，容易出現回檔或震盪。",
    watch: "後續可觀察成交量是否放大、外資買賣超是否延續，以及股價是否守住關鍵位置。"
  },
  {
    key: "政策與地緣風險",
    words: ["政策", "關稅", "出口管制", "美國", "中國", "地緣", "匯率", "台幣", "法規", "限制"],
    point: "政策、匯率與地緣因素可能影響市場風險評價。若新聞涉及科技管制、匯率或國際政策，投資人通常會重新評估未來不確定性。",
    risk: "外部政策或地緣事件通常不易預測，可能造成短線評價波動。",
    watch: "後續可觀察政策新聞、匯率變化，以及國際科技供應鏈是否出現新的限制。"
  }
];

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function inferThemes(text: string) {
  const matched = THEME_RULES.filter((rule) => includesAny(text, rule.words));
  return matched.length ? matched.slice(0, 3) : THEME_RULES.slice(0, 2);
}

function inferTone(stock: Quote | null, newsText: string): AiAnalysis["tone"] {
  const positiveWords = ["成長", "升溫", "強勁", "擴產", "新高", "訂單", "展望", "買盤", "優於", "上修", "復甦"];
  const negativeWords = ["下滑", "衰退", "賣壓", "風險", "調降", "虧損", "震盪", "保守", "不確定", "低於"];
  const positive = positiveWords.filter((w) => newsText.includes(w)).length;
  const negative = negativeWords.filter((w) => newsText.includes(w)).length;
  const priceTone = stock?.changePct == null ? 0 : stock.changePct > 1 ? 1 : stock.changePct < -1 ? -1 : 0;
  const score = positive - negative + priceTone;
  if (score >= 3) return "偏多";
  if (score >= 1) return "中性偏多";
  if (score <= -3) return "偏空";
  if (score <= -1) return "中性偏空";
  return "中性";
}

function localAnalyze(stock: Quote | null, news: NewsItem[]): AiAnalysis {
  const newsText = news.map((n) => `${n.title} ${n.excerpt || ""} ${n.category || ""}`).join(" ");
  const tone = inferTone(stock, newsText);
  const company = stock ? `${stock.name}（${stock.code}）` : "該公司";
  const themes = inferThemes(newsText);
  const pricePart = stock?.changePct == null
    ? "目前缺少可用的最新股價變化，因此判讀會以新聞與公告主題為主。"
    : `最新可得股價變化約為 ${stock.changePct.toFixed(2)}%，可用來輔助判斷市場是否已經反映部分消息。`;

  const summary = news.length
    ? `${company}近期取得 ${news.length} 則相關消息。整體來看，消息主軸集中在${themes.map((t) => t.key).join("、")}，目前綜合判讀為「${tone}」。重點不是逐條羅列新聞標題，而是觀察這些消息是否共同指向基本面改善、題材延續或風險升高。${pricePart}`
    : `${company}目前沒有取得足夠的近期新聞，因此暫時無法做完整新聞面判讀。建議先查看公開資訊觀測站、公司公告與新聞原文，再進行分析。`;

  const keyPoints = news.length
    ? themes.map((theme) => theme.point)
    : [
        "目前新聞資料不足，尚無法歸納明確主題。",
        "可先補充公司公告、法說會資料與近期新聞連結，再重新分析。"
      ];

  if (stock?.changePct != null) {
    keyPoints.push(
      stock.changePct > 0
        ? "價格面目前偏正向，但仍需要搭配成交量與同產業表現，確認是否只是短線情緒反應。"
        : stock.changePct < 0
        ? "價格面目前偏弱，需確認是單一公司事件、產業因素，或整體市場風險造成。"
        : "價格變化有限，代表市場可能仍在等待更明確的新資訊。"
    );
  }

  const risks = news.length
    ? Array.from(new Set([
        ...themes.map((theme) => theme.risk),
        "新聞標題可能只反映部分內容，重要事件仍需開啟原文確認細節。",
        "AI 摘要是資訊整理，不應直接視為買賣建議。"
      ])).slice(0, 5)
    : [
        "新聞資料不足時，AI 摘要可能低估重要事件。",
        "重要判斷仍需查看公告、財報與新聞原文。"
      ];

  const watches = Array.from(new Set(themes.map((theme) => theme.watch))).slice(0, 4);
  if (watches.length) {
    risks.push(`後續觀察：${watches.join("；")}`);
  }

  return {
    tone,
    summary,
    keyPoints,
    risks,
    sourceCount: news.length,
    updatedAt: new Date().toISOString(),
    provider: "local-rules"
  };
}

async function openAiAnalyze(stock: Quote | null, news: NewsItem[]): Promise<AiAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const payload = {
    model,
    input: [
      {
        role: "system",
        content: [
          "你是台股資訊整理助理。請用繁體中文，根據輸入的股價、公告與新聞資料做分析。",
          "不要捏造未提供的事實，不提供買賣建議。",
          "不要逐字羅列新聞標題，不要把來源名稱串成一段，不要只輸出搜尋結果。",
          "請整理成：核心結論、近期重點、可能影響、風險提醒。",
          "語氣要像財經資訊摘要，清楚、可讀、不要誇大。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ stock, news }, null, 2)
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
            tone: { type: "string", enum: ["偏多", "中性偏多", "中性", "中性偏空", "偏空"] },
            summary: { type: "string", description: "一段 120 至 220 字的核心結論，說明消息主軸、整體判讀與需要注意的地方。" },
            keyPoints: { type: "array", items: { type: "string" }, description: "3 到 5 點近期重點，每點都要把新聞整理成主題與含意，不要只貼標題。" },
            risks: { type: "array", items: { type: "string" }, description: "3 到 5 點風險提醒或後續觀察。" }
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
      sourceCount: news.length,
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
