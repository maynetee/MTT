import type { Player, RankingEntry, TournamentStatus } from "../types";

/**
 * Eliminated players, most recent elimination first.
 *
 * Equal `eliminatedAt` values are broken by the higher player id first. This is
 * a deterministic interim rule until the event-sourced core provides the real
 * elimination sequence.
 */
export function sortByMostRecentElimination(players: readonly Player[]): Player[] {
  return players
    .filter((player) => player.status === "eliminated")
    .sort((a, b) => (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0) || b.id - a.id);
}

function compareByName(a: Player, b: Player): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id - b.id;
}

function toEntry(player: Player, place: number | null): RankingEntry {
  return {
    place,
    playerId: player.id,
    playerName: player.name,
    status: player.status,
    eliminatedAt: player.eliminatedAt
  };
}

/**
 * Tournament ranking.
 *
 * Players still in play come first, sorted by name, without a finishing place.
 * Eliminated players follow, the most recent elimination finishing highest:
 * place = number of players still in play + rank in descending elimination order.
 * When the tournament is finished and exactly one player remains, that player is 1st.
 */
export function computeRanking(
  players: readonly Player[],
  tournamentStatus: TournamentStatus | null | undefined
): RankingEntry[] {
  const alive = players.filter((player) => player.status === "active").sort(compareByName);
  const eliminated = sortByMostRecentElimination(players);
  const winnerDecided = alive.length === 1 && tournamentStatus === "finished";

  return [
    ...alive.map((player) => toEntry(player, winnerDecided ? 1 : null)),
    ...eliminated.map((player, index) => toEntry(player, alive.length + index + 1))
  ];
}

export function formatPlace(place: number | null): string {
  return place === null ? "—" : `#${place}`;
}

export function rankingStatusLabel(entry: RankingEntry): string {
  if (entry.status === "eliminated") return "Eliminated";
  return entry.place === 1 ? "Winner" : "In play";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local date and time as `YYYY-MM-DD HH:MM`, independent of the user's locale. */
export function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** A ranking is only final once the tournament is finished; otherwise it is a dated snapshot. */
export function rankingTitle(finished: boolean, generatedAt: Date): string {
  return finished ? "Final ranking" : `Ranking — ${formatTimestamp(generatedAt)}`;
}
