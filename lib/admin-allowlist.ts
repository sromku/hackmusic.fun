export function adminAllowlistAccess(email: string, configuredEmails: string) {
  const allowedEmails = new Set(configuredEmails.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  return {
    configured: allowedEmails.size > 0,
    allowed: allowedEmails.has(email.trim().toLowerCase()),
  };
}
