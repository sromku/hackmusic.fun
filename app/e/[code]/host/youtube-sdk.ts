export const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";

export const YouTubePlayerState = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

export type YouTubePlayer = {
  loadVideoById: (videoId: string) => void;
  cueVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getVolume: () => number;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVideoData?: () => { video_id?: string };
  destroy: () => void;
};

export type YouTubePlayerEvent<T = number> = { target: YouTubePlayer; data: T };

type YouTubePlayerConstructor = new (element: HTMLElement, options: {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YouTubePlayerEvent<undefined>) => void;
    onStateChange?: (event: YouTubePlayerEvent) => void;
    onError?: (event: YouTubePlayerEvent) => void;
  };
}) => YouTubePlayer;

declare global {
  interface Window {
    YT?: { Player: YouTubePlayerConstructor; PlayerState?: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export function youtubeErrorMessage(code: number) {
  if (code === 2) return "YouTube rejected that video ID.";
  if (code === 5) return "This browser could not play that YouTube video.";
  if (code === 100) return "That YouTube video was removed or is private.";
  if (code === 101 || code === 150) return "That video's owner does not allow it to play outside YouTube.";
  return "YouTube could not play that video.";
}
