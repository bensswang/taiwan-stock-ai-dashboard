export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { proxyGetToPython } from "@/lib/pythonProxy";
import { safeJsonResponse } from "@/lib/format";
import { getNewsByStock } from "@/lib/news";
import { getAllStockMaster } from "@/lib/twse";

export async function GET(request: Request) {
  const pythonResponse = await proxyGetToPython(request, "/api/news");
  if (pythonResponse) return pythonResponse;
  const { searchParams } = new URL(request.url);
  const codeParam = searchParams.get("code")?.trim().toUpperCase();
  const companyParam = searchParams.get("company")?.trim();
  const daysParam = Number(searchParams.get("days") || 5);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 30) : 5;
  const noStoreHeaders = { "Cache-Control": "no-store" };

  if (!codeParam && !companyParam) {
    return safeJsonResponse({ error: "請提供 code 或 company" }, { status: 400, headers: noStoreHeaders });
  }

  const stocks = await getAllStockMaster();
  const stock = codeParam
    ? stocks.find((s) => s.code === codeParam)
    : stocks.find((s) => [s.shortName, s.name, ...(s.aliases || [])].some((name) => Boolean(name && companyParam && name.includes(companyParam))));

  // 有 code 時，以股票主檔為準，避免前端殘留舊公司名稱時抓到上一支股票的新聞。
  const finalCode = codeParam || stock?.code || "TW";
  const company = stock?.shortName || stock?.name || companyParam || finalCode || "台股";
  const rawData = await getNewsByStock(finalCode, company, days);
  const data = rawData.map((item) => ({ ...item, code: finalCode, company }));

  return safeJsonResponse({ code: finalCode, company, days, count: data.length, data }, { headers: noStoreHeaders });
}
