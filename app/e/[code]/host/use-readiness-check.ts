"use client";

import { useCallback, useState } from "react";
import { detectHostBrowser, type HostBrowser } from "../../../../lib/host-device";
import type { MusicSource } from "../../../../lib/party-contract";

export type ReadinessStatus = "pass" | "warn" | "fail" | "info";
export type ReadinessResult = { id: string; label: string; status: ReadinessStatus; detail: string };

export type ReadinessInputs = {
  musicSource: MusicSource;
  spotifyStatus: "checking" | "disconnected" | "loading" | "ready" | "error";
  youtubeStatus: "idle" | "loading" | "ready" | "error";
  enableReactionAudio: () => Promise<void>;
  inspectReactionAudio: () => { contextState: string | null; buffersLoaded: boolean; unlockedElements: number; poolSize: number };
  requestScreenWakeLock: (announce?: boolean) => Promise<boolean>;
  wakeLockSupported: boolean | null;
  probeRoomData: () => Promise<boolean>;
};

/** 0.2 seconds of silence as an 8 kHz mono 8-bit WAV: used to probe whether playback may start later without a tap. */
const SILENT_WAV = `data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAGAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA`;
const LATER_PLAYBACK_DELAY_MS = 1_400;
const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function browserAdvice(browser: HostBrowser) {
  if (browser === "ipad-chrome") return "Chrome on iPad runs on Apple's WebKit engine: the first video needs one tap on the player, and volume ducking under reaction sounds is not available. Keep Chrome in the foreground for the whole event.";
  if (browser === "ios-safari" || browser === "ios-other") return "iPhone/iPad browsers need one tap on the first video, do not allow volume ducking, and pause playback when the tab leaves the foreground.";
  if (browser === "android-chrome") return "Android Chrome supports automatic playback after the first tap, volume ducking, and screen wake lock.";
  if (browser === "android-other") return "Non-Chrome Android browsers vary. If anything misbehaves, open the host page in Chrome.";
  return "Desktop browsers support automatic playback after the first click, volume ducking, and screen wake lock.";
}

