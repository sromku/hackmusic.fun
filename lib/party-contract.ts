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
  currentTrack: PartyTrack | null;
  people: Array<Omit<PartyPerson, "score"> & { score: number }>;
  reactions: Array<{ id: string; tone: ReactionTone }>;
  queueCount: number;
  queueMode: QueueMode;
  queuedTracks: HostQueuedTrack[];
  songHistory: HostSongHistory[];
  activity?: Array<{ id: string; tone: ReactionTone | "song"; createdAt: string }>;
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
  | "skipProgress";

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
};
