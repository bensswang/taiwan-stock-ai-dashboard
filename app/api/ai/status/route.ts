export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { proxyGetToPython } from "@/lib/pythonProxy";
function getRuntimeEnv(name: string) {
  return process.env[name] || (globalThis as any).Netlify?.env?.get?.(name) || "";
}

export async function GET(request: Request) {
  const pythonResponse = await proxyGetToPython(request, "/api/ai/status");
  if (pythonResponse) return pythonResponse;
  const configured = Boolean(getRuntimeEnv("GROQ_API_KEY"));
  const model = getRuntimeEnv("GROQ_MODEL") || "llama-3.3-70b-versatile";

  return Response.json({
    configured,
    mode: configured ? "groq" : "missing-key",
    model: configured ? model : null,
    checkedAt: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}
