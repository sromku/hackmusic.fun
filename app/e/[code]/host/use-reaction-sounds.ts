"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SpotifyPlayer } from "./spotify-sdk";

const REACTION_DUCK_VOLUME = 0.28;
export const REACTION_SOUND_VERSION = "2026-08-23-6";
const waitForAudioFade = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function useReactionSounds(spotifyPlayerRef: RefObject<SpotifyPlayer | null>, onMessage: (message: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const cheerAudioRef = useRef<HTMLAudioElement | null>(null);
  const booAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<{ up: AudioBuffer; down: AudioBuffer } | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const activeCountRef = useRef(0);
  const effectTimersRef = useRef<Set<number>>(new Set());
  const volumeBeforeDuckRef = useRef<number | null>(null);
  const soundTokenRef = useRef(0);
  const activeAudioRef = useRef<Set<HTMLAudioElement>>(new Set());

  const prepare = useCallback(async () => {
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("This browser cannot create the reaction sound mixer.");
    const context = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    if (!buffersRef.current) {
      const [cheerResponse, booResponse] = await Promise.all([
        fetch(`/sounds/woohoo-crowd.wav?v=${REACTION_SOUND_VERSION}`),
        fetch(`/sounds/boo.mp3?v=${REACTION_SOUND_VERSION}`),
      ]);
      if (!cheerResponse.ok || !booResponse.ok) throw new Error("The funny sounds could not be loaded.");
      const [cheerBytes, booBytes] = await Promise.all([cheerResponse.arrayBuffer(), booResponse.arrayBuffer()]);
      const [up, down] = await Promise.all([context.decodeAudioData(cheerBytes), context.decodeAudioData(booBytes)]);
      buffersRef.current = { up, down };
    }
    return context;
  }, []);

  const play = useCallback((kind: "up" | "down") => {
    if (!enabledRef.current) return;
    const template = kind === "up" ? cheerAudioRef.current : booAudioRef.current;
    const context = audioContextRef.current;
    const buffer = buffersRef.current?.[kind];
    if ((!context || !buffer) && !template) return;

    soundTokenRef.current += 1;
    const firstActiveReaction = activeCountRef.current === 0;
    activeCountRef.current += 1;
    let sound: HTMLAudioElement | null = null;
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
      if (sound) activeAudioRef.current.delete(sound);
      if (source) activeSourcesRef.current.delete(source);
      activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      if (activeCountRef.current) return;
      const restoreToken = soundTokenRef.current;
      const player = spotifyPlayerRef.current;
      const originalVolume = volumeBeforeDuckRef.current;
      if (!player || originalVolume === null) return;
      void (async () => {
        const duckedVolume = Math.min(originalVolume, REACTION_DUCK_VOLUME);
        for (let step = 1; step <= 6; step += 1) {
          if (restoreToken !== soundTokenRef.current || player !== spotifyPlayerRef.current) return;
          await player.setVolume(duckedVolume + ((originalVolume - duckedVolume) * step / 6)).catch(() => undefined);
          if (step < 6) await waitForAudioFade(80);
        }
        if (restoreToken === soundTokenRef.current) volumeBeforeDuckRef.current = null;
      })();
    };

    const playOverDuckedMusic = async () => {
      const player = spotifyPlayerRef.current;
      if (player && firstActiveReaction) {
        let originalVolume = volumeBeforeDuckRef.current;
        if (originalVolume === null) {
          originalVolume = await player.getVolume().catch(() => 0.8);
          volumeBeforeDuckRef.current = originalVolume;
          await player.setVolume(originalVolume + ((Math.min(originalVolume, REACTION_DUCK_VOLUME) - originalVolume) * 0.65)).catch(() => undefined);
          await waitForAudioFade(45);
        }
        if (player === spotifyPlayerRef.current) await player.setVolume(Math.min(originalVolume, REACTION_DUCK_VOLUME)).catch(() => undefined);
      }
      if (context && buffer) {
        if (context.state === "suspended") await context.resume();
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = restoreMusic;
        activeSourcesRef.current.add(source);
        source.start(0);
        effectTimer = window.setTimeout(restoreMusic, buffer.duration * 1_000 + 500);
      } else if (template) {
        sound = template.cloneNode(true) as HTMLAudioElement;
        sound.preload = "auto";
        sound.volume = 1;
        sound.onended = restoreMusic;
        sound.onerror = restoreMusic;
        activeAudioRef.current.add(sound);
        await sound.play();
        effectTimer = window.setTimeout(restoreMusic, Number.isFinite(sound.duration) ? sound.duration * 1_000 + 500 : 4_000);
      }
      if (effectTimer) effectTimersRef.current.add(effectTimer);
    };

    void playOverDuckedMusic().catch(() => {
      restoreMusic();
      onMessage("The phone blocked reaction audio. Tap Enable & test funny sounds again.");
    });
  }, [onMessage, spotifyPlayerRef]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    soundTokenRef.current += 1;
    effectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    effectTimersRef.current.clear();
    activeSourcesRef.current.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
    activeSourcesRef.current.clear();
    cheerAudioRef.current?.pause();
    booAudioRef.current?.pause();
    activeAudioRef.current.forEach((sound) => sound.pause());
    activeAudioRef.current.clear();
    activeCountRef.current = 0;
    if (cheerAudioRef.current) cheerAudioRef.current.currentTime = 0;
    if (booAudioRef.current) booAudioRef.current.currentTime = 0;
    const player = spotifyPlayerRef.current;
    const originalVolume = volumeBeforeDuckRef.current;
    volumeBeforeDuckRef.current = null;
    if (player && originalVolume !== null) void player.setVolume(originalVolume).catch(() => undefined);
  }, [spotifyPlayerRef]);

  const enableAndTest = useCallback(async () => {
    await prepare();
    enabledRef.current = true;
    setEnabled(true);
    play("up");
    window.setTimeout(() => play("down"), 650);
  }, [play, prepare]);

  useEffect(() => {
    const activeAudio = activeAudioRef.current;
    const activeSources = activeSourcesRef.current;
    const effectTimers = effectTimersRef.current;
    const cheerSound = new Audio(`/sounds/woohoo-crowd.wav?v=${REACTION_SOUND_VERSION}`);
    const booSound = new Audio(`/sounds/boo.mp3?v=${REACTION_SOUND_VERSION}`);
    cheerSound.preload = "auto";
    booSound.preload = "auto";
    cheerSound.load();
    booSound.load();
    cheerAudioRef.current = cheerSound;
    booAudioRef.current = booSound;
    return () => {
      enabledRef.current = false;
      soundTokenRef.current += 1;
      effectTimers.forEach((timer) => window.clearTimeout(timer));
      activeSources.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
      activeAudio.forEach((sound) => sound.pause());
      void audioContextRef.current?.close().catch(() => undefined);
      cheerSound.pause();
      booSound.pause();
    };
  }, []);

  return { enabled, play, enableAndTest, disable };
}
