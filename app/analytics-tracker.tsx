"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const VISIT_KEY = "hackmusic_analytics_visit";
let inMemoryVisitId = "";

function privacySignalEnabled() {
  const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return navigator.doNotTrack === "1" || privacyNavigator.globalPrivacyControl === true;
}

function visitId() {
  if (inMemoryVisitId) return inMemoryVisitId;
  try {
    const stored = sessionStorage.getItem(VISIT_KEY);
    if (stored) return (inMemoryVisitId = stored);
    const created = crypto.randomUUID();
    sessionStorage.setItem(VISIT_KEY, created);
    return (inMemoryVisitId = created);
  } catch {
    return (inMemoryVisitId = crypto.randomUUID());
  }
}

function excludedPath(pathname: string) {
  return pathname.startsWith("/backstage-") || pathname.startsWith("/api/");
}

export default function AnalyticsTracker() {
  const pathname = usePathname();
  const lastTrackedPath = useRef("");
  const firstPageview = useRef(true);

  useEffect(() => {
    if (!pathname || excludedPath(pathname) || privacySignalEnabled()) return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    if (lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;

    const referrer = firstPageview.current ? document.referrer : location.origin;
    firstPageview.current = false;
    void fetch("/api/analytics", {
      method: "POST",
      credentials: "omit",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname, visitId: visitId(), referrer }),
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
