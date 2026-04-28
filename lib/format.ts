export function parseNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw || raw === "--" || raw === "---") return null;
  const normalized = raw.replace(/,/g, "").replace(/\+/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function rocDateToIso(input: string): string {
  const parts = input.split("/");
  if (parts.length !== 3) return input;
  const year = Number(parts[0]) + 1911;
  const month = parts[1].padStart(2, "0");
  const day = parts[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthStartsBack(months: number): Date[] {
  const now = new Date();
  const dates: Date[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dates.push(d);
  }
  return dates;
}

function mergeHeaders(init?: ResponseInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  }
  return headers;
}

export function safeJsonResponse<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: mergeHeaders(init)
  });
}
