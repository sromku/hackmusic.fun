/**
 * Development-only features (the /lab page, `?persona=` test guests, same-origin framing) are enabled solely
 * for hostnames that can never be production: loopback, RFC 1918 private ranges, link-local, and `.local` names.
 */
export function isDevelopmentHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}
