export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { safeJsonResponse } from "@/lib/format";
import { getNewsByStock, NEWS_LOOKBACK_DAYS, NEWS_MAX_ITEMS } from "@/lib/news";
import { getTwseListedStocks } from "@/lib/twse";


const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim();
  const companyParam = searchParams.get("company")?.trim();
  if (!code && !companyParam) return safeJsonResponse({ error: "請提供 code 或 company" }, { status: 400 });

  const stocks = await getTwseListedStocks();
  const stock = code ? stocks.find((s) => s.code === code) : undefined;
  const company = companyParam || stock?.shortName || stock?.name || code || "台股";
  const data = await getNewsByStock(code || stock?.code || "TW", company);

  return safeJsonResponse({ code: code || stock?.code || null, company, lookbackDays: NEWS_LOOKBACK_DAYS, maxItems: NEWS_MAX_ITEMS, count: data.length, data }, noStore);
}
