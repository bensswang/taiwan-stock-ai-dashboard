export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { safeJsonResponse } from "@/lib/format";
import { getTaifexTxSeries } from "@/lib/taifex";


const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = searchParams.get("session") || "combined";
  const range = searchParams.get("range") || "5d";

  try {
    const data = await getTaifexTxSeries(session, range);
    return safeJsonResponse({ session, range, count: data.length, data }, noStore);
  } catch (error) {
    return safeJsonResponse(
      { error: error instanceof Error ? error.message : "台指期資料載入失敗", session, range, count: 0, data: [] },
      { status: 502 }
    );
  }
}
