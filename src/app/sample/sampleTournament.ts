import type { Command, Engine, Level, NewTournamentInput, SeatRef, View } from "../../engine/types";

const MINUTE_MS = 60_000;

export const SAMPLE_TABLES = 4;
export const SAMPLE_SEATS = 9;
export const SAMPLE_STARTING_STACK = 20_000;
/** Late registration closes at the end of this play level. */
export const SAMPLE_LATE_REG_LEVEL = 6;
/** The sample is ready in level 3 (structure row 2), with about half of it left. */
export const SAMPLE_LEVEL_INDEX = 2;
export const SAMPLE_REMAINING_MS = 11 * MINUTE_MS + 24_000;

/** Fictional players from many places, several names beyond ASCII. */
export const SAMPLE_PLAYERS: readonly string[] = [
  "Łukasz Nowak",
  "Zoë Brennan",
  "Søren Kjær",
  "Dmitrij Volkov",
  "Ngozi Okafor",
  "Mei-Lin Chen",
  "José Castaño",
  "Aoife Byrne",
  "Hana Kobayashi",
  "Kwame Asante",
  "Élodie Marchand",
  "Björn Lindqvist",
  "Priya Raman",
  "Mateus Oliveira",
  "Fatima El Idrissi",
  "Tomás Ó Ceallaigh",
  "Yuki Tanaka",
  "Ayşe Demir",
  "Nikos Papadakis",
  "Ingrid Solberg",
  "Rafael Domínguez",
  "Chiara Bellini",
  "Oluwaseun Adeyemi",
  "Sakura Itō",
  "Pavel Horák",
  "Anaïs Dubois",
  "Jörg Weiß",
  "Lucía Fernández",
  "Mikko Virtanen",
  "Amara Nwosu",
  "Siddharth Iyer",
  "Gráinne Walsh",
  "Thanh Hà Nguyễn",
  "Rasmus Holm",
  "Leilani Kahale",
  "Ömer Yıldız"
];

/** Where each table's button is. */
const BUTTONS: readonly SeatRef[] = [
  { table: 1, seat: 3 },
  { table: 2, seat: 6 },
  { table: 3, seat: 1 },
  { table: 4, seat: 8 }
];

/**
 * The hands that eliminated someone, by structure row and seat. The two-player hand gives
 * each starting stack, so the bigger stack finishes higher.
 */
const ELIMINATIONS: ReadonlyArray<{ level: number; busts: ReadonlyArray<{ at: SeatRef; startStack?: number }> }> = [
  { level: 0, busts: [{ at: { table: 2, seat: 4 } }] },
  {
    level: 1,
    busts: [
      { at: { table: 2, seat: 8 }, startStack: 23_450 },
      { at: { table: 2, seat: 2 }, startStack: 8_125 }
    ]
  },
  { level: 1, busts: [{ at: { table: 4, seat: 6 } }] },
  { level: 2, busts: [{ at: { table: 1, seat: 9 } }] }
];

function play(sb: number, bb: number): Level {
  return { type: "play", sb, bb, ante: { type: "big_blind", amount: bb }, durationMs: 20 * MINUTE_MS };
}

function pause(minutes: number, colorUp: number | null = null): Level {
  return { type: "break", durationMs: minutes * MINUTE_MS, colorUp };
}

/** A deepstack with a big blind ante from the start, 20-minute levels and four breaks. */
export function sampleStructure(): Level[] {
  return [
    play(100, 200),
    play(200, 300),
    play(200, 400),
    play(300, 600),
    pause(10),
    play(400, 800),
    play(500, 1_000),
    play(600, 1_200),
    play(800, 1_600),
    pause(15, 500),
    play(1_000, 2_000),
    play(1_500, 3_000),
    play(2_000, 4_000),
    play(2_500, 5_000),
    pause(10, 1_000),
    play(3_000, 6_000),
    play(4_000, 8_000),
    play(5_000, 10_000),
    play(6_000, 12_000),
    pause(10),
    play(8_000, 16_000),
    play(10_000, 20_000),
    play(15_000, 30_000),
    play(20_000, 40_000),
    play(25_000, 50_000),
    play(30_000, 60_000)
  ];
}

/** 4 tables of 9, 20,000 chips, late registration to the end of level 6, EUR 100 + 10. */
export function sampleInput(name: string): NewTournamentInput {
  return {
    config: {
      name,
      seatsPerTable: SAMPLE_SEATS,
      maxTables: SAMPLE_TABLES,
      finalTableSize: null,
      balanceTrigger: 2,
      breakOrder: [],
      startingStack: SAMPLE_STARTING_STACK,
      placesPaid: 6,
      lateReg: { type: "end_of_play_level", n: SAMPLE_LATE_REG_LEVEL, throughBreak: false },
      // The default payout curve on the places paid.
      payout: {},
      money: {
        currency: { code: "EUR", exponent: 2 },
        buyIn: { prize: 10_000, fee: 1_000 },
        guarantee: 300_000,
        roundingUnit: 500
      }
    },
    structure: sampleStructure()
  };
}

/**
 * The seat each player draws: a fixed shuffle, so every sample looks the same (the engine
 * draws seats with a random seed of its own). 13 and 36 are coprime: every seat once.
 */
export function sampleSeat(index: number): SeatRef {
  const seats = SAMPLE_TABLES * SAMPLE_SEATS;
  const slot = (5 + 13 * index) % seats;
  return { table: Math.floor(slot / SAMPLE_SEATS) + 1, seat: (slot % SAMPLE_SEATS) + 1 };
}

function playerAt(view: View, { table, seat }: SeatRef): number {
  const player = view.tables.find((candidate) => candidate.table === table)?.seats.find((candidate) => candidate.seat === seat)?.player;
  if (player === null || player === undefined) throw new Error(`nobody at table ${table} seat ${seat}`);
  return player;
}

/**
 * Creates "Sample — Friday Deepstack" through ordinary engine commands, so it works the same
 * with every engine: 36 players seated at 4 tables, buttons set, the clock started and
 * moved to the middle of level 3, and five players out (two of them in the same hand).
 * Every screen has something to show. On failure the half-built tournament is deleted.
 */
export async function createSampleTournament(engine: Engine, name: string): Promise<string> {
  const id = await engine.createTournament(sampleInput(name));
  const run = (command: Command) => engine.dispatch(id, command);
  try {
    for (const [index, player] of SAMPLE_PLAYERS.entries()) {
      await run({ type: "register", name: player, seat: sampleSeat(index) });
    }
    for (const { table, seat } of BUTTONS) await run({ type: "set_button", table, seat });

    let view = await run({ type: "start_clock" });
    const nextLevel = async (level: number) => {
      while (view.clock.levelIndex < level) view = await run({ type: "next_level" });
    };
    for (const hand of ELIMINATIONS) {
      await nextLevel(hand.level);
      const busts = hand.busts.map(({ at, startStack }) => ({ player: playerAt(view, at), ...(startStack === undefined ? {} : { startStack }) }));
      view = await run({ type: "bust_players", busts });
    }
    await nextLevel(SAMPLE_LEVEL_INDEX);
    await run({ type: "set_remaining", ms: SAMPLE_REMAINING_MS });
    return id;
  } catch (error) {
    await engine.deleteTournament(id).catch(() => undefined);
    throw error;
  }
}
