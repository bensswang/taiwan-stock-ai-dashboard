export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getRuntimeEnv(name: string) {
  return process.env[name] || (globalThis as any).Netlify?.env?.get?.(name) || "";
}

export async function GET() {
  const configured = Boolean(getRuntimeEnv("OPENAI_API_KEY"));
  const model = getRuntimeEnv("OPENAI_MODEL") || "gpt-4.1-mini";

  return Response.json({
    configured,
    mode: configured ? "openai" : "missing-key",
    model: configured ? model : null,
    checkedAt: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}
