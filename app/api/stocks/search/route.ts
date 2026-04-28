export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { safeJsonResponse } from "@/lib/format";
import { searchAllStockMaster } from "@/lib/twse";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Number(searchParams.get("limit") || 50);

  try {
    const results = await searchAllStockMaster(q, limit);
    return safeJsonResponse({ query: q, count: results.length, data: results });
  } catch (err) {
    return safeJsonResponse(
      { error: err instanceof Error ? err.message : "股票主檔搜尋失敗", data: [] },
      { status: 500 }
    );
  }
}
