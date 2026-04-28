export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { safeJsonResponse } from "@/lib/format";
import { getTwseHistory } from "@/lib/twse";


const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim();
  const range = searchParams.get("range") || "1m";

  if (!code) return safeJsonResponse({ error: "缺少 code 參數" }, { status: 400 });

  const data = await getTwseHistory(code, range);
  return safeJsonResponse({ code, range, count: data.length, data }, noStore);
}
