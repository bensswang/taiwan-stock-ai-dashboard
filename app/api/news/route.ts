import { safeJsonResponse } from "@/lib/format";
import { getNewsByStock } from "@/lib/news";
import { getTwseListedStocks } from "@/lib/twse";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim();
  const companyParam = searchParams.get("company")?.trim();
  const daysParam = Number(searchParams.get("days") || 5);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 30) : 5;

  if (!code && !companyParam) return safeJsonResponse({ error: "請提供 code 或 company" }, { status: 400 });

  const stocks = await getTwseListedStocks();
  const stock = code ? stocks.find((s) => s.code === code) : undefined;
  const company = companyParam || stock?.shortName || stock?.name || code || "台股";
  const data = await getNewsByStock(code || stock?.code || "TW", company, days);

  return safeJsonResponse({ code: code || stock?.code || null, company, days, count: data.length, data });
}
