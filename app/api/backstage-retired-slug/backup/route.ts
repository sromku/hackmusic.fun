import { readPortableBackup } from "../../../../db/backup";
import { publicErrorDetails } from "../../../../lib/public-error";
import { adminAccessForEmail } from "../../../admin-auth";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store, private",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in with ChatGPT to export a backup." }, 401);
  const access = adminAccessForEmail(user.email);
  if (!access.configured) return json({ error: "The admin owner allowlist is not configured." }, 503);
  if (!access.allowed) return json({ error: "This ChatGPT account is not allowed to export HackMusic data." }, 403);

  try {
    return json({ backup: await readPortableBackup() });
  } catch (error) {
    const detail = publicErrorDetails(error, "We could not prepare the backup. Nothing was downloaded; please try again.");
    return json({ error: detail.message }, detail.status);
  }
}
