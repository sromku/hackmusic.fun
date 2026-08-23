export type HostDevice = "ios" | "android" | "computer" | "unknown";

export function detectHostDevice(userAgent: string, platform = "", maxTouchPoints = 0): HostDevice {
  const identity = `${userAgent} ${platform}`.toLowerCase();

  if (identity.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(identity) || (platform === "MacIntel" && maxTouchPoints > 1)) return "ios";
  return identity.trim() ? "computer" : "unknown";
}
