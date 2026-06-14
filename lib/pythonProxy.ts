function getRuntimeEnv(name: string) {
  return process.env[name] || (globalThis as any).Netlify?.env?.get?.(name) || "";
}

function pythonBaseUrl() {
  const raw = getRuntimeEnv("PYTHON_API_URL") || getRuntimeEnv("NEXT_PUBLIC_PYTHON_API_URL");
  return raw ? raw.replace(/\/$/, "") : "";
}

function copyHeaders(source: Headers) {
  const headers = new Headers(source);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Backend", "python-fastapi");
  return headers;
}

export async function proxyGetToPython(request: Request, path: string): Promise<Response | null> {
  const base = pythonBaseUrl();
  if (!base) return null;
  const current = new URL(request.url);
  const target = new URL(path, `${base}/`);
  target.search = current.search;

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: copyHeaders(response.headers)
    });
  } catch (error) {
    console.warn("Python backend proxy failed; falling back to Next.js route", error);
    return null;
  }
}

export async function proxyPostToPython(request: Request, path: string): Promise<Response | null> {
  const base = pythonBaseUrl();
  if (!base) return null;
  const target = new URL(path, `${base}/`);
  const body = await request.clone().text();

  try {
    const response = await fetch(target.toString(), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": request.headers.get("Content-Type") || "application/json"
      },
      body
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: copyHeaders(response.headers)
    });
  } catch (error) {
    console.warn("Python backend proxy failed; falling back to Next.js route", error);
    return null;
  }
}
