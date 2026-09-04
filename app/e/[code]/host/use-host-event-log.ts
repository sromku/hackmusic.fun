"use client";

import { useCallback, useRef } from "react";

export type HostEventEntry = { at: string; event: string; detail: string };
const HOST_EVENT_LOG_LIMIT = 30;

/** Ring buffer of playback decisions on this host device, shown in the readiness sheet for diagnosis. */
export function useHostEventLog() {
  const entriesRef = useRef<HostEventEntry[]>([]);
  const log = useCallback((event: string, detail: string) => {
    entriesRef.current = [{ at: new Date().toISOString(), event, detail }, ...entriesRef.current].slice(0, HOST_EVENT_LOG_LIMIT);
  }, []);
  const read = useCallback(() => entriesRef.current, []);
  return { log, read };
}
