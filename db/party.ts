import { ensurePartySchema, getD1 } from ".";
import { isAvatarEmoji } from "../lib/avatar-emojis";
import { MUSIC_SOURCES, type LastSongReveal, type MusicSource, type PartyColor } from "../lib/party-contract";
import { BASE_REACTION_POINTS, BOOST_CHEER_POINTS, boosNeededToSkip, isFlairEmoji, normalizeTheme } from "../lib/party-fun";
import { computePartyAwards } from "./party-awards";
import { MAX_PARTICIPANTS_PER_ROOM, MAX_PENDING_TRACKS_PER_PERSON } from "../lib/party-rules";
import { PublicError } from "../lib/public-error";
import { hashRoomPasscode, verifyRoomPasscode } from "../lib/room-passcode";
import { resolveSpotifyTrack } from "../lib/spotify-track";
import { parseTrackReference, trackSource } from "../lib/track-link";
import { advanceCurrentTrack, estimateSkipPercent } from "./party-queue";
import {
  collapseLegacyReactionActivity,
  generateRoomCode,
  loadEvent,
  normalizeDisplayName,
  profileForName,
  type ActivityRow,
  type MyReactionHistoryRow,
  type MySubmissionRow,
  type ParticipantRow,
  type QueueMode,
  type QueuedSubmissionRow,
  type ReactionRow,
  type SongHistoryRow,
  type SubmissionRow,
} from "./party-model";

export type TrackInput = {
  id: string;
  title: string;
  artist: string;
  duration: string;
  color: string;
};

export type { QueueMode } from "./party-model";

type CreateRoomOptions = {
  passcode?: string;
  musicSource?: string;
  preParty?: boolean;
  scheduledFor?: string;
};

const HOST_TRANSFER_TTL_MS = 10 * 60 * 1000;

