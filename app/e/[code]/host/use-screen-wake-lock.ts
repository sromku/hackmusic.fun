"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ScreenWakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (event: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<ScreenWakeLockSentinel> };
};

export function useScreenWakeLock(deviceName: string, onMessage: (message: string) => void) {
  const [supported, setSupported] = useState<boolean | null>(() => typeof navigator === "undefined" ? null : Boolean((navigator as NavigatorWithWakeLock).wakeLock));
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<ScreenWakeLockSentinel | null>(null);
  const wantedRef = useRef(false);

  const request = useCallback(async (announce = true) => {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) {
      setSupported(false);
      if (announce) onMessage(`⚠️ This browser cannot keep the ${deviceName} awake automatically. Open the screen-awake help below.`);
      return false;
    }
    setSupported(true);
    wantedRef.current = true;
    if (sentinelRef.current && !sentinelRef.current.released) {
      setActive(true);
      return true;
    }
    try {
      const sentinel = await wakeLock.request("screen");
      sentinelRef.current = sentinel;
      setActive(true);
      sentinel.addEventListener("release", () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
          setActive(false);
        }
      });
      if (announce) onMessage(`🔒 Screen lock blocked on this ${deviceName}. Keep the host tab visible.`);
      return true;
    } catch {
      wantedRef.current = false;
      setActive(false);
      if (announce) onMessage("⚠️ The device rejected the wake lock. Check battery or power-saving settings and the fallback guide below.");
      return false;
    }
  }, [deviceName, onMessage]);

  const release = useCallback(async (announce = true) => {
    wantedRef.current = false;
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined);
    if (announce) onMessage(`💤 Screen wake lock released. This ${deviceName} may sleep again.`);
  }, [deviceName, onMessage]);

  useEffect(() => {
    const restoreWhenVisible = () => {
      if (document.visibilityState === "visible" && wantedRef.current && !sentinelRef.current) void request(false);
    };
    document.addEventListener("visibilitychange", restoreWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", restoreWhenVisible);
      wantedRef.current = false;
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [request]);

  return { supported, active, request, release };
}
