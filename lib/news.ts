import type { NewsItem } from "./types";

export const NEWS_LOOKBACK_DAYS = 5;
export const NEWS_MAX_ITEMS = 12;

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
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWithinRecentDays(date: Date, days: number): boolean {
  const now = Date.now();
  const time = date.getTime();
  const lowerBound = now - days * 24 * 60 * 60 * 1000;
  return time >= lowerBound && time <= now + 60 * 60 * 1000;
}

function parseGoogleNewsRss(xml: string, code: string, company: string): NewsItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  const newsItems: NewsItem[] = [];

  items.forEach((raw, index) => {
    const title = pickTag(raw, "title");
    const link = pickTag(raw, "link");
    const source = pickTag(raw, "source") || "Google News";
    const pubDate = pickTag(raw, "pubDate");
    const parsedDate = parseDate(pubDate);

    if (!title || !parsedDate || !isWithinRecentDays(parsedDate, NEWS_LOOKBACK_DAYS)) return;

    newsItems.push({
      id: `${code}-${index}-${Buffer.from(title).toString("base64").slice(0, 10)}`,
      code,
      company,
      title,
      source,
      publishedAt: parsedDate.toISOString(),
      url: link || `https://news.google.com/search?q=${encodeURIComponent(company)}`,
      excerpt: `僅顯示近 ${NEWS_LOOKBACK_DAYS} 日內新聞；保留原文連結，頁面只整理標題、來源與公開摘要，不直接重製新聞全文。`,
      category: "近五天新聞"
    });
  });

  return newsItems
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, NEWS_MAX_ITEMS);
}

export async function getNewsByStock(code: string, company: string): Promise<NewsItem[]> {
  const query = `${company} ${code} 股票 OR 法說會 OR 公告`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const res = await fetch(url, {
    next: { revalidate: 3600 },
    headers: { Accept: "application/rss+xml,text/xml,*/*", "User-Agent": "taiwan-stock-ai-dashboard-v10/1.0" }
  });
  if (!res.ok) throw new Error(`Google News RSS failed: ${res.status}`);
  const xml = await res.text();
  return parseGoogleNewsRss(xml, code, company);
}