function randomHostKey() {
  return `host-${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

function randomTransferToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function hashTransferToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hackmusic-host-handoff-v1|${token}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createRoom(
  titleInput: string,
  hostNameInput: string,
  options: CreateRoomOptions = {},
) {
  await ensurePartySchema();
  const title = normalizeDisplayName(titleInput);
  const hostName = normalizeDisplayName(hostNameInput);
  if (title.length < 3 || title.length > 60) throw new PublicError("Use an event name between 3 and 60 characters.");
  if (hostName.length < 2 || hostName.length > 24) throw new PublicError("Use a host name between 2 and 24 characters.");
  const musicSource = (options.musicSource ?? "spotify") as MusicSource;
  if (!MUSIC_SOURCES.includes(musicSource)) throw new PublicError("Choose Spotify or YouTube as the music source for this room.");
  let scheduledFor: string | null = null;
  if (options.preParty) {
    const scheduledDate = new Date(options.scheduledFor ?? "");
    const now = Date.now();
    const latest = now + (90 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= now || scheduledDate.getTime() > latest) {
      throw new PublicError("Choose a future start time within 90 days.");
    }
    scheduledFor = scheduledDate.toISOString();
  }

  const d1 = getD1();
  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = generateRoomCode();
    const exists = await d1.prepare("SELECT id FROM events WHERE code = ?").bind(candidate).first<{ id: string }>();
    if (!exists) { code = candidate; break; }
  }
  if (!code) throw new PublicError("We could not reserve a room code. Wait a moment and try again.", 503);

  const eventId = `event-${crypto.randomUUID()}`;
  const participantId = `p-${crypto.randomUUID()}`;
  const hostKey = randomHostKey();
  const hostPublicId = `person-${crypto.randomUUID()}`;
  const passcode = await hashRoomPasscode(options.passcode ?? "");
  const profile = profileForName(hostName);
  const now = new Date().toISOString();
  const status = options.preParty ? "lobby" : "live";
  await d1.batch([
    d1.prepare("INSERT INTO events (id, code, title, status, scheduled_for, music_source, current_submission_id, host_pin, join_passcode_hash, join_passcode_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)")
      .bind(eventId, code, title, status, scheduledFor, musicSource, hostKey, passcode.hash, passcode.salt, now),
    d1.prepare("INSERT INTO participants (id, public_id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, 30, ?)")
      .bind(participantId, hostPublicId, eventId, hostName, profile.initials, profile.color, now),
  ]);
  return { code, title, status, scheduledFor, musicSource, createdAt: now, participantId, hostKey };
}

export async function readRoomSummary(codeInput: string) {
  const event = await loadEvent(codeInput);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  return { code: event.code, title: event.title, status: event.status, scheduledFor: event.scheduled_for, createdAt: event.created_at, requiresPasscode: Boolean(event.join_passcode_hash), musicSource: event.music_source ?? "spotify" };
}

export async function readParty(codeInput: string, viewerId: string, hostKey = "", activityAfter?: string) {
  const event = await loadEvent(codeInput);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  const d1 = getD1();
  if (hostKey && hostKey !== event.host_pin) throw new PublicError("The aux cable moved to another host. This browser is audience now—democracy survives.", 403);
  const isHost = Boolean(hostKey && hostKey === event.host_pin);
  const revealScores = event.status === "ended" || isHost;
  const current = event.current_submission_id
    ? await d1.prepare("SELECT id, participant_id, provider_track_id, title, artist, duration, color, shielded, shield_absorbed FROM submissions WHERE id = ?")
      .bind(event.current_submission_id).first<SubmissionRow>()
    : null;

  if (current && trackSource(current.provider_track_id) === "spotify" && (current.artist === "Spotify" || current.artist === "Artist unavailable")) {
    try {
      const enriched = await resolveSpotifyTrack(current.provider_track_id);
      current.title = enriched.title;
      current.artist = enriched.artist;
      current.duration = enriched.duration;
      await d1.prepare("UPDATE submissions SET title = ?, artist = ?, duration = ? WHERE id = ?")
        .bind(enriched.title, enriched.artist, enriched.duration, current.id).run();
    } catch {
      // Keep the stored metadata if Spotify is temporarily unavailable.
    }
  }

  const peopleResult = await d1.prepare(revealScores
    ? "SELECT id, public_id, display_name, initials, color, score, shield_used, boost_used FROM participants WHERE event_id = ? ORDER BY score DESC, created_at ASC"
    : "SELECT id, public_id, display_name, initials, color, score, shield_used, boost_used FROM participants WHERE event_id = ? ORDER BY created_at ASC")
    .bind(event.id).all<ParticipantRow>();
  const reactionResult = current
    ? await d1.prepare(`SELECT r.id, r.participant_id, r.kind, r.weight, r.created_at, p.display_name, p.initials
        FROM reactions r JOIN participants p ON p.id = r.participant_id
        WHERE r.submission_id = ? ORDER BY r.created_at DESC`)
      .bind(current.id).all<ReactionRow>()
    : { results: [] as ReactionRow[] };
  const pending = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND participant_id = ? AND status = 'pending'")
    .bind(event.id, viewerId).first<{ count: number }>();
  const queue = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND status = 'pending'")
    .bind(event.id).first<{ count: number }>();
  const queuedTracks = isHost
    ? await d1.prepare(`SELECT s.id, s.participant_id, s.provider_track_id, s.title, s.artist, s.duration, s.color, s.submitted_at,
        p.display_name, p.initials
        FROM submissions s JOIN participants p ON p.id = s.participant_id
        WHERE s.event_id = ? AND s.status = 'pending'
        ORDER BY s.submitted_at ASC`)
      .bind(event.id).all<QueuedSubmissionRow>()
    : null;
  const songHistory = isHost
    ? await d1.prepare(`SELECT s.id, s.participant_id, s.provider_track_id, s.title, s.artist, s.duration, s.color,
        s.status, s.skip_reason, s.skip_percent, s.submitted_at, p.display_name, p.initials,
        MIN(a.created_at) AS started_at
        FROM submissions s
        JOIN participants p ON p.id = s.participant_id
        LEFT JOIN activity_events a ON a.submission_id = s.id AND a.kind = 'song_start'
        WHERE s.event_id = ? AND s.status IN ('played', 'skipped')
        GROUP BY s.id
        ORDER BY COALESCE(MIN(a.created_at), s.submitted_at) DESC`)
      .bind(event.id).all<SongHistoryRow>()
    : null;
  const mySongs = !isHost
    ? await d1.prepare(`SELECT id, participant_id, provider_track_id, title, artist, duration, color, status, skip_reason, skip_percent, submitted_at
        FROM submissions
        WHERE event_id = ? AND participant_id = ?
        ORDER BY submitted_at DESC`)
      .bind(event.id, viewerId).all<MySubmissionRow>()
    : null;
  const myReactionHistory = !isHost
    ? await d1.prepare(`SELECT r.id, r.kind, r.created_at, s.provider_track_id, s.title, s.artist, s.status, s.skip_reason, s.skip_percent
        FROM reactions r JOIN submissions s ON s.id = r.submission_id
        WHERE r.event_id = ? AND r.participant_id = ?
        ORDER BY r.created_at DESC`)
      .bind(event.id, viewerId).all<MyReactionHistoryRow>()
    : null;
  const myGuessRow = current && !isHost
    ? await d1.prepare(`SELECT p.public_id FROM song_guesses g JOIN participants p ON p.id = g.guessed_participant_id
        WHERE g.submission_id = ? AND g.participant_id = ?`).bind(current.id, viewerId).first<{ public_id: string }>()
    : null;
  const lastSongRow = await d1.prepare(`SELECT s.id, s.title, s.artist, s.status, s.skip_reason, s.skip_percent,
      p.id AS submitter_id, p.display_name, p.initials, p.color,
      (SELECT COUNT(*) FROM song_guesses g WHERE g.submission_id = s.id) AS total_guesses,
      (SELECT COUNT(*) FROM song_guesses g WHERE g.submission_id = s.id AND g.correct = 1) AS correct_guesses,
      (SELECT g.correct FROM song_guesses g WHERE g.submission_id = s.id AND g.participant_id = ?) AS my_guess_correct
      FROM submissions s JOIN participants p ON p.id = s.participant_id
      WHERE s.event_id = ? AND s.status IN ('played', 'skipped')
      ORDER BY (SELECT MAX(a.created_at) FROM activity_events a WHERE a.submission_id = s.id AND a.kind = 'song_start') DESC, s.submitted_at DESC
      LIMIT 1`).bind(viewerId, event.id).first<{
        id: string; title: string; artist: string; status: "played" | "skipped"; skip_reason: "boos" | "host" | null; skip_percent: number | null;
        submitter_id: string; display_name: string; initials: string; color: string; total_guesses: number; correct_guesses: number; my_guess_correct: number | null;
      }>();
  const revealPickers = Boolean(event.reveal_pickers);
  // Pickers stay secret on the guest page unless the host turned reveals on or the party is over. The host always sees them.
  const canRevealPicker = isHost || revealPickers || event.status === "ended";
  const lastSong: LastSongReveal | null = lastSongRow ? {
    queueId: lastSongRow.id,
    title: lastSongRow.title,
    artist: lastSongRow.artist,
    submittedBy: canRevealPicker || lastSongRow.submitter_id === viewerId ? (lastSongRow.submitter_id === viewerId ? "You" : lastSongRow.display_name) : null,
    submitterAvatar: canRevealPicker || lastSongRow.submitter_id === viewerId ? lastSongRow.initials : null,
    submitterColor: canRevealPicker || lastSongRow.submitter_id === viewerId ? lastSongRow.color as PartyColor : null,
    mine: lastSongRow.submitter_id === viewerId,
    status: lastSongRow.status,
    skipReason: lastSongRow.skip_reason,
    skipPercent: lastSongRow.skip_percent,
    totalGuesses: lastSongRow.total_guesses ?? 0,
    correctGuesses: lastSongRow.correct_guesses ?? 0,
    myGuessCorrect: lastSongRow.my_guess_correct === null || lastSongRow.my_guess_correct === undefined ? null : lastSongRow.my_guess_correct === 1,
  } : null;
  const awards = event.status === "ended" ? await computePartyAwards(event.id, viewerId) : undefined;
  const recap = event.status === "ended"
    ? await d1.prepare(`SELECT
        (SELECT COUNT(*) FROM submissions WHERE event_id = ? AND status IN ('played', 'skipped')) AS songs_played,
        (SELECT COUNT(*) FROM submissions WHERE event_id = ? AND status = 'skipped' AND skip_reason = 'boos') AS songs_booed_off,
        (SELECT COUNT(*) FROM reactions WHERE event_id = ?) AS reactions`)
      .bind(event.id, event.id, event.id).first<{ songs_played: number; songs_booed_off: number; reactions: number }>()
    : null;
  let activityResult: { results: ActivityRow[] } | null = null;
  let flairResult: { results: Array<{ id: string; emoji: string; initials: string; created_at: string }> } | null = null;
  if (activityAfter !== undefined) {
    const separator = activityAfter.lastIndexOf("|");
    const cursorAt = separator > 0 ? activityAfter.slice(0, separator) : "";
    activityResult = cursorAt
      ? await d1.prepare(`SELECT a.id, a.submission_id, a.participant_id, a.kind, a.created_at, p.display_name, p.initials, s.title
          FROM activity_events a
          LEFT JOIN participants p ON p.id = a.participant_id
          JOIN submissions s ON s.id = a.submission_id
          WHERE a.event_id = ? AND a.created_at >= ?
          ORDER BY a.created_at ASC, a.id ASC`)
        .bind(event.id, cursorAt).all<ActivityRow>()
      : await d1.prepare(`SELECT a.id, a.submission_id, a.participant_id, a.kind, a.created_at, p.display_name, p.initials, s.title
          FROM activity_events a
          LEFT JOIN participants p ON p.id = a.participant_id
          JOIN submissions s ON s.id = a.submission_id
          WHERE a.event_id = ?
          ORDER BY a.created_at ASC, a.id ASC`)
        .bind(event.id).all<ActivityRow>();
    if (isHost) {
      const flairCursorAt = cursorAt || new Date(Date.now() - 60_000).toISOString();
      flairResult = await d1.prepare(`SELECT f.id, f.emoji, p.initials, f.created_at
          FROM flair_events f JOIN participants p ON p.id = f.participant_id
          WHERE f.event_id = ? AND f.created_at >= ?
          ORDER BY f.created_at ASC, f.id ASC LIMIT 200`)
        .bind(event.id, flairCursorAt).all<{ id: string; emoji: string; initials: string; created_at: string }>();
    }
  }

  const people = peopleResult.results.map((person) => ({
    id: person.public_id,
    initials: person.initials,
    name: person.id === viewerId ? "You" : person.display_name,
    score: revealScores ? person.score : null,
    color: person.color,
  }));
  const viewerIndex = peopleResult.results.findIndex((person) => person.id === viewerId);
  const viewer = viewerIndex >= 0 ? people[viewerIndex] : undefined;
  const viewerRow = viewerIndex >= 0 ? peopleResult.results[viewerIndex] : undefined;
  const viewerDisplayName = viewerRow?.display_name;
  if (!viewer || !viewerRow) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  const shieldAvailable = !(viewerRow.shield_used ?? 0);
  const powerUps = {
    shieldAvailable,
    shieldUsableNow: Boolean(shieldAvailable && event.status === "live" && current && current.participant_id === viewerId && !current.shielded),
    boostAvailable: !(viewerRow.boost_used ?? 0),
  };
  const guessOptions = !isHost && current && current.participant_id !== viewerId && event.status === "live"
    ? people.filter((person) => person.id !== viewer.id)
    : [];

  return {
    code: event.code,
    title: event.title,
    status: event.status,
    scheduledFor: event.scheduled_for,
    requiresPasscode: Boolean(event.join_passcode_hash),
    musicSource: event.music_source ?? "spotify",
    theme: event.theme ?? null,
    revealPickers,
    viewer,
    viewerDisplayName,
    people,
    powerUps,
    guessOptions,
    myGuess: myGuessRow?.public_id ?? null,
    lastSong,
    ...(awards ? { awards } : {}),
    ...(recap ? { recap: { songsPlayed: recap.songs_played ?? 0, songsBooedOff: recap.songs_booed_off ?? 0, reactions: recap.reactions ?? 0 } } : {}),
    currentTrack: current ? {
      id: current.provider_track_id,
      title: current.title,
      artist: current.artist,
      duration: current.duration,
      color: current.color,
      shielded: Boolean(current.shielded),
    } : null,
    reactions: reactionResult.results.map((reaction) => reaction.kind === "down" ? {
      id: reaction.id,
      mine: reaction.participant_id === viewerId,
      avatar: "?",
      name: "Someone",
      message: "booed this song",
      icon: "▼",
      tone: "down",
      createdAt: reaction.created_at,
    } : {
      id: reaction.id,
      mine: reaction.participant_id === viewerId,
      avatar: reaction.initials,
      name: reaction.participant_id === viewerId ? "You" : reaction.display_name,
      message: (reaction.weight ?? 1) > 1 ? "double-cheered this song" : "cheered this song",
      icon: "▲",
      tone: "up",
      boosted: (reaction.weight ?? 1) > 1,
      createdAt: reaction.created_at,
    }),
    pendingCount: pending?.count ?? 0,
    queueCount: queue?.count ?? 0,
    ...(activityResult ? { activity: collapseLegacyReactionActivity(activityResult.results).map((item) => item.kind === "song_start" ? {
      id: item.id,
      tone: "song",
      avatar: "🎵",
      name: "",
      message: "Now playing",
      icon: "▶️",
      trackTitle: item.title,
      createdAt: item.created_at,
    } : item.kind === "down" ? {
      id: item.id,
      mine: item.participant_id === viewerId,
      tone: "down",
      avatar: "?",
      name: "Someone",
      message: "booed",
      icon: "👎",
      trackTitle: item.title,
      createdAt: item.created_at,
    } : {
      id: item.id,
      mine: item.participant_id === viewerId,
      tone: "up",
      avatar: item.initials ?? "!",
      name: item.participant_id === viewerId ? "You" : item.display_name ?? "Someone",
      message: "cheered",
      icon: "🙌",
      trackTitle: item.title,
      createdAt: item.created_at,
    }) } : {}),
    ...(flairResult ? { flair: flairResult.results.map((item) => ({ id: item.id, emoji: item.emoji, avatar: item.initials, createdAt: item.created_at })) } : {}),
    ...(queuedTracks ? { queueMode: event.queue_mode, queuedTracks: queuedTracks.results.map((track) => ({
      queueId: track.id,
      id: track.provider_track_id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      color: track.color,
      submittedBy: track.participant_id === viewerId ? "You" : track.display_name,
      submitterInitials: track.initials,
    })) } : {}),
    ...(songHistory ? { songHistory: songHistory.results.map((track) => ({
      queueId: track.id,
      id: track.provider_track_id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      color: track.color,
      status: track.status,
      skipReason: track.skip_reason,
      skipPercent: track.skip_percent,
      startedAt: track.started_at,
      submittedBy: track.participant_id === viewerId ? "You" : track.display_name,
      submitterInitials: track.initials,
    })) } : {}),
    ...(mySongs ? { mySongs: mySongs.results.map((track) => ({
      queueId: track.id,
      id: track.provider_track_id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      color: track.color,
      status: track.status,
      skipReason: track.skip_reason,
      skipPercent: track.skip_percent,
      submittedAt: track.submitted_at,
    })) } : {}),
    ...(myReactionHistory ? { myReactionHistory: myReactionHistory.results.map((reaction) => ({
      reactionId: reaction.id,
      id: reaction.provider_track_id,
      title: reaction.title,
      artist: reaction.artist,
      tone: reaction.kind,
      songStatus: reaction.status,
      skipReason: reaction.skip_reason,
      skipPercent: reaction.skip_percent,
      reactedAt: reaction.created_at,
    })) } : {}),
  };
}

export async function setQueueMode(code: string, hostKey: string, queueMode: QueueMode) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser that created this room.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended, so its settings are frozen.");
  if (!(["ordered", "random", "fair"] as const).includes(queueMode)) throw new PublicError("Choose one of the available queue modes.");
  await getD1().prepare("UPDATE events SET queue_mode = ? WHERE id = ?").bind(queueMode, event.id).run();
}

export async function renameParty(code: string, hostKey: string, titleInput: string) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser holding the aux cable.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended, so its name is frozen with the scores.");
  const title = normalizeDisplayName(titleInput);
  if (title.length < 3 || title.length > 60) throw new PublicError("Use an event name between 3 and 60 characters.");
  await getD1().prepare("UPDATE events SET title = ? WHERE id = ?").bind(title, event.id).run();
}

export async function setRoomPasscode(code: string, hostKey: string, passcodeInput: string) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser that created this room.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended, so its passcode cannot be changed.");
  const passcode = await hashRoomPasscode(passcodeInput);
  await getD1().prepare("UPDATE events SET join_passcode_hash = ?, join_passcode_salt = ? WHERE id = ?")
    .bind(passcode.hash, passcode.salt, event.id).run();
}

export async function prepareHostTransfer(code: string, participantId: string, hostKey: string, targetPublicId: string) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the current host browser.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended. The aux cable is enjoying retirement.");
  if (!participantId) throw new PublicError("This host browser is missing its party identity. Reopen the participant room and try again.", 401);
  if (!targetPublicId || targetPublicId.length > 80) throw new PublicError("Choose a joined human to receive the host controls.");
  const d1 = getD1();
  const currentHost = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?")
    .bind(participantId, event.id).first<{ id: string }>();
  if (!currentHost) throw new PublicError("This host browser is no longer joined to the room.", 401);
  const target = await d1.prepare("SELECT id, display_name FROM participants WHERE public_id = ? AND event_id = ?")
    .bind(targetPublicId, event.id).first<{ id: string; display_name: string }>();
  if (!target) throw new PublicError("That human is no longer in this room. Refresh the host page and choose again.", 404);
  if (target.id === participantId) throw new PublicError("You already have the aux cable. Pick a different human for this tiny coup.");

  const token = randomTransferToken();
  const tokenHash = await hashTransferToken(token);
  const now = Date.now();
  const expiresAt = now + HOST_TRANSFER_TTL_MS;
  await d1.batch([
    d1.prepare("DELETE FROM host_transfers WHERE expires_at <= ?").bind(now),
    d1.prepare(`INSERT INTO host_transfers (event_id, target_participant_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET target_participant_id = excluded.target_participant_id,
        token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = excluded.created_at`)
      .bind(event.id, target.id, tokenHash, expiresAt, new Date(now).toISOString()),
  ]);
  return { token, targetName: target.display_name, expiresAt: new Date(expiresAt).toISOString() };
}

export async function cancelHostTransfer(code: string, hostKey: string) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the current host browser.", 403);
  await getD1().prepare("DELETE FROM host_transfers WHERE event_id = ?").bind(event.id).run();
}

export async function claimHostTransfer(code: string, participantId: string, transferToken: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the handoff link and try again.", 404);
  if (event.status === "ended") throw new PublicError("This party already ended. The host controls have been laminated for history.");
  if (!participantId) throw new PublicError("Join this room on this browser before accepting host controls.", 401);
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(transferToken)) throw new PublicError("That handoff link is incomplete. Ask the host for a fresh one.", 401);
  const d1 = getD1();
  const tokenHash = await hashTransferToken(transferToken);
  const nextHostKey = randomHostKey();
  const now = Date.now();
  const claimed = await d1.prepare(`UPDATE events SET host_pin = ?
    WHERE id = ? AND EXISTS (
      SELECT 1 FROM host_transfers
      WHERE event_id = ? AND target_participant_id = ? AND token_hash = ? AND expires_at > ?
    )`)
    .bind(nextHostKey, event.id, event.id, participantId, tokenHash, now).run();
  if (!claimed.meta.changes) {
    await d1.prepare("DELETE FROM host_transfers WHERE event_id = ? AND expires_at <= ?").bind(event.id, now).run();
    throw new PublicError("That one-use handoff link is expired, already used, or belongs to another human. Ask the current host for a fresh link.", 401);
  }
  await d1.prepare("DELETE FROM host_transfers WHERE event_id = ?").bind(event.id).run();
  return nextHostKey;
}

export async function reactToCurrent(code: string, participantId: string, kind: "up" | "down", boost = false) {
  const event = await loadEvent(code);
  if (event?.status === "lobby") throw new PublicError("Reactions unlock when the host starts the party.");
  if (!event?.current_submission_id) throw new PublicError("Nothing is playing yet. Wait for the host to start a song.");
  if (event.status === "ended") throw new PublicError("This party has ended, so reactions are closed.");
  const d1 = getD1();
  const current = await d1.prepare("SELECT id, participant_id, provider_track_id, title, artist, duration, color, shielded, shield_absorbed FROM submissions WHERE id = ?")
    .bind(event.current_submission_id).first<SubmissionRow>();
  if (!current) throw new PublicError("Nothing is playing yet. Wait for the host to start a song.");
  if (current.participant_id === participantId) throw new PublicError("You cannot vote on your own song—but everyone else still can.");
  const member = await d1.prepare("SELECT id, boost_used FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string; boost_used: number }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  const useBoost = boost && kind === "up";
  if (useBoost && member.boost_used) throw new PublicError("Your double cheer is already spent. Regular cheers still count.");

  const existing = await d1.prepare("SELECT id, kind FROM reactions WHERE submission_id = ? AND participant_id = ?")
    .bind(current.id, participantId).first<{ id: string; kind: string }>();
  if (existing) throw new PublicError("Your reaction is already locked for this song. One human, one vote—no remixes.", 409);
  const shieldAbsorbs = kind === "down" && Boolean(current.shielded) && !current.shield_absorbed;
  const newEffect = kind === "up" ? (useBoost ? BOOST_CHEER_POINTS : BASE_REACTION_POINTS) : shieldAbsorbs ? 0 : -BASE_REACTION_POINTS;
  const now = new Date().toISOString();
  try {
    const statements = [
      d1.prepare("INSERT INTO reactions (id, event_id, submission_id, participant_id, kind, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), event.id, current.id, participantId, kind, useBoost ? 2 : 1, now),
      d1.prepare("UPDATE participants SET score = score + ? WHERE id = ?").bind(newEffect, current.participant_id),
      d1.prepare("INSERT INTO activity_events (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(`activity-${crypto.randomUUID()}`, event.id, current.id, participantId, kind, now),
    ];
    if (useBoost) statements.push(d1.prepare("UPDATE participants SET boost_used = 1 WHERE id = ?").bind(participantId));
    if (shieldAbsorbs) statements.push(d1.prepare("UPDATE submissions SET shield_absorbed = 1 WHERE id = ?").bind(current.id));
    await d1.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new PublicError("Your reaction is already locked for this song. One human, one vote—no remixes.", 409);
    }
    throw error;
  }
  const booCount = await d1.prepare("SELECT COUNT(*) AS count FROM reactions WHERE submission_id = ? AND kind = 'down'")
    .bind(current.id).first<{ count: number }>();
  const skipped = (booCount?.count ?? 0) >= boosNeededToSkip(Boolean(current.shielded));
  if (skipped) await advanceCurrentTrack(event, "skipped", "boos", await estimateSkipPercent(event, current));
  return { skipped, shieldAbsorbed: shieldAbsorbs, boosted: useBoost };
}

export async function shieldCurrentSong(code: string, participantId: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (event.status !== "live" || !event.current_submission_id) throw new PublicError("A shield only works on your song while it is playing.");
  const d1 = getD1();
  const current = await d1.prepare("SELECT id, participant_id, shielded FROM submissions WHERE id = ?")
    .bind(event.current_submission_id).first<{ id: string; participant_id: string; shielded: number }>();
  if (!current || current.participant_id !== participantId) throw new PublicError("You can only shield your own song, and only while it is playing.");
  if (current.shielded) throw new PublicError("This song is already shielded.");
  const member = await d1.prepare("SELECT shield_used FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ shield_used: number }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  if (member.shield_used) throw new PublicError("Your shield is already spent. One per party, no refunds.");
  await d1.batch([
    d1.prepare("UPDATE participants SET shield_used = 1 WHERE id = ?").bind(participantId),
    d1.prepare("UPDATE submissions SET shielded = 1 WHERE id = ?").bind(current.id),
  ]);
}

export async function recordFlair(code: string, participantId: string, emoji: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (event.status !== "live") throw new PublicError("Emoji flair unlocks when the party is live.");
  if (!isFlairEmoji(emoji)) throw new PublicError("Pick one of the party emojis.");
  const d1 = getD1();
  const member = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  await d1.prepare("INSERT INTO flair_events (id, event_id, submission_id, participant_id, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(`flair-${crypto.randomUUID()}`, event.id, event.current_submission_id, participantId, emoji, new Date().toISOString()).run();
}

export async function guessSubmitter(code: string, participantId: string, guessedPublicId: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (event.status !== "live" || !event.current_submission_id) throw new PublicError("Guessing opens while a song is playing.");
  const d1 = getD1();
  const current = await d1.prepare("SELECT id, participant_id FROM submissions WHERE id = ?")
    .bind(event.current_submission_id).first<{ id: string; participant_id: string }>();
  if (!current) throw new PublicError("Guessing opens while a song is playing.");
  if (current.participant_id === participantId) throw new PublicError("You know exactly who picked this one.");
  const member = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  const guessed = await d1.prepare("SELECT id FROM participants WHERE public_id = ? AND event_id = ?").bind(guessedPublicId, event.id).first<{ id: string }>();
  if (!guessed) throw new PublicError("Pick a human who is in this room.");
  if (guessed.id === participantId) throw new PublicError("Guessing yourself is bold, but it is not allowed.");
  await d1.prepare(`INSERT INTO song_guesses (id, event_id, submission_id, participant_id, guessed_participant_id, correct, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(submission_id, participant_id) DO UPDATE SET guessed_participant_id = excluded.guessed_participant_id, created_at = excluded.created_at
    WHERE song_guesses.correct IS NULL`)
    .bind(`guess-${crypto.randomUUID()}`, event.id, current.id, participantId, guessed.id, new Date().toISOString()).run();
}

export async function setRevealPickers(code: string, hostKey: string, reveal: boolean) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser holding the aux cable.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended, so its settings are frozen.");
  await getD1().prepare("UPDATE events SET reveal_pickers = ? WHERE id = ?").bind(reveal ? 1 : 0, event.id).run();
}

export async function setRoundTheme(code: string, hostKey: string, themeInput: string) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser holding the aux cable.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended, so its theme is frozen.");
  const theme = normalizeTheme(themeInput);
  await getD1().prepare("UPDATE events SET theme = ? WHERE id = ?").bind(theme || null, event.id).run();
}

export function assertMusicSource(roomSource: MusicSource, linkSource: MusicSource) {
  if (roomSource === linkSource) return;
  throw new PublicError(roomSource === "youtube"
    ? "This room plays YouTube only. Paste a YouTube video link instead."
    : "This room plays Spotify only. Paste a Spotify track link instead.");
}

export async function submitTrack(code: string, participantId: string, track: TrackInput) {
  const normalizedTrack = parseTrackReference(track.id);
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (event.status === "ended") throw new PublicError("This party has ended, so no more songs can be added.");
  assertMusicSource(event.music_source ?? "spotify", normalizedTrack.source);
  const d1 = getD1();
  const member = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  const pending = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND participant_id = ? AND status = 'pending'")
    .bind(event.id, participantId).first<{ count: number }>();
  if ((pending?.count ?? 0) >= MAX_PENDING_TRACKS_PER_PERSON) throw new PublicError(`You already have ${MAX_PENDING_TRACKS_PER_PERSON} secret picks waiting. Wait for one to play before adding another.`);
  if (!track.title || !track.artist) throw new PublicError("The music service did not return enough song information. Copy the link again.");
  const duplicate = await d1.prepare("SELECT id FROM submissions WHERE event_id = ? AND provider_track_id = ? LIMIT 1")
    .bind(event.id, normalizedTrack.uri).first<{ id: string }>();
  if (duplicate) throw new PublicError("That song is already part of this party. Pick another track and keep the queue mysterious.", 409);

  const submissionId = crypto.randomUUID();
  const status = event.status === "lobby" || event.current_submission_id ? "pending" : "playing";
  const now = new Date().toISOString();
  try {
    const statements = [
      d1.prepare("INSERT INTO submissions (id, event_id, participant_id, provider_track_id, title, artist, duration, color, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(submissionId, event.id, participantId, normalizedTrack.uri, track.title.slice(0, 160), track.artist.slice(0, 160), track.duration.slice(0, 12), track.color, status, now),
    ];
    if (event.status !== "lobby" && !event.current_submission_id) {
      statements.push(d1.prepare("UPDATE events SET current_submission_id = ? WHERE id = ?").bind(submissionId, event.id));
      statements.push(d1.prepare("INSERT INTO activity_events (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, NULL, 'song_start', ?)")
        .bind(`activity-${crypto.randomUUID()}`, event.id, submissionId, now));
    }
    await d1.batch(statements);
    if (event.status === "lobby") {
      const refreshed = await loadEvent(code);
      if (refreshed?.status === "live" && !refreshed.current_submission_id) await advanceCurrentTrack(refreshed, "played");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new PublicError("That song is already part of this party. Pick another track and keep the queue mysterious.", 409);
    throw error;
  }
}

export async function removePendingTrack(code: string, participantId: string, submissionId: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (event.status === "ended") throw new PublicError("This party has ended, so its queue is frozen.");
  if (!submissionId || submissionId.length > 80) throw new PublicError("That song could not be identified. Refresh the page and try again.");
  const d1 = getD1();
  const result = await d1.prepare(`UPDATE submissions SET status = 'removed'
    WHERE id = ? AND event_id = ? AND participant_id = ? AND status = 'pending'`)
    .bind(submissionId, event.id, participantId).run();
  if (!result.meta.changes) throw new PublicError("That song is no longer waiting in your queue. Refresh to see the latest mix.", 409);
}

export async function setParticipantAvatar(code: string, participantId: string, emoji: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (!isAvatarEmoji(emoji)) throw new PublicError("That party face wandered outside the emoji booth. Pick one from the list.");
  const result = await getD1().prepare("UPDATE participants SET initials = ? WHERE id = ? AND event_id = ?")
    .bind(emoji, participantId, event.id).run();
  if (!result.meta.changes) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
}

export async function setParticipantName(code: string, participantId: string, displayName: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  const name = normalizeDisplayName(displayName);
  if (name.length < 2 || name.length > 24) throw new PublicError("Use a party name between 2 and 24 characters.");
  const participant = await getD1().prepare("SELECT initials FROM participants WHERE id = ? AND event_id = ?")
    .bind(participantId, event.id).first<{ initials: string }>();
  if (!participant) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  const initials = isAvatarEmoji(participant.initials) ? participant.initials : profileForName(name).initials;
  await getD1().prepare("UPDATE participants SET display_name = ?, initials = ? WHERE id = ? AND event_id = ?")
    .bind(name, initials, participantId, event.id).run();
}

export async function assertPartyParticipant(code: string, participantId: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  const member = await getD1().prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
}

export async function joinParty(code: string, participantId: string, displayName: string, passcodeInput: string) {
  const event = await loadEvent(code);
  if (!event) throw new PublicError("Room not found. Check the room code and passcode, then try again.", 404);
  if (event.status === "ended") throw new PublicError("This party has already ended, so new guests cannot join.");
  if (event.join_passcode_hash && (!event.join_passcode_salt || !await verifyRoomPasscode(passcodeInput, event.join_passcode_hash, event.join_passcode_salt))) throw new PublicError("That room code and passcode do not match. Ask the host for the latest invite.", 401);
  const name = normalizeDisplayName(displayName);
  if (name.length < 2 || name.length > 24) throw new PublicError("Use a party name between 2 and 24 characters.");
  if (!/^p-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participantId)) throw new PublicError("We could not prepare this browser to join. Refresh the page and try again.");
  const profile = profileForName(name);
  const publicId = `person-${crypto.randomUUID()}`;
  const result = await getD1().prepare(`INSERT OR IGNORE INTO participants (id, public_id, event_id, display_name, initials, color, score, created_at)
    SELECT ?, ?, ?, ?, ?, ?, 30, ?
    WHERE (SELECT COUNT(*) FROM participants WHERE event_id = ?) < ?`)
    .bind(participantId, publicId, event.id, name, profile.initials, profile.color, new Date().toISOString(), event.id, MAX_PARTICIPANTS_PER_ROOM).run();
  if (!result.meta.changes) throw new PublicError(`This room is full at ${MAX_PARTICIPANTS_PER_ROOM} people. Ask the host to start another room.`);
}

export async function hostControl(code: string, hostKey: string, action: "start" | "skip" | "advance" | "end") {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser that created this room.", 403);
  if (action === "start") {
    if (event.status !== "lobby") throw new PublicError("This party has already started.");
    await getD1().prepare("UPDATE events SET status = 'live' WHERE id = ?").bind(event.id).run();
    await advanceCurrentTrack(event, "played");
    return;
  }
  if (action === "end") {
    await getD1().prepare("UPDATE events SET status = 'ended' WHERE id = ?").bind(event.id).run();
    return;
  }
  if (event.status === "lobby") throw new PublicError("Start the party before controlling playback.");
  if (!event.current_submission_id) throw new PublicError("Nothing is playing yet. Add a song first.");
  await advanceCurrentTrack(event, action === "advance" ? "played" : "skipped", action === "skip" ? "host" : null);
}

export async function recordBooSkipProgress(code: string, hostKey: string, providerTrackId: string, percentInput: number) {
  const event = await loadEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser that created this room.", 403);
  const trackId = parseTrackReference(providerTrackId).uri;
  if (!Number.isFinite(percentInput)) throw new PublicError("That playback position was invalid. Refresh the host page and try again.");
  const percent = Math.max(0, Math.min(100, Math.round(percentInput)));
  await getD1().prepare(`UPDATE submissions SET skip_percent = ?
    WHERE event_id = ? AND provider_track_id = ? AND status = 'skipped' AND skip_reason = 'boos'`)
    .bind(percent, event.id, trackId).run();
}
