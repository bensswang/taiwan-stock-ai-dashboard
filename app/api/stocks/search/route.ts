export const runtime = "nodejs";
export const revalidate = 43200;

import { proxyGetToPython } from "@/lib/pythonProxy";
import { safeJsonResponse } from "@/lib/format";
import { searchAllStockMaster } from "@/lib/twse";

function cacheHeaders() {
  return {
    "Cache-Control": "public, max-age=300, s-maxage=43200, stale-while-revalidate=86400"
  };
}

export async function GET(request: Request) {
  const pythonResponse = await proxyGetToPython(request, "/api/stocks/search");
  if (pythonResponse) return pythonResponse;
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Number(searchParams.get("limit") || 50);

  try {
    const results = await searchAllStockMaster(q, limit);
    return safeJsonResponse({ query: q, count: results.length, data: results }, { headers: cacheHeaders() });
  } catch (err) {
    return safeJsonResponse(
      { error: err instanceof Error ? err.message : "股票主檔搜尋失敗", data: [] },
      { status: 500, headers: cacheHeaders() }
    );
  }
}
