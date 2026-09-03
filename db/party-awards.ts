import { getD1 } from ".";
import type { PartyAward, PartyColor } from "../lib/party-contract";
import { durationSeconds } from "../lib/party-format";

type WinnerRow = { id: string; display_name: string; initials: string; color: string; value: number };

function award(id: string, emoji: string, title: string, winner: WinnerRow | null | undefined, detail: (winner: WinnerRow) => string): PartyAward | null {
  if (!winner) return null;
  return { id, emoji, title, winnerId: winner.id, winnerName: winner.display_name, winnerAvatar: winner.initials, winnerColor: winner.color as PartyColor, detail: detail(winner) };
}

export async function computePartyAwards(eventId: string, viewerId: string): Promise<PartyAward[]> {
  const d1 = getD1();
  const [crowdPleaser, mostBooed, fastestSkip, playedSongs, silentJudge, sharpestGuesser] = await Promise.all([
    d1.prepare(`SELECT p.id, p.display_name, p.initials, p.color, SUM(r.weight) AS value
      FROM reactions r JOIN submissions s ON s.id = r.submission_id JOIN participants p ON p.id = s.participant_id
      WHERE r.event_id = ? AND r.kind = 'up' GROUP BY p.id ORDER BY value DESC, p.created_at ASC LIMIT 1`).bind(eventId).first<WinnerRow>(),
    d1.prepare(`SELECT p.id, p.display_name, p.initials, p.color, COUNT(*) AS value
      FROM reactions r JOIN submissions s ON s.id = r.submission_id JOIN participants p ON p.id = s.participant_id
      WHERE r.event_id = ? AND r.kind = 'down' GROUP BY p.id ORDER BY value DESC, p.created_at ASC LIMIT 1`).bind(eventId).first<WinnerRow>(),
    d1.prepare(`SELECT p.id, p.display_name, p.initials, p.color, s.skip_percent AS value, s.title
      FROM submissions s JOIN participants p ON p.id = s.participant_id
      WHERE s.event_id = ? AND s.status = 'skipped' AND s.skip_reason = 'boos' AND s.skip_percent IS NOT NULL
      ORDER BY s.skip_percent ASC, s.submitted_at ASC LIMIT 1`).bind(eventId).first<WinnerRow & { title: string }>(),
    d1.prepare(`SELECT p.id, p.display_name, p.initials, p.color, s.duration, s.title
      FROM submissions s JOIN participants p ON p.id = s.participant_id
      WHERE s.event_id = ? AND s.status = 'played'`).bind(eventId).all<{ id: string; display_name: string; initials: string; color: string; duration: string; title: string }>(),
    d1.prepare(`SELECT p.id, p.display_name, p.initials, p.color, 0 AS value
      FROM participants p
      WHERE p.event_id = ? AND NOT EXISTS (SELECT 1 FROM reactions r WHERE r.participant_id = p.id)
        AND EXISTS (SELECT 1 FROM submissions s WHERE s.event_id = p.event_id AND s.participant_id != p.id AND s.status IN ('played', 'skipped'))
      ORDER BY p.created_at ASC LIMIT 1`).bind(eventId).first<WinnerRow>(),
    d1.prepare(`SELECT p.id, p.display_name, p.initials, p.color, SUM(g.correct) AS value
      FROM song_guesses g JOIN participants p ON p.id = g.participant_id
      WHERE g.event_id = ? AND g.correct = 1 GROUP BY p.id ORDER BY value DESC, p.created_at ASC LIMIT 1`).bind(eventId).first<WinnerRow>(),
  ]);

  const marathon = playedSongs.results
    .map((song) => ({ ...song, value: durationSeconds(song.duration) }))
    .filter((song) => song.value > 0)
    .sort((left, right) => right.value - left.value)[0];

  const name = (winner: WinnerRow) => winner.id === viewerId ? "You" : winner.display_name;
  return [
    award("crowd-pleaser", "🙌", "Crowd Pleaser", crowdPleaser, (winner) => `${name(winner)} collected ${winner.value} cheer${winner.value === 1 ? "" : "s"} on their picks.`),
    award("most-booed", "👻", "Most Booed", mostBooed, (winner) => `${name(winner)} absorbed ${winner.value} boo${winner.value === 1 ? "" : "s"}. Iconic.`),
    award("fastest-skip", "⏱️", "Fastest Skip", fastestSkip, (winner) => `“${fastestSkip?.title}” was pulled at ${winner.value}%.`),
    award("marathon-pick", "🏃", "Marathon Pick", marathon, () => `“${marathon?.title}” ran the full ${marathon?.duration} and survived.`),
    award("silent-judge", "🧘", "Silent Judge", silentJudge, (winner) => `${name(winner)} heard everything and reacted to nothing.`),
    award("sharpest-guesser", "🕵️", "Sharpest Guesser", sharpestGuesser, (winner) => `${name(winner)} unmasked ${winner.value} mystery DJ${winner.value === 1 ? "" : "s"}.`),
  ].map((entry) => entry && entry.winnerId === viewerId ? { ...entry, winnerName: "You" } : entry).filter((entry): entry is PartyAward => Boolean(entry));
}
