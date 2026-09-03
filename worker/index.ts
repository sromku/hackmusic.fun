/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { isDevelopmentHost } from "../lib/dev-only";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function securedResponse(response: Response, pathname: string, developmentHost = false) {
  const headers = new Headers(response.headers);
  // Framing is only allowed, and only same-origin, on development hosts so /lab can embed the host and guest pages.
  headers.set("content-security-policy", `frame-ancestors ${developmentHost ? "'self'" : "'none'"}; base-uri 'self'; object-src 'none'`);
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", developmentHost ? "SAMEORIGIN" : "DENY");
  if (pathname.startsWith("/api/") || pathname.startsWith("/e/") || pathname === "/host" || pathname.startsWith("/lab/") || pathname.startsWith("/backstage-")) {
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
  if (pathname.startsWith("/api/")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const developmentHost = isDevelopmentHost(url.hostname);

    if (url.pathname === "/lab" || url.pathname.startsWith("/lab/")) {
      if (!developmentHost) return securedResponse(new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }), url.pathname, false);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return securedResponse(response, url.pathname, developmentHost);
    }

    return securedResponse(await handler.fetch(request, env, ctx), url.pathname, developmentHost);
  },
};

export default worker;
