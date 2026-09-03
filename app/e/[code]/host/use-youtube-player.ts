"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { YOUTUBE_IFRAME_API_URL, YouTubePlayerState, type YouTubePlayer } from "./youtube-sdk";

export type YouTubePlaybackProgress = {
  videoId: string;
  position: number;
  duration: number;
  paused: boolean;
  state: number;
};

export type YouTubePlayerStatus = "idle" | "loading" | "ready" | "error";

type YouTubePlayerOptions = {
  enabled: boolean;
  onEnded: (videoId: string) => void;
  onError: (videoId: string, code: number) => void;
  onProgress: (progress: YouTubePlaybackProgress) => void;
};

const TAP_HINT_DELAY_MS = 1_800;

export function useYouTubePlayer({ enabled, onEnded, onError, onProgress }: YouTubePlayerOptions) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [playerStatus, setStatus] = useState<Exclude<YouTubePlayerStatus, "loading">>("idle");
  const status: YouTubePlayerStatus = playerStatus === "idle" && enabled && stage ? "loading" : playerStatus;
  const [currentVideoId, setCurrentVideoId] = useState("");
  const [needsTap, setNeedsTap] = useState(false);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const currentVideoIdRef = useRef("");
  const endedVideoIdRef = useRef("");
  const tapHintTimerRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
    onProgressRef.current = onProgress;
  }, [onEnded, onError, onProgress]);

  const attachStage = useCallback((element: HTMLDivElement | null) => setStage(element), []);

  const clearTapHint = useCallback(() => {
    if (tapHintTimerRef.current) {
      window.clearTimeout(tapHintTimerRef.current);
      tapHintTimerRef.current = null;
    }
    setNeedsTap(false);
  }, []);

  useEffect(() => {
    if (!enabled || !stage) return;
    let active = true;
    const mount = document.createElement("div");
    stage.replaceChildren(mount);

    const createPlayer = () => {
      if (!active || !window.YT?.Player || playerRef.current) return;
      playerRef.current = new window.YT.Player(mount, {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, controls: 1, enablejsapi: 1, iv_load_policy: 3, origin: window.location.origin },
        events: {
          onReady: () => {
            if (!active) return;
            readyRef.current = true;
            setStatus("ready");
          },
          onStateChange: (event) => {
            if (!active) return;
            const videoId = currentVideoIdRef.current;
            if (event.data === YouTubePlayerState.playing || event.data === YouTubePlayerState.buffering) {
              if (tapHintTimerRef.current) window.clearTimeout(tapHintTimerRef.current);
              tapHintTimerRef.current = null;
              setNeedsTap(false);
            }
            if (event.data === YouTubePlayerState.ended && videoId && endedVideoIdRef.current !== videoId) {
              endedVideoIdRef.current = videoId;
              onEndedRef.current(videoId);
            }
          },
          onError: (event) => {
            if (!active) return;
            const videoId = currentVideoIdRef.current;
            if (videoId) onErrorRef.current(videoId, Number(event.data));
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        createPlayer();
      };
      if (!document.querySelector(`script[src="${YOUTUBE_IFRAME_API_URL}"]`)) {
        const script = document.createElement("script");
        script.src = YOUTUBE_IFRAME_API_URL;
        script.async = true;
        script.onerror = () => { if (active) setStatus("error"); };
        document.body.appendChild(script);
      }
    }

    return () => {
      active = false;
      if (tapHintTimerRef.current) window.clearTimeout(tapHintTimerRef.current);
      tapHintTimerRef.current = null;
      try { playerRef.current?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
      readyRef.current = false;
      currentVideoIdRef.current = "";
      stage.replaceChildren();
      setStatus("idle");
      setCurrentVideoId("");
      setNeedsTap(false);
    };
  }, [enabled, stage]);

  useEffect(() => {
    if (status !== "ready") return;
    const report = () => {
      const player = playerRef.current;
      const videoId = currentVideoIdRef.current;
      if (!player || !videoId) return;
      try {
        const state = player.getPlayerState();
        onProgressRef.current({
          videoId,
          position: Math.max(0, (player.getCurrentTime() || 0) * 1_000),
          duration: Math.max(0, (player.getDuration() || 0) * 1_000),
          paused: state !== YouTubePlayerState.playing && state !== YouTubePlayerState.buffering,
          state,
        });
      } catch {
        // The iframe may be mid-navigation; the next tick will catch up.
      }
    };
    const timer = window.setInterval(report, 500);
    return () => window.clearInterval(timer);
  }, [status]);

  const play = useCallback((videoId: string) => {
    const player = playerRef.current;
    if (!player || !readyRef.current) throw new Error("The YouTube player is still loading.");
    currentVideoIdRef.current = videoId;
    endedVideoIdRef.current = "";
    setCurrentVideoId(videoId);
    clearTapHint();
    player.loadVideoById(videoId);
    tapHintTimerRef.current = window.setTimeout(() => {
      const state = playerRef.current?.getPlayerState();
      if (currentVideoIdRef.current === videoId && state !== YouTubePlayerState.playing && state !== YouTubePlayerState.buffering && state !== YouTubePlayerState.ended) setNeedsTap(true);
    }, TAP_HINT_DELAY_MS);
  }, [clearTapHint]);

  const stop = useCallback(() => {
    currentVideoIdRef.current = "";
    endedVideoIdRef.current = "";
    setCurrentVideoId("");
    clearTapHint();
    try { playerRef.current?.stopVideo(); } catch { /* nothing was playing */ }
  }, [clearTapHint]);

  const pause = useCallback(() => {
    try { playerRef.current?.pauseVideo(); } catch { /* nothing was playing */ }
  }, []);

  const getVolume = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return 0.8;
    const volume = Number(player.getVolume());
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume / 100)) : 0.8;
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100));
  }, []);

  return { attachStage, status, currentVideoId, needsTap, play, stop, pause, getVolume, setVolume };
}