export function useReadinessCheck() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ReadinessResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string>("");

  const run = useCallback(async (current: ReadinessInputs) => {
    if (running) return;
    setRunning(true);
    const collected: ReadinessResult[] = [];
    const browser = detectHostBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

    // Everything that needs the tap must start synchronously, before the first await.
    const probe = new Audio(SILENT_WAV);
    probe.preload = "auto";
    const probeUnlock = probe.play().then(() => true).catch(() => false);
    const armingSounds = current.enableReactionAudio().then(() => true).catch((reason: unknown) => (reason instanceof Error ? reason.message : "Sounds could not be armed."));
    const wakeLockRequest = current.requestScreenWakeLock(false).catch(() => false);

    collected.push({
      id: "browser",
      label: browser === "ipad-chrome" ? "iPad · Chrome detected" : browser === "ios-safari" ? "iPhone/iPad · Safari detected" : browser === "ios-other" ? "iPhone/iPad browser detected" : browser.startsWith("android") ? "Android browser detected" : "Desktop browser detected",
      status: "info",
      detail: browserAdvice(browser),
    });

    const armed = await armingSounds;
    const audio = current.inspectReactionAudio();
    if (armed !== true) {
      collected.push({ id: "sounds", label: "Reaction sounds", status: "fail", detail: `${armed} Tap the check again with the volume up.` });
    } else if (audio.contextState === "running") {
      collected.push({ id: "sounds", label: "Reaction sounds armed", status: "pass", detail: `Sound mixer is running${audio.unlockedElements ? ` and ${audio.unlockedElements}/${audio.poolSize} backup players are unlocked` : ""}. You should have just heard the cheer and boo.` });
    } else if (audio.unlockedElements > 0) {
      collected.push({ id: "sounds", label: "Reaction sounds armed (backup path)", status: "warn", detail: `The sound mixer reports "${audio.contextState ?? "unavailable"}", so reactions will use the ${audio.unlockedElements} unlocked backup players instead. This is the expected path while a video plays on iPadOS.` });
    } else {
      collected.push({ id: "sounds", label: "Reaction sounds blocked", status: "fail", detail: "Neither the sound mixer nor the backup players could start. Check the volume and mute switch, then run the check again." });
    }

    const unlocked = await probeUnlock;
    probe.pause();
    let playsLater = false;
    if (unlocked) {
      await wait(LATER_PLAYBACK_DELAY_MS);
      try { probe.currentTime = 0; } catch { /* not seekable */ }
      playsLater = await probe.play().then(() => true).catch(() => false);
      probe.pause();
    }
    collected.push(unlocked && playsLater
      ? { id: "autoplay", label: "Sounds may start later without a tap", status: "pass", detail: "The browser let a test sound start on its own after the tap ended. Reactions arriving mid-song will play." }
      : unlocked
        ? { id: "autoplay", label: "Later playback needs attention", status: "warn", detail: "A test sound played during the tap but not afterwards. Keep this tab in the foreground; if reactions stay silent, tap Enable & test funny sounds again." }
        : { id: "autoplay", label: "Playback blocked", status: "fail", detail: "The browser refused to play a test sound even during the tap. Check the mute switch and volume, then run the check again." });

    const wakeLock = await wakeLockRequest;
    collected.push(wakeLock
      ? { id: "wake", label: "Screen wake lock active", status: "pass", detail: "This screen will stay awake while the host tab is visible." }
      : { id: "wake", label: current.wakeLockSupported === false ? "Screen wake lock unavailable" : "Screen wake lock refused", status: "warn", detail: "Set Auto-Lock to Never (Settings → Display & Brightness) and keep the charger connected." });

    if (current.musicSource === "youtube") {
      collected.push(current.youtubeStatus === "ready"
        ? { id: "player", label: "YouTube player ready", status: "pass", detail: browser === "ipad-chrome" || browser.startsWith("ios") ? "Tap Start speaker when the first video arrives, then tap the video itself once if it does not begin." : "Tap Start speaker when the first video arrives. Later videos start automatically." }
        : current.youtubeStatus === "error"
          ? { id: "player", label: "YouTube player failed to load", status: "fail", detail: "Reload this page. If it keeps failing, check that youtube.com is not blocked on this network." }
          : { id: "player", label: "YouTube player still loading", status: "warn", detail: "Wait a few seconds and run the check again." });
    } else {
      collected.push(current.spotifyStatus === "ready"
        ? { id: "player", label: "Spotify speaker ready", status: "pass", detail: "Tap Start speaker when the first song arrives." }
        : current.spotifyStatus === "disconnected"
          ? { id: "player", label: "Spotify not connected", status: "fail", detail: "Connect Spotify Premium above before guests arrive. On an iPad, Spotify's browser player may not be supported; a YouTube room is the safer choice there." }
          : current.spotifyStatus === "error"
            ? { id: "player", label: "Spotify speaker error", status: "fail", detail: "Reconnect Spotify above, or reload this page." }
            : { id: "player", label: "Spotify still connecting", status: "warn", detail: "Wait a few seconds and run the check again." });
    }

    const started = performance.now();
    const reachable = await current.probeRoomData();
    const latency = Math.round(performance.now() - started);
    collected.push(reachable
      ? { id: "network", label: "Room data reachable", status: latency > 2_500 ? "warn" : "pass", detail: `Answered in ${latency} ms. Guests' reactions reach this screen within about two seconds.` }
      : { id: "network", label: "Room data unreachable", status: "fail", detail: "This device cannot reach HackMusic right now. Check Wi-Fi, then run the check again." });

    collected.push(document.visibilityState === "visible"
      ? { id: "foreground", label: "Host tab in the foreground", status: "pass", detail: "Keep it this way: switching apps or tabs pauses video and delays reactions on tablets and phones." }
      : { id: "foreground", label: "Host tab is hidden", status: "warn", detail: "Bring this tab to the front and keep it there during the event." });

    setResults(collected);
    setCheckedAt(new Date().toISOString());
    setRunning(false);
  }, [running]);

  const clear = useCallback(() => setResults(null), []);

  return { running, results, checkedAt, run, clear };
}
