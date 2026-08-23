import { env } from "cloudflare:workers";
import { adminAllowlistAccess } from "../lib/admin-allowlist";

export function adminAccessForEmail(email: string) {
  const configuredEmails = (env as unknown as { ADMIN_ALLOWED_EMAILS?: string }).ADMIN_ALLOWED_EMAILS ?? "";
  return adminAllowlistAccess(email, configuredEmails);
}
