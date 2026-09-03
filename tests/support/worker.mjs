let requestSequence = 0;

export async function requestWorker(pathname = "/", init = {}, bindings = {}) {
  globalThis.__HACKMUSIC_TEST_BINDINGS__ = bindings;
  const workerUrl = new URL("../../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${requestSequence++}`);
  const { default: worker } = await import(workerUrl.href);
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.method && init.method !== "GET" && !headers.has("origin")) headers.set("origin", "http://localhost");

  return worker.fetch(
    new Request(pathname.startsWith("http") ? pathname : `http://localhost${pathname}`, { ...init, headers }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...bindings },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

export function renderPage(pathname = "/", requestHeaders = {}, bindings = {}) {
  return requestWorker(pathname, { headers: { accept: "text/html", host: "localhost", ...requestHeaders } }, bindings);
}
