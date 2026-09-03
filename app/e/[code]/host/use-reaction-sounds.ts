"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type MusicVolumeControl = {
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<void>;
};

type ReactionKind = "up" | "down";
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

const REACTION_DUCK_VOLUME = 0.28;
export const REACTION_SOUND_VERSION = "2026-09-03-1";
const REACTION_SOUND_FILES: Record<ReactionKind, string> = {
  up: `/sounds/woohoo-crowd.wav?v=${REACTION_SOUND_VERSION}`,
  down: `/sounds/boo.mp3?v=${REACTION_SOUND_VERSION}`,
};
const ELEMENT_POOL_SIZE = 3;
const CONTEXT_RESUME_TIMEOUT_MS = 350;
const waitForAudioFade = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

/**
 * Safari reports "interrupted" (not part of the standard AudioContextState union) when another
 * media element or app takes the audio session. Treat anything that is not "running" as needing a resume.
 */
async function ensureContextRunning(context: AudioContext) {
  const state = context.state as string;
  if (state === "running") return true;
  if (state === "closed") return false;
  await Promise.race([context.resume().catch(() => undefined), waitForAudioFade(CONTEXT_RESUME_TIMEOUT_MS)]);
  return (context.state as string) === "running";
}

function createElementPool() {
  const build = (kind: ReactionKind) => Array.from({ length: ELEMENT_POOL_SIZE }, () => {
    const element = new Audio(REACTION_SOUND_FILES[kind]);
    element.preload = "auto";
    element.setAttribute("playsinline", "true");
    element.load();
    return element;
  });
  return { up: build("up"), down: build("down") };
}

