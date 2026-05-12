import { makeFallbackNews } from "./mock";
import type { NewsItem } from "./types";

type TrustedTier = "最高" | "高" | "中高";

type SourceTrust = {
  tier: TrustedTier;
  label: string;
};

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function decodeXml(value: string): string {
  return stripCdata(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value: string): string {
  return decodeXml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function pickSourceInfo(item: string): { name: string; url: string } {
  const match = item.match(/<source(?:\s+[^>]*)?>([\s\S]*?)<\/source>/i);
  const sourceTag = match?.[0] || "";
  const urlMatch = sourceTag.match(/url=["']([^"']+)["']/i);
  return {
    name: match ? decodeXml(match[1]) : "Google News",
    url: urlMatch ? decodeXml(urlMatch[1]) : ""
  };
}

function cleanTitle(title: string, source: string) {
  const sourcePattern = source ? source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  return title
    .replace(/\s+/g, " ")
    .replace(sourcePattern ? new RegExp(`\\s[-－—]\\s${sourcePattern}$`) : /$^/, "")
    .trim();
}

function inferCategory(text: string): string {
  if (/營收|月增|年增|EPS|獲利|財報|毛利|展望/.test(text)) return "營收財報";
  if (/法說|說明會|財測|指引|guidance/i.test(text)) return "法說展望";
  if (/訂單|接單|客戶|Apple|蘋果|NVIDIA|輝達|AMD|Microsoft|Google|Amazon/i.test(text)) return "訂單客戶";
  if (/擴廠|設廠|建廠|產能|投資|資本支出|CoWoS|先進封裝/i.test(text)) return "產能投資";
  if (/新品|AI|晶片|製程|技術|伺服器|電動車|半導體/i.test(text)) return "產品技術";
  if (/股利|配息|除息|除權|現金股利|殖利率/.test(text)) return "股利除權息";
  if (/外資|投信|自營商|法人|買超|賣超|目標價|評等/.test(text)) return "法人籌碼";
  if (/股價|漲停|跌停|大漲|大跌|創高|創低|震盪|成交量/.test(text)) return "股價市場";
  if (/政策|關稅|出口管制|補助|法規|美國|中國|地緣|制裁/.test(text)) return "產業政策";
  if (/公告|董事會|重大訊息|交易所|公開資訊/.test(text)) return "公司公告";
  return "新聞事件";
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildExcerpt(source: string, publishedAt: string, tier: TrustedTier, category: string, description?: string) {
  const date = new Date(publishedAt);
  const dateText = Number.isNaN(date.getTime())
    ? "日期未明"
    : date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
  const cleanedDescription = description ? compact(stripHtml(description)).slice(0, 120) : "";
  const base = `${dateText}｜${source}｜${tier}可信來源｜${category}`;
  return cleanedDescription && !cleanedDescription.includes(source)
    ? `${base}。${cleanedDescription}`
    : base;
}

function isRecent(isoDate: string, days: number) {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) return true;
  return time >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function sourceText(source: string, sourceUrl: string, link: string) {
  return `${source || ""} ${sourceUrl || ""} ${link || ""}`.toLowerCase();
}

function inferTrustedSource(source: string, sourceUrl: string, link: string): SourceTrust | null {
  const text = sourceText(source, sourceUrl, link);

  // 最高：官方資訊與公司公告相關來源。
  if (
    /公開資訊觀測站|mops|mops\.twse\.com\.tw|market observation post system/.test(text) ||
    /證交所|臺灣證券交易所|台灣證券交易所|twse|twse\.com\.tw|investoredu\.twse\.com\.tw/.test(text) ||
    /櫃買中心|tpex|tpex\.org\.tw|gre tai/.test(text) ||
    /重大訊息|公司公告|董事會|法說會|財報/.test(source)
  ) {
    return { tier: "最高", label: "官方資訊" };
  }

  // 高：具國際或全國新聞採編標準的財經新聞來源。
  if (/中央社|cna|cna\.com\.tw/.test(text)) return { tier: "高", label: "中央社" };
  if (/reuters|路透|reuters\.com/.test(text)) return { tier: "高", label: "Reuters" };
  if (/bloomberg|彭博|bloomberg\.com/.test(text)) return { tier: "高", label: "Bloomberg" };
  if (/wall street journal|wsj|華爾街日報|wsj\.com/.test(text)) return { tier: "高", label: "WSJ" };
  if (/financial times|金融時報|ft\.com/.test(text)) return { tier: "高", label: "Financial Times" };

  // 中高：台灣主要財經媒體與股市資訊站。
  if (/經濟日報|money\.udn\.com/.test(text)) return { tier: "中高", label: "經濟日報" };
  if (/工商時報|commercial times|ctee\.com\.tw/.test(text)) return { tier: "中高", label: "工商時報" };
  if (/moneydj|moneydj\.com/.test(text)) return { tier: "中高", label: "MoneyDJ" };
  if (/鉅亨|anue|cnyes|cnyes\.com/.test(text)) return { tier: "中高", label: "鉅亨網" };
  if (/yahoo.*股市|奇摩股市|tw\.stock\.yahoo\.com|finance\.yahoo/.test(text)) return { tier: "中高", label: "Yahoo 股市" };

  return null;
}

function dedupeByEvent(items: NewsItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.title}`
      .replace(/[\s，,。！!？?：:「」『』《》()（）]/g, "")
      .slice(0, 46);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeNewsId(code: string, index: number, source: string, title: string) {
  const slug = `${source}-${title}`.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "").slice(0, 24);
  return `${code}-${index}-${slug || "news"}`;
}

function parseGoogleNewsRss(xml: string, code: string, company: string, days = 5): NewsItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const parsed: Array<NewsItem | null> = items.map((raw, index) => {
    const rawTitle = pickTag(raw, "title");
    const link = pickTag(raw, "link");
    const { name: source, url: sourceUrl } = pickSourceInfo(raw);
    const trust = inferTrustedSource(source, sourceUrl, link);
    if (!trust) return null;

    const pubDate = pickTag(raw, "pubDate");
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    const title = cleanTitle(rawTitle, source);
    const category = inferCategory(`${title} ${source}`);
    const description = pickTag(raw, "description");

    if (!title || !isRecent(publishedAt, days)) return null;

    return {
      id: makeNewsId(code, index, source, title),
      code,
      company,
      title,
      source,
      publishedAt,
      url: link || sourceUrl || `https://news.google.com/search?q=${encodeURIComponent(company)}`,
      excerpt: buildExcerpt(source, publishedAt, trust.tier, category, description),
      category,
      sourceTier: trust.tier,
      sourceLabel: trust.label,
      sourceUrl
    } satisfies NewsItem;
  }).filter((item): item is NewsItem => Boolean(item));

  return dedupeByEvent(parsed).slice(0, 12);
}

export async function getNewsByStock(code: string, company: string, days = 5): Promise<NewsItem[]> {
  if (process.env.USE_MOCK_DATA === "true") return makeFallbackNews(code, company);
  try {
    const trustedSourceQuery = [
      "中央社",
      "Reuters",
      "Bloomberg",
      "經濟日報",
      "工商時報",
      "MoneyDJ",
      "鉅亨",
      "Yahoo股市",
      "公開資訊觀測站",
      "證交所",
      "櫃買中心"
    ].join(" OR ");
    const query = `${company} ${code} 股票 (${trustedSourceQuery}) when:${days}d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/rss+xml,text/xml" }
    });
    if (!res.ok) throw new Error(`Google News RSS failed: ${res.status}`);
    const xml = await res.text();
    return parseGoogleNewsRss(xml, code, company, days);
  } catch (error) {
    console.warn("getNewsByStock failed", error);
    return [];
  }
}
