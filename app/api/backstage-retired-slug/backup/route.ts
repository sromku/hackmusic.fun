import { readPortableBackup } from "../../../../db/backup";
import { publicErrorDetails } from "../../../../lib/public-error";
import { assertSameOriginMutation, consumeRequestLimit, RequestSecurityError } from "../../../../lib/request-security";
import { adminAccessForEmail } from "../../../admin-auth";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store, private",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
      ...extraHeaders,
    },
  });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in with ChatGPT to export a backup." }, 401);
  const access = adminAccessForEmail(user.email);
  if (!access.configured) return json({ error: "The admin owner allowlist is not configured." }, 503);
  if (!access.allowed) return json({ error: "This ChatGPT account is not allowed to export HackMusic data." }, 403);

  try {
    assertSameOriginMutation(request);
    await consumeRequestLimit(request, {
      bucket: "admin-backup-hour",
      subject: user.userId,
      windowMs: 60 * 60 * 1_000,
      maximum: 3,
    });
    return json({ backup: await readPortableBackup() });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return json(
        { error: error.message },
        error.status,
        error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined,
      );
    }
    const detail = publicErrorDetails(error, "We could not prepare the backup. Nothing was downloaded; please try again.");
    return json({ error: detail.message }, detail.status);
  }
}
