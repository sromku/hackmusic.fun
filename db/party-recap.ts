import { getD1 } from ".";
import type { PartyColor, PartyRecapPage, RecapPlayer, RecapRelation, RecapSong } from "../lib/party-contract";
import { trackWebUrl } from "../lib/party-format";
import { PublicError } from "../lib/public-error";
import { computePartyAwards } from "./party-awards";
import { loadEvent } from "./party-model";

type PersonRow = { id: string; public_id: string; display_name: string; initials: string; color: string; score: number; created_at: string };
type PairRow = { from_id: string; to_id: string; kind: "up" | "down"; total: number };
type SongRow = {
  id: string; provider_track_id: string; title: string; artist: string; duration: string; color: string;
  status: "played" | "skipped" | "playing"; skip_reason: "boos" | "host" | null; skip_percent: number | null;
  picker_id: string; started_at: string | null; cheers: number; boos: number;
};

function relation(person: PersonRow | undefined, count: number, viewerId: string): RecapRelation | null {
  if (!person || !count) return null;
  return { id: person.public_id, name: person.id === viewerId ? "You" : person.display_name, avatar: person.initials, color: person.color as PartyColor, count };
}

function topOf(counts: Map<string, number>) {
  let bestId = "";
  let best = 0;
  counts.forEach((count, id) => { if (count > best) { best = count; bestId = id; } });
  return { id: bestId, count: best };
}

