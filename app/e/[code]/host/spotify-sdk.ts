export type SpotifyPlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string } };
};

export type SpotifyProgress = {
  position: number;
  duration: number;
  paused: boolean;
  trackUri: string;
};

export type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement: () => Promise<void>;
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  addListener: {
    (event: "ready" | "not_ready", callback: (payload: { device_id: string }) => void): boolean;
    (event: "player_state_changed", callback: (state: SpotifyPlaybackState | null) => void): boolean;
    (event: "autoplay_failed", callback: () => void): boolean;
    (event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", callback: (payload: { message: string }) => void): boolean;
  };
};

type SpotifyConstructor = new (options: {
  name: string;
  getOAuthToken: (callback: (token: string) => void) => void;
  volume?: number;
  enableMediaSession?: boolean;
}) => SpotifyPlayer;

declare global {
  interface Window {
    Spotify?: { Player: SpotifyConstructor };
    onSpotifyWebPlaybackSDKReady?: () => void;
    webkitAudioContext?: typeof AudioContext;
  }
}
