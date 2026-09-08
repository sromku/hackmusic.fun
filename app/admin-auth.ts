import { env } from "cloudflare:workers";
import { adminAllowlistAccess } from "../lib/admin-allowlist";
import { adminPathMatches } from "../lib/admin-path";

type AdminEnv = { ADMIN_ALLOWED_EMAILS?: string; ADMIN_SECRET_PATH?: string };

export function adminAccessForEmail(email: string) {
  const configuredEmails = (env as unknown as AdminEnv).ADMIN_ALLOWED_EMAILS ?? "";
  return adminAllowlistAccess(email, configuredEmails);
}

/** True only when `slug` equals the secret path segment configured in ADMIN_SECRET_PATH. Unconfigured means the dashboard does not exist. */
export function isAdminPath(slug: string) {
  return adminPathMatches(slug, (env as unknown as AdminEnv).ADMIN_SECRET_PATH ?? "");
}
