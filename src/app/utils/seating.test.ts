import { describe, expect, it } from "vitest";
import { createDemoTournament } from "../../test/demo";
import { closeTableLocal, eliminatePlayerLocal, getStateLocal, registerPlayerLocal } from "../demoStore";
import type { StateSnapshot } from "../types";
import { freeSeatsAtOpenTables, openSeatsLeft } from "./seating";

describe("openSeatsLeft", () => {
  it("counts every seat of a new tournament", () => {
    createDemoTournament(2, 3);
    expect(openSeatsLeft(getStateLocal())).toBe(6);
  });

  it("does not count seats taken by active players", () => {
    createDemoTournament(2, 3);
    registerPlayerLocal("Alice", "balanced");
    registerPlayerLocal("Bob", "balanced");
    expect(openSeatsLeft(getStateLocal())).toBe(4);
  });

  it("counts the seat freed by a busted player", () => {
    createDemoTournament(2, 3);
    registerPlayerLocal("Alice", "balanced");
    registerPlayerLocal("Bob", "balanced");
    const alice = getStateLocal().players.find((player) => player.name === "Alice")!;
    eliminatePlayerLocal(alice.id);
    expect(openSeatsLeft(getStateLocal())).toBe(5);
  });

  it("does not count the seats of a closed table", () => {
    createDemoTournament(2, 3);
    registerPlayerLocal("Alice", "balanced");
    registerPlayerLocal("Bob", "balanced");
    closeTableLocal(1);
    expect(openSeatsLeft(getStateLocal())).toBe(1);
  });
});

describe("freeSeatsAtOpenTables", () => {
  it("lists empty seats at open tables by table number then seat number", () => {
    const state: Pick<StateSnapshot, "tables" | "seats"> = {
      tables: [
        { id: 10, tournamentId: 1, tableNo: 2, isClosed: false },
        { id: 20, tournamentId: 1, tableNo: 1, isClosed: false },
        { id: 30, tournamentId: 1, tableNo: 3, isClosed: true }
      ],
      seats: [
        { id: 1, tableId: 10, seatNo: 2, playerId: null },
        { id: 2, tableId: 10, seatNo: 1, playerId: null },
        { id: 3, tableId: 20, seatNo: 2, playerId: null },
        { id: 4, tableId: 20, seatNo: 1, playerId: 7 },
        { id: 5, tableId: 30, seatNo: 1, playerId: null }
      ]
    };
    expect(freeSeatsAtOpenTables(state)).toEqual([
      { seatId: 3, tableNo: 1, seatNo: 2 },
      { seatId: 2, tableNo: 2, seatNo: 1 },
      { seatId: 1, tableNo: 2, seatNo: 2 }
    ]);
  });
});
