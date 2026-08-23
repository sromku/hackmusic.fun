import { recordPageview } from "../../../db/analytics";
import { assertSameOriginMutation, readBoundedJson, RequestSecurityError } from "../../../lib/request-security";

export const dynamic = "force-dynamic";

function response(status = 204) {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request);
    const input = await readBoundedJson<{ path?: unknown; visitId?: unknown; referrer?: unknown }>(request, 1_024);
    await recordPageview(request, input);
    return response();
  } catch (error) {
    if (error instanceof RequestSecurityError) return response(error.status);
    // Analytics must never interfere with the visitor-facing product.
    return response(204);
  }
}
