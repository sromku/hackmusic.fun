export type HostDevice = "ios" | "android" | "computer" | "unknown";

export function detectHostDevice(userAgent: string, platform = "", maxTouchPoints = 0): HostDevice {
  const identity = `${userAgent} ${platform}`.toLowerCase();

  if (identity.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(identity) || (platform === "MacIntel" && maxTouchPoints > 1)) return "ios";
  return identity.trim() ? "computer" : "unknown";
}

export type HostBrowser = "ipad-chrome" | "ios-safari" | "ios-other" | "android-chrome" | "android-other" | "desktop";

export function detectHostBrowser(userAgent: string, platform = "", maxTouchPoints = 0): HostBrowser {
  const device = detectHostDevice(userAgent, platform, maxTouchPoints);
  const identity = userAgent.toLowerCase();
  if (device === "ios") {
    const isPad = identity.includes("ipad") || (platform === "MacIntel" && maxTouchPoints > 1);
    if (identity.includes("crios")) return isPad ? "ipad-chrome" : "ios-other";
    if (identity.includes("fxios") || identity.includes("edgios")) return "ios-other";
    return "ios-safari";
  }
  if (device === "android") return identity.includes("chrome") && !identity.includes("samsungbrowser") ? "android-chrome" : "android-other";
  return "desktop";
}
