import { makeFallbackNews } from "./mock";
import type { NewsItem } from "./types";

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

function pickTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
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

function buildExcerpt(title: string, source: string, publishedAt: string) {
  const date = new Date(publishedAt);
  const dateText = Number.isNaN(date.getTime())
    ? "日期未明"
    : date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
  return `${dateText}｜${source}｜事件：${title}`;
}

function isRecent(isoDate: string, days: number) {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) return true;
  return time >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function parseGoogleNewsRss(xml: string, code: string, company: string, days = 5): NewsItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const parsed = items.map((raw, index) => {
    const rawTitle = pickTag(raw, "title");
    const link = pickTag(raw, "link");
    const source = pickTag(raw, "source") || "Google News";
    const pubDate = pickTag(raw, "pubDate");
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    const title = cleanTitle(rawTitle, source);
    return {
      id: `${code}-${index}-${Buffer.from(title).toString("base64").slice(0, 10)}`,
      code,
      company,
      title,
      source,
      publishedAt,
      url: link || `https://news.google.com/search?q=${encodeURIComponent(company)}`,
      excerpt: buildExcerpt(title, source, publishedAt),
      category: inferCategory(title)
    } satisfies NewsItem;
  }).filter((n) => n.title);

  const recent = parsed.filter((item) => isRecent(item.publishedAt, days));
  return (recent.length ? recent : parsed).slice(0, 12);
}

export async function getNewsByStock(code: string, company: string, days = 5): Promise<NewsItem[]> {
  if (process.env.USE_MOCK_DATA === "true") return makeFallbackNews(code, company);
  try {
    const query = `${company} ${code} 股票 OR 法說會 OR 公告 when:${days}d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/rss+xml,text/xml" }
    });
    if (!res.ok) throw new Error(`Google News RSS failed: ${res.status}`);
    const xml = await res.text();
    const parsed = parseGoogleNewsRss(xml, code, company, days);
    return parsed.length ? parsed : makeFallbackNews(code, company);
  } catch (error) {
    console.warn("getNewsByStock fallback", error);
    return makeFallbackNews(code, company);
  }
}
