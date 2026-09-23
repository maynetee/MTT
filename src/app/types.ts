export type TournamentStatus = "setup" | "running" | "finished";
export type PlayerStatus = "active" | "eliminated";
export type ClockState = "running" | "paused";

export interface Tournament {
  id: number;
  name: string;
  tablesCount: number;
  seatsPerTable: number;
  itmCount: number;
  lateRegEnabled: boolean;
  lateRegEndLevel: number | null;
  lateRegEndTimeSeconds: number | null;
  status: TournamentStatus;
  currentLevelIndex: number;
  clockState: ClockState;
  clockRemainingSeconds: number;
  createdAt: number;
}

export interface Player {
  id: number;
  tournamentId: number;
  name: string;
  status: PlayerStatus;
  registeredAt: number;
  eliminatedAt: number | null;
}

export interface Table {
  id: number;
  tournamentId: number;
  tableNo: number;
  isClosed: boolean;
}

export interface Seat {
  id: number;
  tableId: number;
  seatNo: number;
  playerId: number | null;
}

export interface Level {
  id: number;
  tournamentId: number;
  index: number;
  durationSeconds: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  isBreak: boolean;
  label: string;
}

export interface TournamentConfig {
  name: string;
  tablesCount: number;
  seatsPerTable: number;
  itmCount: number;
  lateRegEnabled: boolean;
  lateRegEndLevel: number | null;
  lateRegEndTimeSeconds: number | null;
}

export interface LevelDraft {
  index: number;
  durationSeconds: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  isBreak: boolean;
  label: string;
}

export interface MoveSuggestion {
  playerId: number;
  fromSeatId: number;
  toSeatId: number;
}

export interface RankingEntry {
  /** Finishing place, or null while the player is still in play. */
  place: number | null;
  playerId: number;
  playerName: string;
  status: PlayerStatus;
  eliminatedAt: number | null;
}

export interface StateSnapshot {
  tournament: Tournament | null;
  players: Player[];
  tables: Table[];
  seats: Seat[];
  levels: Level[];
}
