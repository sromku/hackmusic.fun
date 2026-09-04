import { getD1 } from ".";
import type { PartyColor, PartyRecapPage, RecapInsights, RecapPlayer, RecapRelation, RecapSong, RecapSongMention } from "../lib/party-contract";
import { boosNeededToSkip } from "../lib/party-fun";
import { durationSeconds, trackWebUrl } from "../lib/party-format";
import { PublicError } from "../lib/public-error";
import { computePartyAwards } from "./party-awards";
import { loadEvent } from "./party-model";

type PersonRow = { id: string; public_id: string; display_name: string; initials: string; color: string; score: number; created_at: string };
type PairRow = { from_id: string; to_id: string; kind: "up" | "down"; total: number };
type SongRow = {
  id: string; provider_track_id: string; title: string; artist: string; duration: string; color: string;
  status: "played" | "skipped" | "playing"; skip_reason: "boos" | "host" | null; skip_percent: number | null;
  picker_id: string; started_at: string | null; cheers: number; boos: number; shielded: number;
};
type ReactionRow = { participant_id: string; submission_id: string; kind: "up" | "down"; weight: number; created_at: string };
type GuessRow = { participant_id: string; submission_id: string; correct: number | null };

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
  const [peopleResult, pairResult, songResult, guessTotals, reactionResult, guessResult] = await Promise.all([
    d1.prepare("SELECT id, public_id, display_name, initials, color, score, created_at FROM participants WHERE event_id = ? ORDER BY score DESC, created_at ASC").bind(event.id).all<PersonRow>(),
    d1.prepare(`SELECT r.participant_id AS from_id, s.participant_id AS to_id, r.kind, SUM(r.weight) AS total
      FROM reactions r JOIN submissions s ON s.id = r.submission_id
      WHERE r.event_id = ? GROUP BY r.participant_id, s.participant_id, r.kind`).bind(event.id).all<PairRow>(),
    d1.prepare(`SELECT s.id, s.provider_track_id, s.title, s.artist, s.duration, s.color, s.status, s.skip_reason, s.skip_percent, s.shielded,
        s.participant_id AS picker_id,
        (SELECT MIN(a.created_at) FROM activity_events a WHERE a.submission_id = s.id AND a.kind = 'song_start') AS started_at,
        (SELECT COALESCE(SUM(r.weight), 0) FROM reactions r WHERE r.submission_id = s.id AND r.kind = 'up') AS cheers,
        (SELECT COUNT(*) FROM reactions r WHERE r.submission_id = s.id AND r.kind = 'down') AS boos
      FROM submissions s
      WHERE s.event_id = ? AND s.status IN ('played', 'skipped', 'playing')
      ORDER BY started_at ASC, s.submitted_at ASC`).bind(event.id).all<SongRow>(),
    d1.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct FROM song_guesses WHERE event_id = ?").bind(event.id).first<{ total: number; correct: number }>(),
    d1.prepare("SELECT participant_id, submission_id, kind, weight, created_at FROM reactions WHERE event_id = ? ORDER BY created_at ASC").bind(event.id).all<ReactionRow>(),
    d1.prepare("SELECT participant_id, submission_id, correct FROM song_guesses WHERE event_id = ?").bind(event.id).all<GuessRow>(),
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

  const songRows = songResult.results as SongRow[];
  const reactions = reactionResult.results as ReactionRow[];
  const guesses = guessResult.results as GuessRow[];
  const songById = new Map<string, SongRow>(songRows.map((song) => [song.id, song]));
  const reactionsBySong = new Map<string, ReactionRow[]>();
  for (const reaction of reactions) {
    const list = reactionsBySong.get(reaction.submission_id) ?? [];
    list.push(reaction);
    reactionsBySong.set(reaction.submission_id, list);
  }

  const players: RecapPlayer[] = people.map((person, index) => {
    const gave = given.get(person.id) ?? { up: new Map(), down: new Map() };
    const myPicks = songRows.filter((song) => song.picker_id === person.id && (Number(song.cheers) || Number(song.boos)));
    const myGuesses = guesses.filter((guess) => guess.participant_id === person.id);
    const pointsGiven = reactions.filter((reaction) => reaction.participant_id === person.id)
      .reduce((total, reaction) => total + (reaction.kind === "up" ? 3 * (Number(reaction.weight) || 1) : -3), 0);
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
      consistency: { wins: myPicks.filter((song) => Number(song.cheers) > Number(song.boos)).length, picks: myPicks.length },
      guessesMade: myGuesses.length,
      guessesCorrect: myGuesses.filter((guess) => guess.correct === 1).length,
      pointsGiven,
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
  const mention = (song: SongRow): RecapSongMention => {
    const picker = byId.get(song.picker_id);
    return { queueId: song.id, title: song.title, pickerName: picker ? (picker.id === viewerId ? "You" : picker.display_name) : "A departed human", pickerAvatar: picker?.initials ?? "?", pickerColor: (picker?.color ?? "mint") as PartyColor };
  };
  const insights = buildInsights({ songRows, reactions, guesses, people, byId, players, reactionsBySong, songById, mention, viewerId, eventCreatedAt: event.created_at });
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
    insights,
  };
}

type InsightInput = {
  songRows: SongRow[];
  reactions: ReactionRow[];
  guesses: GuessRow[];
  people: PersonRow[];
  byId: Map<string, PersonRow>;
  players: RecapPlayer[];
  reactionsBySong: Map<string, ReactionRow[]>;
  songById: Map<string, SongRow>;
  mention: (song: SongRow) => RecapSongMention;
  viewerId: string;
  eventCreatedAt: string;
};

const PEAK_WINDOW_MS = 30 * 60 * 1000;

function playedSeconds(song: SongRow) {
  const total = durationSeconds(song.duration);
  if (!total) return null;
  if (song.status === "played" || song.status === "playing") return total;
  if (song.skip_reason === "boos" && song.skip_percent !== null) return Math.round(total * song.skip_percent / 100);
  return null;
}

function buildInsights(input: InsightInput): RecapInsights {
  const { songRows, reactions, guesses, people, byId, players, reactionsBySong, songById, mention, viewerId } = input;
  const time = (value: string | null | undefined) => { const parsed = value ? new Date(value).getTime() : Number.NaN; return Number.isFinite(parsed) ? parsed : null; };
  const relationFor = (id: string, count: number) => relation(byId.get(id), Math.max(count, 1), viewerId);

  // Tempo.
  const starts = songRows.map((song) => time(song.started_at)).filter((value): value is number => value !== null);
  const reactionTimes = reactions.map((reaction) => time(reaction.created_at)).filter((value): value is number => value !== null);
  const startedAt = starts.length ? Math.min(...starts) : null;
  const lastMoment = Math.max(...starts, ...reactionTimes, Number.NEGATIVE_INFINITY);
  const endedAt = Number.isFinite(lastMoment) ? lastMoment : null;
  const minutes = startedAt !== null && endedAt !== null ? Math.max(1, Math.round((endedAt - startedAt) / 60_000)) : null;
  const reactionPaceSeconds = minutes && reactionTimes.length > 1 ? Math.round((endedAt! - startedAt!) / 1_000 / reactionTimes.length) : null;
  let peakWindow: RecapInsights["peakWindow"] = null;
  const sortedTimes = [...reactionTimes].sort((left, right) => left - right);
  for (let index = 0; index < sortedTimes.length; index += 1) {
    const start = sortedTimes[index];
    let end = index;
    while (end + 1 < sortedTimes.length && sortedTimes[end + 1] - start <= PEAK_WINDOW_MS) end += 1;
    const count = end - index + 1;
    if (!peakWindow || count > peakWindow.reactions) peakWindow = { start: new Date(start).toISOString(), end: new Date(start + PEAK_WINDOW_MS).toISOString(), reactions: count };
  }

  // Fastest boo.
  let fastestBoo: RecapInsights["fastestBoo"] = null;
  for (const reaction of reactions) {
    if (reaction.kind !== "down") continue;
    const song = songById.get(reaction.submission_id);
    const started = time(song?.started_at);
    const at = time(reaction.created_at);
    if (!song || started === null || at === null || at < started) continue;
    const seconds = Math.round((at - started) / 1_000);
    const by = relationFor(reaction.participant_id, 1);
    if (by && (!fastestBoo || seconds < fastestBoo.seconds)) fastestBoo = { song: mention(song), by, seconds };
  }

  // Songs.
  const survivorRow = [...songRows].filter((song) => (song.status === "played" || song.status === "playing") && Number(song.boos) > 0).sort((left, right) => Number(right.boos) - Number(left.boos))[0];
  const lives = songRows.map((song) => ({ song, seconds: playedSeconds(song) })).filter((entry): entry is { song: SongRow; seconds: number } => entry.seconds !== null);
  const longest = [...lives].sort((left, right) => right.seconds - left.seconds)[0];
  const shortest = [...lives].filter((entry) => entry.song.skip_reason === "boos" && entry.song.skip_percent !== null).sort((left, right) => left.seconds - right.seconds)[0];
  const artistCounts = new Map<string, { songs: number; booedOff: number }>();
  for (const song of songRows) {
    const key = song.artist.trim();
    if (!key) continue;
    const entry = artistCounts.get(key) ?? { songs: 0, booedOff: 0 };
    entry.songs += 1;
    if (song.skip_reason === "boos") entry.booedOff += 1;
    artistCounts.set(key, entry);
  }
  const topArtistEntry = [...artistCounts.entries()].sort((left, right) => right[1].songs - left[1].songs)[0];
  const silentSongs = songRows.filter((song) => !(reactionsBySong.get(song.id)?.length)).length;
  const unanimousSongs = songRows.filter((song) => {
    const voters = new Set((reactionsBySong.get(song.id) ?? []).map((reaction) => reaction.participant_id));
    return people.length > 1 && voters.size >= people.length - 1;
  }).length;

  // People: agreement pairs, contrarian, ghosts, boo economy.
  const agreement = new Map<string, number>();
  const disagreements = new Map<string, number>();
  for (const [, list] of reactionsBySong) {
    const ups = list.filter((reaction) => reaction.kind === "up").length;
    const downs = list.length - ups;
    const majority = ups === downs ? null : ups > downs ? "up" : "down";
    for (const reaction of list) {
      if (majority && reaction.kind !== majority) disagreements.set(reaction.participant_id, (disagreements.get(reaction.participant_id) ?? 0) + 1);
    }
    for (let index = 0; index < list.length; index += 1) {
      for (let other = index + 1; other < list.length; other += 1) {
        if (list[index].kind !== list[other].kind) continue;
        const key = [list[index].participant_id, list[other].participant_id].sort().join("|");
        agreement.set(key, (agreement.get(key) ?? 0) + 1);
      }
    }
  }
  let soulmates: RecapInsights["soulmates"] = null;
  let bestAgreement = 0;
  agreement.forEach((count, key) => {
    if (count <= bestAgreement) return;
    const [left, right] = key.split("|");
    const leftRelation = relationFor(left, count);
    const rightRelation = relationFor(right, count);
    if (leftRelation && rightRelation) { bestAgreement = count; soulmates = { left: leftRelation, right: rightRelation, count }; }
  });
  const contrarianTop = topOf(disagreements);
  const contrarian = contrarianTop.count >= 2 ? relationFor(contrarianTop.id, contrarianTop.count) : null;
  const ghosts = people
    .filter((person) => !songRows.some((song) => song.picker_id === person.id) && !reactions.some((reaction) => reaction.participant_id === person.id))
    .map((person) => relation(person, 1, viewerId))
    .filter((entry): entry is RecapRelation => Boolean(entry))
    .map((entry) => ({ ...entry, count: 0 }));
  const economy = [...players].filter((player) => player.cheersGiven + player.boosGiven > 0);
  const villainPlayer = [...economy].sort((left, right) => left.pointsGiven - right.pointsGiven)[0];
  const saintPlayer = [...economy].sort((left, right) => right.pointsGiven - left.pointsGiven)[0];
  const asRelation = (player: RecapPlayer | undefined, count: number): RecapRelation | null => player ? { id: player.id, name: player.name, avatar: player.avatar, color: player.color, count } : null;
  const villain = villainPlayer && villainPlayer.pointsGiven < 0 ? asRelation(villainPlayer, villainPlayer.pointsGiven) : null;
  const saint = saintPlayer && saintPlayer.pointsGiven > 0 ? asRelation(saintPlayer, saintPlayer.pointsGiven) : null;

  // Guessing.
  const guessesByPicker = new Map<string, { guesses: number; correct: number }>();
  for (const guess of guesses) {
    const song = songById.get(guess.submission_id);
    if (!song) continue;
    const entry = guessesByPicker.get(song.picker_id) ?? { guesses: 0, correct: 0 };
    entry.guesses += 1;
    if (guess.correct === 1) entry.correct += 1;
    guessesByPicker.set(song.picker_id, entry);
  }
  const hardestEntry = [...guessesByPicker.entries()].filter(([, entry]) => entry.guesses >= 2).sort((left, right) => (left[1].correct / left[1].guesses) - (right[1].correct / right[1].guesses))[0];
  const hardestToGuess = hardestEntry ? (() => { const player = relationFor(hardestEntry[0], hardestEntry[1].guesses); return player ? { player, guesses: hardestEntry[1].guesses, correct: hardestEntry[1].correct } : null; })() : null;
  const detective = [...players].filter((player) => player.guessesCorrect > 0).sort((left, right) => right.guessesCorrect - left.guessesCorrect)[0];
  const bestDetective = asRelation(detective, detective?.guessesCorrect ?? 0);

  // Drama.
  const shields = songRows.filter((song) => song.shielded).map((song) => {
    const boos = Number(song.boos) || 0;
    const outcome: "saved" | "held" | "wasted" = boos === 0 ? "wasted" : boos >= boosNeededToSkip(false) && (song.status === "played" || song.status === "playing") ? "saved" : "held";
    return { song: mention(song), boos, outcome };
  });
  const boosts = reactions.filter((reaction) => (Number(reaction.weight) || 1) > 1).map((reaction) => {
    const song = songById.get(reaction.submission_id);
    const by = relationFor(reaction.participant_id, 1);
    return song && by ? { song: mention(song), by, survived: song.status === "played" || song.status === "playing" } : null;
  }).filter((entry): entry is { song: RecapSongMention; by: RecapRelation; survived: boolean } => Boolean(entry));
  const clutch = songRows.filter((song) => (song.status === "played" || song.status === "playing") && Number(song.boos) === boosNeededToSkip(Boolean(song.shielded)) - 1).map(mention);
  const totalReactions = reactions.length;
  const cheerShare = totalReactions ? Math.round((reactions.filter((reaction) => reaction.kind === "up").length / totalReactions) * 100) : null;

  return {
    startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
    endedAt: endedAt === null ? null : new Date(endedAt).toISOString(),
    minutes,
    reactionPaceSeconds,
    peakWindow,
    fastestBoo,
    survivor: survivorRow ? { song: mention(survivorRow), boos: Number(survivorRow.boos) || 0 } : null,
    longestLife: longest ? { song: mention(longest.song), seconds: longest.seconds } : null,
    shortestLife: shortest ? { song: mention(shortest.song), seconds: shortest.seconds, percent: shortest.song.skip_percent ?? 0 } : null,
    topArtist: topArtistEntry ? { artist: topArtistEntry[0], songs: topArtistEntry[1].songs, booedOff: topArtistEntry[1].booedOff } : null,
    silentSongs,
    unanimousSongs,
    soulmates,
    contrarian,
    ghosts,
    villain,
    saint,
    hardestToGuess,
    bestDetective,
    shields,
    boosts,
    clutch,
    cheerShare,
  };
}
