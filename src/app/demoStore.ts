import type {
  Level,
  LevelDraft,
  MoveSuggestion,
  Player,
  Seat,
  StateSnapshot,
  Table,
  Tournament,
  TournamentConfig
} from "./types";

const STORAGE_KEY = "mtt_demo_state_v1";
const EVENTS_KEY = "mtt_demo_events_v1";

type EventType =
  | "JOIN_PLAYER"
  | "ELIMINATE_PLAYER"
  | "REVIVE_PLAYER"
  | "MOVE_PLAYER"
  | "CLOCK_START"
  | "CLOCK_PAUSE"
  | "CLOCK_NEXT"
  | "CLOCK_PREV"
  | "CLOCK_ADJUST"
  | "UPDATE_ITM"
  | "CLOSE_TABLE"
  | "UPDATE_LEVELS"
  | "UNDO_EVENT";

interface EventRecord {
  id: number;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: number;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function loadState(): StateSnapshot {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { tournament: null, players: [], tables: [], seats: [], levels: [] };
  }
  return JSON.parse(raw) as StateSnapshot;
}

function saveState(state: StateSnapshot) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("state_updated"));
}

function loadEvents(): EventRecord[] {
  const raw = localStorage.getItem(EVENTS_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as EventRecord[];
}

function saveEvents(events: EventRecord[]) {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

function addEvent(type: EventType, payload: Record<string, unknown>) {
  const events = loadEvents();
  const record: EventRecord = { id: events.length + 1, type, payload, createdAt: now() };
  events.unshift(record);
  saveEvents(events);
}

function isLateRegOpen(state: StateSnapshot) {
  const t = state.tournament;
  if (!t) return false;
  if (t.status === "setup") return true;
  if (!t.lateRegEnabled) return false;
  if (t.lateRegEndLevel !== null && t.currentLevelIndex > t.lateRegEndLevel) return false;
  if (t.lateRegEndTimeSeconds !== null) {
    const past = state.levels.filter((l) => l.index < t.currentLevelIndex).reduce((a, b) => a + b.durationSeconds, 0);
    const current = state.levels.find((l) => l.index === t.currentLevelIndex)?.durationSeconds ?? 0;
    const elapsed = Math.max(0, current - t.clockRemainingSeconds);
    if (past + elapsed > t.lateRegEndTimeSeconds) return false;
  }
  return true;
}

function chooseSeat(state: StateSnapshot, strategy: "random" | "balanced") {
  const openTables = state.tables.filter((t) => !t.isClosed).map((t) => t.id);
  const available = state.seats.filter((s) => s.playerId === null && openTables.includes(s.tableId));
  if (available.length === 0) return null;

  if (strategy === "balanced") {
    const counts = new Map<number, number>();
    for (const tableId of openTables) {
      const count = state.seats.filter((s) => s.tableId === tableId && s.playerId !== null).length;
      counts.set(tableId, count);
    }
    const min = Math.min(...counts.values());
    const candidateTables = Array.from(counts.entries())
      .filter(([, count]) => count === min)
      .map(([id]) => id);
    const candidates = available.filter((seat) => candidateTables.includes(seat.tableId));
    const pool = candidates.length ? candidates : available;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  return available[Math.floor(Math.random() * available.length)] ?? null;
}

function finalizeState(state: StateSnapshot) {
  saveState(state);
}

export function getStateLocal(): StateSnapshot {
  return loadState();
}

export function createTournamentLocal(config: TournamentConfig, levels: LevelDraft[]) {
  const sortedLevels = [...levels].sort((a, b) => a.index - b.index);
  const startIndex = sortedLevels[0]?.index ?? 0;
  const startDuration = sortedLevels[0]?.durationSeconds ?? 0;

  const tournament: Tournament = {
    id: 1,
    name: config.name.trim(),
    tablesCount: config.tablesCount,
    seatsPerTable: config.seatsPerTable,
    itmCount: config.itmCount,
    lateRegEnabled: config.lateRegEnabled,
    lateRegEndLevel: config.lateRegEndLevel,
    lateRegEndTimeSeconds: config.lateRegEndTimeSeconds,
    status: "setup",
    currentLevelIndex: startIndex,
    clockState: "paused",
    clockRemainingSeconds: startDuration,
    createdAt: now()
  };

  const tables: Table[] = [];
  const seats: Seat[] = [];
  let seatId = 1;
  for (let tableNo = 1; tableNo <= config.tablesCount; tableNo += 1) {
    const tableId = tableNo;
    tables.push({ id: tableId, tournamentId: 1, tableNo, isClosed: false });
    for (let seatNo = 1; seatNo <= config.seatsPerTable; seatNo += 1) {
      seats.push({ id: seatId++, tableId, seatNo, playerId: null });
    }
  }

  const levelEntities: Level[] = sortedLevels.map((level, idx) => ({
    id: idx + 1,
    tournamentId: 1,
    index: level.index,
    durationSeconds: level.durationSeconds,
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    ante: level.ante,
    isBreak: level.isBreak,
    label: level.label
  }));

  saveEvents([]);
  finalizeState({ tournament, players: [], tables, seats, levels: levelEntities });
}

export function resetTournamentLocal() {
  saveEvents([]);
  finalizeState({
    tournament: null,
    players: [],
    tables: [],
    seats: [],
    levels: []
  });
}

export function registerPlayerLocal(name: string, strategy: "random" | "balanced"): Seat {
  const state = loadState();
  if (!state.tournament) throw new Error("No tournament");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Player name is required");
  if (state.players.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("This player name already exists");
  }
  if (!isLateRegOpen(state)) throw new Error("Late registration is closed");
  const seat = chooseSeat(state, strategy);
  if (!seat) throw new Error("Tournament is full");

  const playerId = state.players.length ? Math.max(...state.players.map((p) => p.id)) + 1 : 1;
  const player: Player = {
    id: playerId,
    tournamentId: state.tournament.id,
    name: trimmed,
    status: "active",
    registeredAt: now(),
    eliminatedAt: null
  };

  const assignedSeat = { ...seat, playerId };

  const nextState: StateSnapshot = {
    ...state,
    players: [...state.players, player],
    seats: state.seats.map((s) => (s.id === seat.id ? assignedSeat : s))
  };
  addEvent("JOIN_PLAYER", { playerId, seatId: seat.id });
  finalizeState(nextState);

  return assignedSeat;
}

export function registerPlayerAtSeatLocal(name: string, tableNo: number, seatNo: number): Seat {
  const state = loadState();
  if (!state.tournament) throw new Error("No tournament");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Player name is required");
  if (state.players.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("This player name already exists");
  }

  const table = state.tables.find((t) => t.tableNo === tableNo);
  if (!table) throw new Error("Table not found");
  const seat = state.seats.find((s) => s.tableId === table.id && s.seatNo === seatNo);
  if (!seat) throw new Error("Seat not found");
  if (seat.playerId !== null) throw new Error("Seat is not available");

  const playerId = state.players.length ? Math.max(...state.players.map((p) => p.id)) + 1 : 1;
  const player: Player = {
    id: playerId,
    tournamentId: state.tournament.id,
    name: trimmed,
    status: "active",
    registeredAt: now(),
    eliminatedAt: null
  };

  const assignedSeat = { ...seat, playerId };
  const nextState: StateSnapshot = {
    ...state,
    players: [...state.players, player],
    seats: state.seats.map((s) => (s.id === seat.id ? assignedSeat : s))
  };
  addEvent("JOIN_PLAYER", { playerId, seatId: seat.id });
  finalizeState(nextState);
  return assignedSeat;
}

export function revivePlayerAtSeatLocal(playerId: number, tableNo: number, seatNo: number) {
  const state = loadState();
  if (!state.tournament) throw new Error("No tournament");
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("Player not found");
  if (player.status !== "eliminated") throw new Error("Player is not eliminated");

  const table = state.tables.find((t) => t.tableNo === tableNo);
  if (!table) throw new Error("Table not found");
  const seat = state.seats.find((s) => s.tableId === table.id && s.seatNo === seatNo);
  if (!seat) throw new Error("Seat not found");
  if (seat.playerId !== null) throw new Error("Seat is not available");

  const nextPlayers = state.players.map((p) =>
    p.id === playerId ? { ...p, status: "active" as const, eliminatedAt: null } : p
  );
  const nextSeats = state.seats.map((s) => (s.id === seat.id ? { ...s, playerId } : s));
  addEvent("REVIVE_PLAYER", { playerId, seatId: seat.id, previousEliminatedAt: player.eliminatedAt });
  finalizeState({
    ...state,
    players: nextPlayers,
    seats: nextSeats,
    tournament: state.tournament.status === "finished" ? { ...state.tournament, status: "running" } : state.tournament
  });
}

export function eliminatePlayerLocal(playerId: number) {
  const state = loadState();
  if (!state.tournament) return;
  const seat = state.seats.find((s) => s.playerId === playerId);
  const nextPlayers = state.players.map((p) =>
    p.id === playerId ? { ...p, status: "eliminated" as const, eliminatedAt: now() } : p
  );
  const nextSeats = seat ? state.seats.map((s) => (s.id === seat.id ? { ...s, playerId: null } : s)) : state.seats;
  addEvent("ELIMINATE_PLAYER", { playerId, seatId: seat?.id ?? null });
  const remaining = nextPlayers.filter((p) => p.status === "active").length;
  const status = remaining <= 1 ? "finished" : state.tournament.status;
  finalizeState({
    ...state,
    players: nextPlayers,
    seats: nextSeats,
    tournament: { ...state.tournament, status }
  });
}

export function movePlayerLocal(playerId: number, toSeatId: number) {
  const state = loadState();
  const fromSeat = state.seats.find((s) => s.playerId === playerId);
  const toSeat = state.seats.find((s) => s.id === toSeatId && s.playerId === null);
  if (!fromSeat || !toSeat) throw new Error("Seat is not available");

  const nextSeats = state.seats.map((s) => {
    if (s.id === fromSeat.id) return { ...s, playerId: null };
    if (s.id === toSeat.id) return { ...s, playerId };
    return s;
  });
  addEvent("MOVE_PLAYER", { playerId, fromSeatId: fromSeat.id, toSeatId });
  finalizeState({ ...state, seats: nextSeats });
}

export function balanceSuggestionsLocal(): MoveSuggestion[] {
  const state = loadState();
  const openTables = state.tables.filter((t) => !t.isClosed);
  if (openTables.length < 2) return [];

  const counts = new Map<number, number>();
  for (const table of openTables) {
    counts.set(table.id, state.seats.filter((s) => s.tableId === table.id && s.playerId !== null).length);
  }
  const emptySeats = new Map<number, Seat[]>();
  for (const table of openTables) {
    emptySeats.set(table.id, state.seats.filter((s) => s.tableId === table.id && s.playerId === null));
  }

  const usedFrom = new Set<number>();
  const suggestions: MoveSuggestion[] = [];

  while (true) {
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const max = sorted[0];
    const min = sorted[sorted.length - 1];
    if (!max || !min) break;
    if (max[1] - min[1] < 2) break;

    const fromSeat = state.seats.find((s) => s.tableId === max[0] && s.playerId !== null && !usedFrom.has(s.id));
    const toSeat = emptySeats.get(min[0])?.[0];
    if (!fromSeat || !toSeat) break;

    suggestions.push({ playerId: fromSeat.playerId!, fromSeatId: fromSeat.id, toSeatId: toSeat.id });
    usedFrom.add(fromSeat.id);
    counts.set(max[0], max[1] - 1);
    counts.set(min[0], min[1] + 1);
    emptySeats.get(min[0])?.shift();
  }

  return suggestions;
}

export function closeTableLocal(tableId: number) {
  const state = loadState();
  const table = state.tables.find((t) => t.id === tableId);
  if (!table || table.isClosed) return;

  const seatsInTable = state.seats.filter((s) => s.tableId === tableId && s.playerId !== null);
  const available = state.seats.filter(
    (s) => s.playerId === null && s.tableId !== tableId && !state.tables.find((t) => t.id === s.tableId)?.isClosed
  );

  if (available.length < seatsInTable.length) {
    throw new Error("Not enough seats to close table");
  }

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const moves = seatsInTable.map((seat) => ({
    playerId: seat.playerId!,
    fromSeatId: seat.id,
    toSeatId: shuffled.pop()!.id
  }));

  let nextSeats = [...state.seats];
  for (const move of moves) {
    nextSeats = nextSeats.map((s) => {
      if (s.id === move.fromSeatId) return { ...s, playerId: null };
      if (s.id === move.toSeatId) return { ...s, playerId: move.playerId };
      return s;
    });
  }

  addEvent("CLOSE_TABLE", { tableId, moves });
  finalizeState({
    ...state,
    tables: state.tables.map((t) => (t.id === tableId ? { ...t, isClosed: true } : t)),
    seats: nextSeats
  });
}

function applyClockChange(state: StateSnapshot, updates: Partial<Tournament>, type: EventType) {
  if (!state.tournament) return;
  const payload = {
    fromLevelIndex: state.tournament.currentLevelIndex,
    toLevelIndex: updates.currentLevelIndex ?? state.tournament.currentLevelIndex,
    fromRemainingSeconds: state.tournament.clockRemainingSeconds,
    toRemainingSeconds: updates.clockRemainingSeconds ?? state.tournament.clockRemainingSeconds,
    fromState: state.tournament.clockState,
    toState: updates.clockState ?? state.tournament.clockState
  };
  addEvent(type, payload);
  finalizeState({
    ...state,
    tournament: { ...state.tournament, ...updates, status: "running" }
  });
}

export function startClockLocal() {
  const state = loadState();
  if (!state.tournament || state.tournament.clockState === "running") return;
  applyClockChange(state, { clockState: "running" }, "CLOCK_START");
}

export function pauseClockLocal() {
  const state = loadState();
  if (!state.tournament || state.tournament.clockState === "paused") return;
  applyClockChange(state, { clockState: "paused" }, "CLOCK_PAUSE");
}

export function nextLevelLocal() {
  const state = loadState();
  if (!state.tournament) return;
  const next = state.levels.find((l) => l.index === state.tournament!.currentLevelIndex + 1);
  if (!next) return;
  applyClockChange(state, { currentLevelIndex: next.index, clockRemainingSeconds: next.durationSeconds }, "CLOCK_NEXT");
}

export function previousLevelLocal() {
  const state = loadState();
  if (!state.tournament) return;
  const prev = state.levels.find((l) => l.index === state.tournament!.currentLevelIndex - 1);
  if (!prev) return;
  applyClockChange(state, { currentLevelIndex: prev.index, clockRemainingSeconds: prev.durationSeconds }, "CLOCK_PREV");
}

export function adjustClockLocal(seconds: number) {
  const state = loadState();
  if (!state.tournament) return;
  const nextRemaining = Math.max(0, state.tournament.clockRemainingSeconds + seconds);
  applyClockChange(state, { clockRemainingSeconds: nextRemaining }, "CLOCK_ADJUST");
}

export function triggerNextBreakLocal() {
  const state = loadState();
  if (!state.tournament) return;
  const nextBreak = state.levels
    .filter((l) => l.isBreak && l.index > state.tournament!.currentLevelIndex)
    .sort((a, b) => a.index - b.index)[0];
  if (!nextBreak) return;
  applyClockChange(state, { currentLevelIndex: nextBreak.index, clockRemainingSeconds: nextBreak.durationSeconds }, "CLOCK_NEXT");
}

export function updateItmLocal(newCount: number) {
  const state = loadState();
  if (!state.tournament) return;
  addEvent("UPDATE_ITM", { previousItmCount: state.tournament.itmCount, newItmCount: newCount });
  finalizeState({
    ...state,
    tournament: { ...state.tournament, itmCount: newCount }
  });
}

export function updateLevelsLocal(levels: LevelDraft[]) {
  const state = loadState();
  if (!state.tournament) return;

  const sortedLevels = [...levels].sort((a, b) => a.index - b.index);
  const nextLevels: Level[] = sortedLevels.map((level, idx) => ({
    id: idx + 1,
    tournamentId: state.tournament!.id,
    index: level.index,
    durationSeconds: level.durationSeconds,
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    ante: level.ante,
    isBreak: level.isBreak,
    label: level.label
  }));

  // Ensure current level index is still valid
  const currentIdx = state.tournament.currentLevelIndex;
  const nextCurrentIdx = Math.min(currentIdx, nextLevels.length - 1);

  // If the current level duration changed, we might want to adjust remaining time, 
  // but for simplicity we'll keep the clock running as is unless it exceeds the new duration.
  // A more complex logic could proportionally scale it. For now, let's just clamp it.
  let nextRemaining = state.tournament.clockRemainingSeconds;
  const currentLevel = nextLevels.find(l => l.index === nextCurrentIdx);
  if (currentLevel && nextRemaining > currentLevel.durationSeconds) {
    nextRemaining = currentLevel.durationSeconds;
  }

  addEvent("UPDATE_LEVELS", { previousLevels: state.levels, newLevels: nextLevels });

  finalizeState({
    ...state,
    levels: nextLevels,
    tournament: {
      ...state.tournament,
      currentLevelIndex: nextCurrentIdx,
      clockRemainingSeconds: nextRemaining
    }
  });
}

export function undoLastEventLocal() {
  const state = loadState();
  const events = loadEvents();
  if (!state.tournament || events.length === 0) return;

  const undone = new Set<number>();
  for (const evt of events) {
    if (evt.type === "UNDO_EVENT" && typeof evt.payload.eventId === "number") {
      undone.add(evt.payload.eventId);
    }
  }

  const target = events.find((evt) => evt.type !== "UNDO_EVENT" && !undone.has(evt.id));
  if (!target) return;

  const payload = target.payload as Record<string, any>;
  let nextState = { ...state } as StateSnapshot;

  switch (target.type) {
    case "JOIN_PLAYER": {
      nextState.players = nextState.players.filter((p) => p.id !== payload.playerId);
      nextState.seats = nextState.seats.map((s) => (s.id === payload.seatId ? { ...s, playerId: null } : s));
      break;
    }
    case "ELIMINATE_PLAYER": {
      nextState.players = nextState.players.map((p) =>
        p.id === payload.playerId ? { ...p, status: "active", eliminatedAt: null } : p
      );
      if (payload.seatId) {
        nextState.seats = nextState.seats.map((s) => (s.id === payload.seatId ? { ...s, playerId: payload.playerId } : s));
      }
      break;
    }
    case "MOVE_PLAYER": {
      nextState.seats = nextState.seats.map((s) => {
        if (s.id === payload.toSeatId) return { ...s, playerId: null };
        if (s.id === payload.fromSeatId) return { ...s, playerId: payload.playerId };
        return s;
      });
      break;
    }
    case "CLOCK_START":
    case "CLOCK_PAUSE":
    case "CLOCK_NEXT":
    case "CLOCK_PREV":
    case "CLOCK_ADJUST": {
      if (nextState.tournament) {
        nextState.tournament = {
          ...nextState.tournament,
          currentLevelIndex: payload.fromLevelIndex,
          clockState: payload.fromState,
          clockRemainingSeconds: payload.fromRemainingSeconds
        };
      }
      break;
    }
    case "UPDATE_ITM": {
      if (nextState.tournament) {
        nextState.tournament = { ...nextState.tournament, itmCount: payload.previousItmCount };
      }
      break;
    }
    case "UPDATE_LEVELS": {
      nextState.levels = payload.previousLevels;
      break;
    }
    case "CLOSE_TABLE": {
      nextState.seats = nextState.seats.map((s) => {
        const move = payload.moves?.find((m: any) => m.toSeatId === s.id || m.fromSeatId === s.id);
        if (!move) return s;
        if (s.id === move.toSeatId) return { ...s, playerId: null };
        if (s.id === move.fromSeatId) return { ...s, playerId: move.playerId };
        return s;
      });
      nextState.tables = nextState.tables.map((t) => (t.id === payload.tableId ? { ...t, isClosed: false } : t));
      break;
    }
    case "REVIVE_PLAYER": {
      nextState.players = nextState.players.map((p) =>
        p.id === payload.playerId ? { ...p, status: "eliminated", eliminatedAt: payload.previousEliminatedAt ?? null } : p
      );
      nextState.seats = nextState.seats.map((s) => (s.id === payload.seatId ? { ...s, playerId: null } : s));
      break;
    }
  }

  addEvent("UNDO_EVENT", { eventId: target.id });
  finalizeState(nextState);
}

export function tickClockLocal() {
  const state = loadState();
  if (!state.tournament || state.tournament.clockState !== "running") return;
  let remaining = Math.max(0, state.tournament.clockRemainingSeconds - 1);
  let levelIndex = state.tournament.currentLevelIndex;
  if (remaining === 0) {
    const next = state.levels.find((l) => l.index === levelIndex + 1);
    if (next) {
      levelIndex = next.index;
      remaining = next.durationSeconds;
      addEvent("CLOCK_NEXT", {
        fromLevelIndex: state.tournament.currentLevelIndex,
        toLevelIndex: levelIndex,
        fromRemainingSeconds: state.tournament.clockRemainingSeconds,
        toRemainingSeconds: remaining,
        fromState: state.tournament.clockState,
        toState: state.tournament.clockState
      });
    }
  }
  finalizeState({
    ...state,
    tournament: {
      ...state.tournament,
      currentLevelIndex: levelIndex,
      clockRemainingSeconds: remaining
    }
  });
}

export function openDisplayWindowLocal() {
  window.open("/#/display", "mtt-display");
}
