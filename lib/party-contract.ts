export type PartyColor = "coral" | "sun" | "blue" | "mint";
export type PartyStatus = "lobby" | "live" | "ended";
export type QueueMode = "ordered" | "random" | "fair";
export type MusicSource = "spotify" | "youtube";
export const MUSIC_SOURCES: readonly MusicSource[] = ["spotify", "youtube"];
export type ReactionTone = "up" | "down";

export type PartyTrack = {
  id: string;
  title: string;
  artist: string;
  duration: string;
  color: PartyColor;
  shielded?: boolean;
};

export type PartyPerson = {
  id: string;
  initials: string;
  name: string;
  score: number | null;
  color: PartyColor;
};

export type PartyReaction = {
  id: string;
  mine: boolean;
  avatar: string;
  name: string;
  message: string;
  icon: "▲" | "▼";
  tone: ReactionTone;
  boosted?: boolean;
  createdAt?: string;
};

export type PartyActivity = {
  id: string;
  mine?: boolean;
  avatar: string;
  name: string;
  message: string;
  icon: string;
  tone: ReactionTone | "song";
  trackTitle: string;
  createdAt: string;
};

export type PartyPowerUps = {
  shieldAvailable: boolean;
  shieldUsableNow: boolean;
  boostAvailable: boolean;
};

export type LastSongReveal = {
  queueId: string;
  title: string;
  artist: string;
  /** Null until the host enables per-song reveals or the party ends. */
  submittedBy: string | null;
  submitterAvatar: string | null;
  submitterColor: PartyColor | null;
  mine: boolean;
  status: "played" | "skipped";
  skipReason: "boos" | "host" | null;
  skipPercent: number | null;
  totalGuesses: number;
  correctGuesses: number;
  myGuessCorrect: boolean | null;
};

export type PartyAward = {
  id: string;
  emoji: string;
  title: string;
  winnerId: string;
  winnerName: string;
  winnerAvatar: string;
  winnerColor: PartyColor;
  detail: string;
};

export type PartyRecap = {
  songsPlayed: number;
  songsBooedOff: number;
  reactions: number;
};

export type HostFlair = {
  id: string;
  emoji: string;
  avatar: string;
  createdAt: string;
};

export type MySong = PartyTrack & {
  queueId: string;
  status: "pending" | "playing" | "played" | "skipped" | "removed";
  skipReason: "boos" | "host" | null;
  skipPercent: number | null;
  submittedAt: string;
};

export type MyReactionHistory = {
  reactionId: string;
  id: string;
  title: string;
  artist: string;
  tone: ReactionTone;
  songStatus: MySong["status"];
  skipReason: MySong["skipReason"];
  skipPercent: number | null;
  reactedAt: string;
};

export type ParticipantParty = {
  code: string;
  title: string;
  viewer: PartyPerson;
  viewerDisplayName: string;
  musicSource: MusicSource;
  theme: string | null;
  revealPickers: boolean;
  currentTrackStartedAt: string | null;
  powerUps: PartyPowerUps;
  guessOptions: PartyPerson[];
  myGuess: string | null;
  lastSong: LastSongReveal | null;
  awards?: PartyAward[];
  recap?: PartyRecap;
  people: PartyPerson[];
  currentTrack: PartyTrack | null;
  reactions: PartyReaction[];
  activity?: PartyActivity[];
  mySongs: MySong[];
  myReactionHistory: MyReactionHistory[];
  pendingCount: number;
  queueCount: number;
  status: PartyStatus;
  scheduledFor: string | null;
};

export type RoomSummary = {
  code: string;
  title: string;
  status: PartyStatus;
  scheduledFor: string | null;
  createdAt?: string;
  requiresPasscode: boolean;
  musicSource: MusicSource;
};

export type HostQueuedTrack = PartyTrack & {
  queueId: string;
  submittedBy: string;
  submitterInitials: string;
};

export type HostSongHistory = HostQueuedTrack & {
  status: "played" | "skipped";
  skipReason: "boos" | "host" | null;
  skipPercent: number | null;
  startedAt: string | null;
};

export type HostParty = {
  code: string;
  title: string;
  status: PartyStatus;
  scheduledFor: string | null;
  requiresPasscode: boolean;
  musicSource: MusicSource;
  theme: string | null;
  revealPickers: boolean;
  currentTrackStartedAt: string | null;
  lastSong: LastSongReveal | null;
  awards?: PartyAward[];
  recap?: PartyRecap;
  currentTrack: PartyTrack | null;
  people: Array<Omit<PartyPerson, "score"> & { score: number }>;
  reactions: Array<{ id: string; tone: ReactionTone; boosted?: boolean }>;
  queueCount: number;
  queueMode: QueueMode;
  queuedTracks: HostQueuedTrack[];
  songHistory: HostSongHistory[];
  activity?: Array<{ id: string; tone: ReactionTone | "song"; createdAt: string }>;
  flair?: HostFlair[];
};

export type HostTransfer = {
  token: string;
  targetName: string;
  expiresAt: string;
};

export type PartyAction =
  | "create"
  | "join"
  | "react"
  | "submit"
  | "remove"
  | "avatar"
  | "profileName"
  | "start"
  | "skip"
  | "advance"
  | "end"
  | "rename"
  | "queueMode"
  | "passcode"
  | "prepareHostTransfer"
  | "cancelHostTransfer"
  | "claimHost"
  | "skipProgress"
  | "flair"
  | "shield"
  | "guess"
  | "theme"
  | "revealPickers";

export type PartyRequest = {
  action?: PartyAction;
  code?: string;
  participantId?: string;
  kind?: ReactionTone;
  pin?: string;
  queueMode?: QueueMode;
  musicSource?: MusicSource;
  name?: string;
  title?: string;
  passcode?: string;
  website?: string;
  preParty?: boolean;
  scheduledFor?: string;
  trackUrl?: string;
  trackId?: string;
  submissionId?: string;
  avatarEmoji?: string;
  targetParticipantId?: string;
  transferToken?: string;
  skipPercent?: number;
  track?: PartyTrack;
  emoji?: string;
  boost?: boolean;
  guessParticipantId?: string;
  theme?: string;
  revealPickers?: boolean;
};
