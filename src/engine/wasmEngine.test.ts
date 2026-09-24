// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { MemoryStorage, MIN, createTestEngine, tournamentInput } from "../test/wasm";
import type { EngineError, View } from "./types";
import { INDEX_KEY, randomId, randomSeed, tournamentKey, type ChannelLike } from "./wasmEngine";

const T0 = 1_700_000_000_000;

/** A fake clock the tests move by hand. */
function clock(start = T0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

async function rejection(promise: Promise<unknown>): Promise<EngineError> {
  try {
    await promise;
  } catch (error) {
    return error as EngineError;
  }
  throw new Error("expected a rejection");
}

/** BroadcastChannel stand-in connecting engines that play different tabs. */
function channelHub() {
  const members = new Set<ChannelLike>();
  return () => {
    const channel: ChannelLike = {
      onmessage: null,
      postMessage(message) {
        for (const other of members) {
          if (other !== channel) other.onmessage?.({ data: structuredClone(message) } as MessageEvent);
        }
      },
      close() {
        members.delete(channel);
      }
    };
    members.add(channel);
    return channel;
  };
}

function names(view: View, alive: boolean) {
  return view.ranking.filter((row) => row.alive === alive).map((row) => row.name);
}

describe("WasmEngine", () => {
  it("creates a tournament and lists it", async () => {
    const time = clock();
    const engine = createTestEngine({ now: time.now });

    const id = await engine.createTournament(tournamentInput({ name: "Friday Deepstack" }));

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await engine.listTournaments()).toEqual([
      { id, name: "Friday Deepstack", phase: "setup", createdAtMs: T0, updatedAtMs: T0, players: 0, alive: 0 }
    ]);
    const view = await engine.getView(id);
    expect(view).toMatchObject({ id, phase: "setup", generatedAtMs: T0, config: { name: "Friday Deepstack" } });
    expect(view.levels.map((row) => row.playLevel)).toEqual([1, 2, null, 3, 4]);
  });

  it("registers, starts the clock, busts and ranks through the core", async () => {
    const time = clock();
    const engine = createTestEngine({ now: time.now });
    const id = await engine.createTournament(tournamentInput());

    for (const name of ["Ann", "Ben", "Cat", "Dan"]) {
      await engine.dispatch(id, { type: "register", name });
    }
    let view = await engine.dispatch(id, { type: "register", name: "Eve", seat: { table: 2, seat: 5 } });
    expect(view.counts).toMatchObject({ unique: 5, alive: 5 });
    const eve = view.ranking.find((row) => row.name === "Eve")!;
    expect(eve.seat).toEqual({ table: 2, seat: 5 });

    time.advance(MIN);
    view = await engine.dispatch(id, { type: "start_clock" });
    expect(view.phase).toBe("running");
    expect(view.clock).toMatchObject({ running: true, levelIndex: 0, playLevel: 1, endsAtMs: T0 + 21 * MIN });

    const byName = (name: string) => view.ranking.find((row) => row.name === name)!.player;
    view = await engine.dispatch(id, { type: "bust_players", busts: [{ player: byName("Ann") }] });
    expect(view.ranking.find((row) => row.name === "Ann")).toMatchObject({ alive: false, place: 5, placeTo: null });

    // Same hand: the larger starting stack finishes higher.
    view = await engine.dispatch(id, {
      type: "bust_players",
      busts: [
        { player: byName("Ben"), startStack: 3000 },
        { player: byName("Cat"), startStack: 8000 }
      ]
    });
    expect(view.ranking.filter((row) => !row.alive).map((row) => [row.name, row.place])).toEqual([
      ["Cat", 3],
      ["Ben", 4],
      ["Ann", 5]
    ]);
    expect(view.itm).toEqual({ status: "in_money" });
    expect((await engine.listTournaments())[0]).toMatchObject({ phase: "running", players: 5, alive: 2 });
  });

  it("undoes and redoes with labels from the log", async () => {
    const engine = createTestEngine({ now: clock().now });
    const id = await engine.createTournament(tournamentInput());
    await engine.dispatch(id, { type: "register", name: "Ann" });
    let view = await engine.dispatch(id, { type: "register", name: "Ben" });
    expect(view.history.undo).toMatchObject({ kind: "player_registered", names: ["Ben"] });

    view = await engine.dispatch(id, { type: "undo" });
    expect(names(view, true)).toEqual(["Ann"]);
    expect(view.history.redo).toMatchObject({ kind: "player_registered", names: ["Ben"] });

    view = await engine.dispatch(id, { type: "redo" });
    expect(names(view, true).sort()).toEqual(["Ann", "Ben"]);
    expect(view.history.redo).toBeNull();

    expect(await rejection(engine.dispatch(id, { type: "redo" }))).toEqual({ code: "NOTHING_TO_REDO" });
  });

  it("reloads a tournament from storage, undo cursor included", async () => {
    const storage = new MemoryStorage();
    const time = clock();
    const first = createTestEngine({ storage, now: time.now });
    const id = await first.createTournament(tournamentInput());
    await first.dispatch(id, { type: "register", name: "Ann" });
    await first.dispatch(id, { type: "register", name: "Ben" });
    await first.dispatch(id, { type: "start_clock" });
    await first.dispatch(id, { type: "undo" });
    time.advance(5 * MIN);
    const before = await first.getView(id);
    first.dispose();

    const reloaded = createTestEngine({ storage, now: time.now });
    expect(await reloaded.getView(id)).toEqual(before);
    const saved = JSON.parse(storage.getItem(tournamentKey(id))!);
    expect(saved).toMatchObject({ format: 1, head: 3 });
    expect(saved.events).toHaveLength(4);

    const view = await reloaded.dispatch(id, { type: "redo" });
    expect(view.phase).toBe("running");
  });

  it("rejects with the core's error codes and params", async () => {
    const engine = createTestEngine({ now: clock().now });
    const id = await engine.createTournament(tournamentInput());
    const view = await engine.dispatch(id, { type: "register", name: "Ann" });
    const ann = view.ranking[0].player;

    expect(await rejection(engine.dispatch(id, { type: "register", name: "  ann " }))).toEqual({
      code: "NAME_TAKEN",
      params: { player: ann }
    });
    expect(await rejection(engine.dispatch(id, { type: "start_clock" }))).toEqual({
      code: "NOT_ENOUGH_PLAYERS",
      params: { min: 2, have: 1 }
    });
    expect(await rejection(engine.dispatch(id, { type: "register", name: "Ben", seat: { table: 3, seat: 1 } }))).toEqual({
      code: "TABLE_NOT_FOUND",
      params: { table: 3 }
    });
    const badStructure = tournamentInput({}, [{ type: "play", sb: 200, bb: 100, ante: { type: "none" }, durationMs: MIN }]);
    expect(await rejection(engine.createTournament(badStructure))).toEqual({ code: "INVALID_BLINDS", params: { index: 0 } });

    expect(await rejection(engine.getView("missing"))).toEqual({ code: "NOT_FOUND", params: { id: "missing" } });
    const malformed = await rejection(engine.dispatch(id, { type: "fly" } as never));
    expect(malformed.code).toBe("HOST_ERROR");

    // Rejected commands change nothing.
    expect((await engine.getView(id)).counts.unique).toBe(1);
    expect(await engine.listTournaments()).toHaveLength(1);
  });

  it("passes a fresh random seed per command as a decimal string", async () => {
    const seeds: string[] = [];
    const engine = createTestEngine({
      now: clock().now,
      seed: () => {
        const seed = randomSeed();
        seeds.push(seed);
        return seed;
      }
    });
    const id = await engine.createTournament(tournamentInput());
    await engine.dispatch(id, { type: "register", name: "Ann" });
    await engine.dispatch(id, { type: "register", name: "Ben" });

    expect(seeds).toHaveLength(3);
    for (const seed of seeds) {
      expect(seed).toMatch(/^\d+$/);
      expect(BigInt(seed) < 2n ** 64n).toBe(true);
    }
    expect(new Set(seeds).size).toBe(3);
  });

  it("generates UUID v4 tournament ids", () => {
    const ids = Array.from({ length: 20 }, randomId);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the saved state when storage is full", async () => {
    const storage = new MemoryStorage();
    const engine = createTestEngine({ storage, now: clock().now });
    const id = await engine.createTournament(tournamentInput());
    await engine.dispatch(id, { type: "register", name: "Ann" });

    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const error = await rejection(engine.dispatch(id, { type: "register", name: "Ben" }));
    expect(error).toEqual({ code: "HOST_ERROR", params: { message: expect.stringContaining("quota exceeded") } });
    setItem.mockRestore();

    expect(names(await engine.getView(id), true)).toEqual(["Ann"]);
    expect(names(await engine.dispatch(id, { type: "register", name: "Ben" }), true).sort()).toEqual(["Ann", "Ben"]);
  });

  it("deletes a tournament", async () => {
    const storage = new MemoryStorage();
    const engine = createTestEngine({ storage, now: clock().now });
    const keep = await engine.createTournament(tournamentInput({ name: "Keep" }));
    const drop = await engine.createTournament(tournamentInput({ name: "Drop" }));

    await engine.deleteTournament(drop);

    expect((await engine.listTournaments()).map((summary) => summary.id)).toEqual([keep]);
    expect(storage.getItem(tournamentKey(drop))).toBeNull();
    expect(await rejection(engine.getView(drop))).toEqual({ code: "NOT_FOUND", params: { id: drop } });
    expect(await rejection(engine.deleteTournament(drop))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets another tab follow changes without ever writing", async () => {
    const storage = new MemoryStorage();
    const connect = channelHub();
    const time = clock();
    const director = createTestEngine({ storage, now: time.now, channel: connect() });
    const display = createTestEngine({ storage, now: time.now, channel: connect() });
    const id = await director.createTournament(tournamentInput());
    await director.dispatch(id, { type: "register", name: "Ann" });
    expect((await display.getView(id)).counts.unique).toBe(1);

    const changes: string[] = [];
    display.subscribe((changed) => changes.push(changed));
    const writes = vi.spyOn(storage, "setItem");
    await director.dispatch(id, { type: "register", name: "Ben" });
    await Promise.resolve();

    expect(changes).toEqual([id]);
    writes.mockClear();
    expect((await display.getView(id)).counts.unique).toBe(2);
    time.advance(10 * MIN);
    await display.getView(id);
    await display.listTournaments();
    expect(writes).not.toHaveBeenCalled();
  });

  it("waits for another tab's write to reach its storage when the message comes first", async () => {
    // Browsers propagate localStorage between tabs asynchronously: model each tab's copy.
    const directorStorage = new MemoryStorage();
    const displayStorage = new MemoryStorage();
    const storageEvents = new EventTarget();
    const connect = channelHub();
    const director = createTestEngine({ storage: directorStorage, channel: connect() });
    const display = createTestEngine({ storage: displayStorage, channel: connect(), storageEvents });
    const sync = () => {
      const oldValue = displayStorage.getItem(INDEX_KEY);
      for (let i = 0; i < directorStorage.length; i++) {
        const key = directorStorage.key(i)!;
        displayStorage.setItem(key, directorStorage.getItem(key)!);
      }
      const event = Object.assign(new Event("storage"), { key: INDEX_KEY, oldValue, newValue: displayStorage.getItem(INDEX_KEY) });
      storageEvents.dispatchEvent(event);
    };
    const id = await director.createTournament(tournamentInput());
    sync();
    expect((await display.getView(id)).counts.unique).toBe(0);

    const changes: number[] = [];
    display.subscribe(async (changed) => changes.push((await display.getView(changed)).counts.unique));
    await director.dispatch(id, { type: "register", name: "Ann" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    sync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The message came first and changed nothing visible; the storage event announced the change, once.
    expect(changes).toEqual([1]);
    sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toEqual([1]);
    display.dispose();
  });

  it("notifies its own listeners after a change, and stops when unsubscribed", async () => {
    const engine = createTestEngine({ now: clock().now });
    const id = await engine.createTournament(tournamentInput());
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);

    await engine.dispatch(id, { type: "register", name: "Ann" });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(id);

    unsubscribe();
    await engine.dispatch(id, { type: "register", name: "Ben" });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stores the list and the logs under versioned keys", async () => {
    const storage = new MemoryStorage();
    const engine = createTestEngine({ storage, now: clock().now });
    const id = await engine.createTournament(tournamentInput());

    expect(JSON.parse(storage.getItem(INDEX_KEY)!)).toEqual([expect.objectContaining({ id, rev: 1 })]);
    expect(storage.getItem(`mtt:v2:t:${id}`)).toContain('"tournament_created"');
  });
});
