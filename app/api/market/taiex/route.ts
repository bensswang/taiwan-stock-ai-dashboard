export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { safeJsonResponse } from "@/lib/format";
import { getTaiexSeries } from "@/lib/taiex";

const noStore = { headers: { "Cache-Control": "no-store" } };

function normalizeRange(range: string | null) {
  if (range === "1m" || range === "1y") return range;
  return "1w";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range"));

  try {
    const data = await getTaiexSeries(range);
    return safeJsonResponse({ range, count: data.length, latest: data[data.length - 1] || null, data }, noStore);
  } catch (error) {
    return safeJsonResponse(
      { error: error instanceof Error ? error.message : "台灣加權指數資料載入失敗", range, count: 0, latest: null, data: [] },
      { status: 502 }
    );
  }
}
