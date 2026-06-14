export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { proxyGetToPython } from "@/lib/pythonProxy";
import { safeJsonResponse } from "@/lib/format";
import { getTwseDailyQuotes, getTwseQuote } from "@/lib/twse";
import { getBatchQuotesWithFallback, getQuotesWithRealtimeOverlay, getRealtimeQuote } from "@/lib/realtime";

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: Request) {
  const pythonResponse = await proxyGetToPython(request, "/api/stocks/quote");
  if (pythonResponse) return pythonResponse;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim();
  const codes = searchParams.get("codes")?.trim();
  const realtime = searchParams.get("realtime") !== "0";

  if (codes) {
    const list = codes.split(",").map((item) => item.trim()).filter((item): item is string => Boolean(item));
    const data = realtime
      ? await getBatchQuotesWithFallback(list)
      : (await getTwseDailyQuotes()).filter((item) => list.includes(item.code));
    return safeJsonResponse({ realtime, count: data.length, data }, noStore);
  }

  if (code) {
    const quote = realtime ? (await getRealtimeQuote(code).catch(() => null)) : null;
    const fallback = quote || await getTwseQuote(code);
    if (!fallback) return safeJsonResponse({ error: `找不到股票代號 ${code}` }, { status: 404 });
    return safeJsonResponse({ realtime: Boolean(quote), data: fallback }, noStore);
  }

  const quotes = realtime ? await getQuotesWithRealtimeOverlay() : await getTwseDailyQuotes();
  return safeJsonResponse({ realtime, count: quotes.length, data: quotes }, noStore);
}
