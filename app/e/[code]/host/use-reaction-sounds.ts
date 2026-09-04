"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type MusicVolumeControl = {
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<void>;
};

type ReactionKind = "up" | "down";
export type SoundLogEntry = { at: string; sound: string; path: "webaudio" | "element" | "synth" | "skipped"; reason: string };
const SOUND_LOG_LIMIT = 20;
export type SoundEffectKind = "sting" | "scratch" | "airhorn" | "slam";
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

const REACTION_DUCK_VOLUME = 0.28;
export const REACTION_SOUND_VERSION = "2026-09-03-1";
const REACTION_SOUND_FILES: Record<ReactionKind, string> = {
  up: `/sounds/woohoo-crowd.wav?v=${REACTION_SOUND_VERSION}`,
  down: `/sounds/boo.mp3?v=${REACTION_SOUND_VERSION}`,
};
const ELEMENT_POOL_SIZE = 5;
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
  const duckWatchdogRef = useRef<number | null>(null);
  const unlockedElementsRef = useRef(0);
  const soundLogRef = useRef<SoundLogEntry[]>([]);
  const logSound = useCallback((sound: string, path: SoundLogEntry["path"], reason: string) => {
    soundLogRef.current = [{ at: new Date().toISOString(), sound, path, reason }, ...soundLogRef.current].slice(0, SOUND_LOG_LIMIT);
  }, []);

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
        const state = context.state as string;
        if (state === "running" || state === "closed") return;
        // Anything still scheduled would otherwise play whenever the context wakes up again, seemingly out of nowhere.
        activeSourcesRef.current.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
        activeSourcesRef.current.clear();
        if (enabledRef.current) void context.resume().catch(() => undefined);
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

  /** `pitch` lets a burst of reactions climb (1 = natural). */
  const play = useCallback((kind: ReactionKind, reason = "unspecified", pitch = 1) => {
    if (!enabledRef.current) { logSound(kind, "skipped", `${reason} (sounds disabled)`); return; }
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
      // Slight random pitch so a crowd of identical reactions does not sound like a sample pad.
      source.playbackRate.value = (0.95 + Math.random() * 0.1) * pitch;
      source.connect(context.destination);
      source.onended = restoreMusic;
      activeSourcesRef.current.add(source);
      source.start(0);
      scheduleSafetyRestore(buffer.duration);
      logSound(kind, "webaudio", reason);
      return true;
    };

    const playThroughElement = async () => {
      const pool = elementPoolRef.current?.[kind];
      if (!pool?.length) return false;
      element = pool.find((candidate) => candidate.paused || candidate.ended) ?? pool[0];
      try { element.currentTime = 0; } catch { /* not seekable yet */ }
      element.volume = 1;
      element.muted = false;
      try {
        (element as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
        element.playbackRate = (0.95 + Math.random() * 0.1) * pitch;
      } catch { /* pitch variation is optional */ }
      element.onended = restoreMusic;
      element.onerror = restoreMusic;
      activeElementsRef.current.add(element);
      await element.play();
      scheduleSafetyRestore(element.duration);
      logSound(kind, "element", reason);
      return true;
    };

    const playOverDuckedMusic = async () => {
      const player = musicRef.current;
      if (player && firstActiveReaction) {
        let originalVolume = volumeBeforeDuckRef.current;
        if (originalVolume === null) {
          const reported = await player.getVolume().catch(() => Number.NaN);
          // Unknown or muted volume: play the sound over the music untouched rather than risk restoring to silence.
          originalVolume = Number.isFinite(reported) && reported > 0.05 && reported <= 1 ? reported : null;
          if (originalVolume !== null) {
            volumeBeforeDuckRef.current = originalVolume;
            await player.setVolume(originalVolume + ((Math.min(originalVolume, REACTION_DUCK_VOLUME) - originalVolume) * 0.65)).catch(() => undefined);
            await waitForAudioFade(45);
          }
        }
        if (originalVolume !== null && player === musicRef.current) await player.setVolume(Math.min(originalVolume, REACTION_DUCK_VOLUME)).catch(() => undefined);
        if (duckWatchdogRef.current) window.clearTimeout(duckWatchdogRef.current);
        // Watchdog: whatever happens to the individual sounds, the music is back at full volume within a few seconds.
        duckWatchdogRef.current = window.setTimeout(() => {
          const stuckVolume = volumeBeforeDuckRef.current;
          if (activeCountRef.current === 0 && stuckVolume !== null) {
            volumeBeforeDuckRef.current = null;
            void musicRef.current?.setVolume(stuckVolume).catch(() => undefined);
          }
        }, 8_000);
      }
      // Web Audio first; if the context is interrupted (iOS while another player has the audio session), use the unlocked media elements.
      const played = (await playThroughWebAudio()) || (await playThroughElement());
      if (!played) throw new Error("Reaction audio has no working output.");
    };

    void playOverDuckedMusic().catch(() => {
      restoreMusic();
      logSound(kind, "skipped", `${reason} (playback failed)`);
      onMessage("The phone blocked reaction audio. Tap Enable & test funny sounds again.");
    });
  }, [logSound, musicRef, onMessage]);

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
    play("up", "test after enabling");
    window.setTimeout(() => play("down", "test after enabling"), 650);
  }, [play, prepare, unlockElementPool]);

  useEffect(() => {
    const activeElements = activeElementsRef.current;
    const activeSources = activeSourcesRef.current;
    const effectTimers = effectTimersRef.current;
    ensureElementPool();
    const resumeWhenVisible = () => {
      const context = audioContextRef.current;
      if (!context) return;
      if (document.visibilityState === "visible") { if (enabledRef.current) void ensureContextRunning(context); return; }
      activeSourcesRef.current.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
      activeSourcesRef.current.clear();
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

  /** Synthesized one-shot effects for dramatic moments. Web Audio only; silently skipped when the mixer is not running. */
  const playEffect = useCallback((kind: SoundEffectKind, reason = "unspecified") => {
    const context = audioContextRef.current;
    if (!enabledRef.current || !context || (context.state as string) !== "running") { logSound(kind, "skipped", `${reason} (mixer not running)`); return; }
    logSound(kind, "synth", reason);
    try {
      synthesizeEffect(context, kind);
    } catch (error) {
      console.error("HackMusic: sound effect failed.", error);
    }
  }, [logSound]);

  const inspect = useCallback(() => ({
    contextState: (audioContextRef.current?.state as string | undefined) ?? null,
    buffersLoaded: Boolean(buffersRef.current),
    unlockedElements: unlockedElementsRef.current,
    poolSize: ELEMENT_POOL_SIZE * 2,
    recentSounds: soundLogRef.current,
  }), []);

  return { enabled, play, playEffect, enableAndTest, disable, inspect };
}

function synthesizeEffect(context: AudioContext, kind: SoundEffectKind) {
    const now = context.currentTime;
    const master = context.createGain();
    master.connect(context.destination);
    const envelope = (node: GainNode, peak: number, attack: number, hold: number, release: number) => {
      node.gain.setValueAtTime(0.0001, now);
      node.gain.exponentialRampToValueAtTime(peak, now + attack);
      node.gain.setValueAtTime(peak, now + attack + hold);
      node.gain.exponentialRampToValueAtTime(0.0001, now + attack + hold + release);
    };
    const noiseBuffer = (seconds: number) => {
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      return buffer;
    };
    let total = 1.5;
    if (kind === "sting") {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(320, now);
      filter.frequency.linearRampToValueAtTime(900, now + 1.2);
      filter.connect(master);
      [55, 82.5, 110].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.value = frequency;
        oscillator.detune.value = index * 7;
        oscillator.connect(filter);
        oscillator.start(now);
        oscillator.stop(now + 1.6);
      });
      // The tremolo modulates its own stage, never the master envelope, so the tail can never swing negative and buzz.
      const tremoloStage = context.createGain();
      tremoloStage.gain.value = 0.65;
      filter.disconnect();
      filter.connect(tremoloStage).connect(master);
      const tremolo = context.createOscillator();
      const tremoloDepth = context.createGain();
      tremolo.frequency.value = 6.5;
      tremoloDepth.gain.value = 0.3;
      tremolo.connect(tremoloDepth).connect(tremoloStage.gain);
      tremolo.start(now);
      tremolo.stop(now + 1.6);
      envelope(master, 0.55, 0.08, 1.0, 0.45);
      total = 1.7;
    } else if (kind === "scratch") {
      const source = context.createBufferSource();
      source.buffer = noiseBuffer(0.6);
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(2400, now);
      filter.frequency.exponentialRampToValueAtTime(260, now + 0.5);
      source.connect(filter).connect(master);
      source.start(now);
      source.stop(now + 0.6);
      envelope(master, 0.7, 0.02, 0.3, 0.25);
      total = 0.7;
    } else if (kind === "airhorn") {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2600;
      filter.connect(master);
      [0, -9, 12].forEach((cents) => {
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(520, now);
        oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.18);
        oscillator.detune.value = cents;
        oscillator.connect(filter);
        oscillator.start(now);
        oscillator.stop(now + 1.5);
      });
      envelope(master, 0.5, 0.03, 1.05, 0.35);
      total = 1.5;
    } else {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(110, now);
      oscillator.frequency.exponentialRampToValueAtTime(28, now + 0.5);
      oscillator.connect(master);
      oscillator.start(now);
      oscillator.stop(now + 0.9);
      const thud = context.createBufferSource();
      thud.buffer = noiseBuffer(0.2);
      const thudGain = context.createGain();
      thudGain.gain.setValueAtTime(0.4, now);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      thud.connect(thudGain).connect(master);
      thud.start(now);
      envelope(master, 0.9, 0.01, 0.35, 0.5);
      total = 0.95;
    }
    window.setTimeout(() => { try { master.disconnect(); } catch { /* already gone */ } }, total * 1_000 + 100);
}