export function useReactionSounds(musicRef: RefObject<MusicVolumeControl | null>, onMessage: (message: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<{ up: AudioBuffer; down: AudioBuffer } | null>(null);
  const elementPoolRef = useRef<{ up: HTMLAudioElement[]; down: HTMLAudioElement[] } | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const activeElementsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const activeCountRef = useRef(0);
  const effectTimersRef = useRef<Set<number>>(new Set());
  const volumeBeforeDuckRef = useRef<number | null>(null);
  const soundTokenRef = useRef(0);
  const unlockedElementsRef = useRef(0);

  const ensureElementPool = useCallback(() => {
    if (!elementPoolRef.current) elementPoolRef.current = createElementPool();
    return elementPoolRef.current;
  }, []);

  /**
   * Must be called synchronously inside a user gesture: iOS only lets media elements play later if
   * play() was first invoked while a tap was being handled. The pool is played muted, then rewound.
   */
  const unlockElementPool = useCallback(async () => {
    const pool = ensureElementPool();
    unlockedElementsRef.current = 0;
    await Promise.all([...pool.up, ...pool.down].map(async (element) => {
      element.muted = true;
      try {
        await element.play();
        unlockedElementsRef.current += 1;
      } catch {
        // The browser refused; the Web Audio path is still available.
      }
      element.pause();
      try { element.currentTime = 0; } catch { /* metadata not ready yet */ }
      element.muted = false;
    }));
  }, [ensureElementPool]);

  const prepare = useCallback(async () => {
    try {
      const session = (navigator as AudioSessionNavigator).audioSession;
      if (session && session.type !== "playback") session.type = "playback";
    } catch {
      // Older browsers do not expose the audio session API.
    }
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("This browser cannot create the reaction sound mixer.");
    const context = audioContextRef.current ?? new AudioContextConstructor();
    if (!audioContextRef.current) {
      audioContextRef.current = context;
      context.onstatechange = () => {
        if (enabledRef.current && (context.state as string) !== "running" && (context.state as string) !== "closed") void context.resume().catch(() => undefined);
      };
    }
    await ensureContextRunning(context);
    if (!buffersRef.current) {
      const [cheerResponse, booResponse] = await Promise.all([fetch(REACTION_SOUND_FILES.up), fetch(REACTION_SOUND_FILES.down)]);
      if (!cheerResponse.ok || !booResponse.ok) throw new Error("The funny sounds could not be loaded.");
      const [cheerBytes, booBytes] = await Promise.all([cheerResponse.arrayBuffer(), booResponse.arrayBuffer()]);
      const [up, down] = await Promise.all([context.decodeAudioData(cheerBytes), context.decodeAudioData(booBytes)]);
      buffersRef.current = { up, down };
    }
    return context;
  }, []);

  const play = useCallback((kind: ReactionKind) => {
    if (!enabledRef.current) return;
    const hasWebAudio = Boolean(audioContextRef.current && buffersRef.current?.[kind]);
    const hasElements = Boolean(elementPoolRef.current?.[kind].length);
    if (!hasWebAudio && !hasElements) return;

    soundTokenRef.current += 1;
    const firstActiveReaction = activeCountRef.current === 0;
    activeCountRef.current += 1;
    let element: HTMLAudioElement | null = null;
    let source: AudioBufferSourceNode | null = null;
    let effectTimer = 0;
    let finished = false;

    const restoreMusic = () => {
      if (finished) return;
      finished = true;
      if (effectTimer) {
        window.clearTimeout(effectTimer);
        effectTimersRef.current.delete(effectTimer);
      }
      if (element) activeElementsRef.current.delete(element);
      if (source) activeSourcesRef.current.delete(source);
      activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      if (activeCountRef.current) return;
      const restoreToken = soundTokenRef.current;
      const player = musicRef.current;
      const originalVolume = volumeBeforeDuckRef.current;
      if (!player || originalVolume === null) return;
      void (async () => {
        const duckedVolume = Math.min(originalVolume, REACTION_DUCK_VOLUME);
        for (let step = 1; step <= 6; step += 1) {
          if (restoreToken !== soundTokenRef.current || player !== musicRef.current) return;
          await player.setVolume(duckedVolume + ((originalVolume - duckedVolume) * step / 6)).catch(() => undefined);
          if (step < 6) await waitForAudioFade(80);
        }
        if (restoreToken === soundTokenRef.current) volumeBeforeDuckRef.current = null;
      })();
    };

    const scheduleSafetyRestore = (durationSeconds: number) => {
      effectTimer = window.setTimeout(restoreMusic, (Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds * 1_000 : 3_500) + 500);
      effectTimersRef.current.add(effectTimer);
    };

    const playThroughWebAudio = async () => {
      const context = audioContextRef.current;
      const buffer = buffersRef.current?.[kind];
      if (!context || !buffer) return false;
      if (!(await ensureContextRunning(context))) return false;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = restoreMusic;
      activeSourcesRef.current.add(source);
      source.start(0);
      scheduleSafetyRestore(buffer.duration);
      return true;
    };

    const playThroughElement = async () => {
      const pool = elementPoolRef.current?.[kind];
      if (!pool?.length) return false;
      element = pool.find((candidate) => candidate.paused || candidate.ended) ?? pool[0];
      try { element.currentTime = 0; } catch { /* not seekable yet */ }
      element.volume = 1;
      element.muted = false;
      element.onended = restoreMusic;
      element.onerror = restoreMusic;
      activeElementsRef.current.add(element);
      await element.play();
      scheduleSafetyRestore(element.duration);
      return true;
    };

    const playOverDuckedMusic = async () => {
      const player = musicRef.current;
      if (player && firstActiveReaction) {
        let originalVolume = volumeBeforeDuckRef.current;
        if (originalVolume === null) {
          originalVolume = await player.getVolume().catch(() => 0.8);
          volumeBeforeDuckRef.current = originalVolume;
          await player.setVolume(originalVolume + ((Math.min(originalVolume, REACTION_DUCK_VOLUME) - originalVolume) * 0.65)).catch(() => undefined);
          await waitForAudioFade(45);
        }
        if (player === musicRef.current) await player.setVolume(Math.min(originalVolume, REACTION_DUCK_VOLUME)).catch(() => undefined);
      }
      // Web Audio first; if the context is interrupted (iOS while another player has the audio session), use the unlocked media elements.
      const played = (await playThroughWebAudio()) || (await playThroughElement());
      if (!played) throw new Error("Reaction audio has no working output.");
    };

    void playOverDuckedMusic().catch(() => {
      restoreMusic();
      onMessage("The phone blocked reaction audio. Tap Enable & test funny sounds again.");
    });
  }, [musicRef, onMessage]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    soundTokenRef.current += 1;
    effectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    effectTimersRef.current.clear();
    activeSourcesRef.current.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
    activeSourcesRef.current.clear();
    activeElementsRef.current.forEach((element) => element.pause());
    activeElementsRef.current.clear();
    activeCountRef.current = 0;
    const player = musicRef.current;
    const originalVolume = volumeBeforeDuckRef.current;
    volumeBeforeDuckRef.current = null;
    if (player && originalVolume !== null) void player.setVolume(originalVolume).catch(() => undefined);
  }, [musicRef]);

  const enableAndTest = useCallback(async () => {
    // Both must start synchronously inside the tap: the element unlock and the AudioContext creation.
    const unlocking = unlockElementPool();
    const preparing = prepare();
    await Promise.all([unlocking, preparing]);
    enabledRef.current = true;
    setEnabled(true);
    play("up");
    window.setTimeout(() => play("down"), 650);
  }, [play, prepare, unlockElementPool]);

  useEffect(() => {
    const activeElements = activeElementsRef.current;
    const activeSources = activeSourcesRef.current;
    const effectTimers = effectTimersRef.current;
    ensureElementPool();
    const resumeWhenVisible = () => {
      const context = audioContextRef.current;
      if (document.visibilityState === "visible" && enabledRef.current && context) void ensureContextRunning(context);
    };
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      enabledRef.current = false;
      soundTokenRef.current += 1;
      effectTimers.forEach((timer) => window.clearTimeout(timer));
      activeSources.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
      activeElements.forEach((element) => element.pause());
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
      buffersRef.current = null;
    };
  }, [ensureElementPool]);

  const inspect = useCallback(() => ({
    contextState: (audioContextRef.current?.state as string | undefined) ?? null,
    buffersLoaded: Boolean(buffersRef.current),
    unlockedElements: unlockedElementsRef.current,
    poolSize: ELEMENT_POOL_SIZE * 2,
  }), []);

  return { enabled, play, enableAndTest, disable, inspect };
}