/** The Hall of Fame: everything the room did, unmasked, for members of an ended party. */
export async function readPartyRecap(codeInput: string, viewerId: string, hostKey = ""): Promise<PartyRecapPage> {
  const event = await loadEvent(codeInput);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (event.status !== "ended") throw new PublicError("The Hall of Fame opens when the party ends. Until then, the scores stay under wraps.", 400);
  const d1 = getD1();
  const isHost = Boolean(hostKey) && hostKey === event.host_pin;
  const [peopleResult, pairResult, songResult, guessTotals] = await Promise.all([
    d1.prepare("SELECT id, public_id, display_name, initials, color, score, created_at FROM participants WHERE event_id = ? ORDER BY score DESC, created_at ASC").bind(event.id).all<PersonRow>(),
    d1.prepare(`SELECT r.participant_id AS from_id, s.participant_id AS to_id, r.kind, SUM(r.weight) AS total
      FROM reactions r JOIN submissions s ON s.id = r.submission_id
      WHERE r.event_id = ? GROUP BY r.participant_id, s.participant_id, r.kind`).bind(event.id).all<PairRow>(),
    d1.prepare(`SELECT s.id, s.provider_track_id, s.title, s.artist, s.duration, s.color, s.status, s.skip_reason, s.skip_percent,
        s.participant_id AS picker_id,
        (SELECT MIN(a.created_at) FROM activity_events a WHERE a.submission_id = s.id AND a.kind = 'song_start') AS started_at,
        (SELECT COALESCE(SUM(r.weight), 0) FROM reactions r WHERE r.submission_id = s.id AND r.kind = 'up') AS cheers,
        (SELECT COUNT(*) FROM reactions r WHERE r.submission_id = s.id AND r.kind = 'down') AS boos
      FROM submissions s
      WHERE s.event_id = ? AND s.status IN ('played', 'skipped', 'playing')
      ORDER BY started_at ASC, s.submitted_at ASC`).bind(event.id).all<SongRow>(),
    d1.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct FROM song_guesses WHERE event_id = ?").bind(event.id).first<{ total: number; correct: number }>(),
  ]);
  const people: PersonRow[] = peopleResult.results;
  const viewer = people.find((person) => person.id === viewerId);
  if (!viewer && !isHost) throw new PublicError("The Hall of Fame is for people who were at the party. Join the room from the invite to see it.", 401);
  const byId = new Map<string, PersonRow>(people.map((person) => [person.id, person]));

  const given = new Map<string, { up: Map<string, number>; down: Map<string, number> }>();
  const received = new Map<string, { up: Map<string, number>; down: Map<string, number> }>();
  const bucket = (store: Map<string, { up: Map<string, number>; down: Map<string, number> }>, id: string) => {
    let entry = store.get(id);
    if (!entry) { entry = { up: new Map(), down: new Map() }; store.set(id, entry); }
    return entry;
  };
  const pairBoos = new Map<string, number>();
  const pairCheers = new Map<string, number>();
  for (const pair of pairResult.results as PairRow[]) {
    const total = Number(pair.total) || 0;
    bucket(given, pair.from_id)[pair.kind].set(pair.to_id, (bucket(given, pair.from_id)[pair.kind].get(pair.to_id) ?? 0) + total);
    bucket(received, pair.to_id)[pair.kind].set(pair.from_id, (bucket(received, pair.to_id)[pair.kind].get(pair.from_id) ?? 0) + total);
    const key = [pair.from_id, pair.to_id].sort().join("|");
    const store = pair.kind === "down" ? pairBoos : pairCheers;
    store.set(key, (store.get(key) ?? 0) + total);
  }

  const players: RecapPlayer[] = people.map((person, index) => {
    const gave = given.get(person.id) ?? { up: new Map(), down: new Map() };
    const got = received.get(person.id) ?? { up: new Map(), down: new Map() };
    const fan = topOf(got.up);
    const critic = topOf(got.down);
    const favorite = topOf(gave.up);
    const nemesis = topOf(gave.down);
    const sum = (map: Map<string, number>) => [...map.values()].reduce((total, value) => total + value, 0);
    return {
      id: person.public_id,
      name: person.id === viewerId ? "You" : person.display_name,
      displayName: person.display_name,
      avatar: person.initials,
      color: person.color as PartyColor,
      score: person.score,
      rank: index + 1,
      songsPicked: (songResult.results as SongRow[]).filter((song) => song.picker_id === person.id).length,
      cheersReceived: sum(got.up),
      boosReceived: sum(got.down),
      cheersGiven: sum(gave.up),
      boosGiven: sum(gave.down),
      biggestFan: relation(byId.get(fan.id), fan.count, viewerId),
      harshestCritic: relation(byId.get(critic.id), critic.count, viewerId),
      favoriteTarget: relation(byId.get(favorite.id), favorite.count, viewerId),
      nemesis: relation(byId.get(nemesis.id), nemesis.count, viewerId),
    };
  });

  const pairSummary = (store: Map<string, number>) => {
    let bestKey = "";
    let best = 0;
    store.forEach((count, key) => { if (count > best) { best = count; bestKey = key; } });
    if (!bestKey) return null;
    const [left, right] = bestKey.split("|").map((id) => byId.get(id));
    if (!left || !right) return null;
    return { left: relation(left, best, viewerId)!, right: relation(right, best, viewerId)!, count: best };
  };

  const songs: RecapSong[] = (songResult.results as SongRow[]).map((song, index) => {
    const picker = byId.get(song.picker_id);
    return {
      order: index + 1,
      queueId: song.id,
      id: song.provider_track_id,
      title: song.title,
      artist: song.artist,
      duration: song.duration,
      color: song.color as PartyColor,
      // The song on the speaker when the host ended the party counts as played: it was the closing number.
      status: song.status === "playing" ? "played" : song.status,
      skipReason: song.skip_reason,
      skipPercent: song.skip_percent,
      cheers: Number(song.cheers) || 0,
      boos: Number(song.boos) || 0,
      pickerId: picker?.public_id ?? "",
      pickerName: picker ? (picker.id === viewerId ? "You" : picker.display_name) : "A departed human",
      pickerAvatar: picker?.initials ?? "?",
      pickerColor: (picker?.color ?? "mint") as PartyColor,
      webUrl: trackWebUrl(song.provider_track_id),
      startedAt: song.started_at,
    };
  });

  const cheers = players.reduce((total, player) => total + player.cheersGiven, 0);
  const boos = players.reduce((total, player) => total + player.boosGiven, 0);
  return {
    code: event.code,
    title: event.title,
    musicSource: event.music_source ?? "spotify",
    theme: event.theme ?? null,
    viewerId: viewer?.public_id ?? null,
    stats: {
      players: players.length,
      songsPlayed: songs.length,
      songsBooedOff: songs.filter((song) => song.skipReason === "boos").length,
      cheers,
      boos,
      guesses: guessTotals?.total ?? 0,
      correctGuesses: Number(guessTotals?.correct) || 0,
    },
    players,
    songs,
    awards: await computePartyAwards(event.id, viewerId),
    rivalry: pairSummary(pairBoos),
    bromance: pairSummary(pairCheers),
  };
}
