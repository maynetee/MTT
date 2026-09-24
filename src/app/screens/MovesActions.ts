import { useRef } from "react";
import type { BalanceStep, View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { useToast } from "../components/Toast";
import { useTournament } from "../TournamentContext";
import { seatChanges, type SeatChange } from "../utils/view";
import { announce, announceBalance } from "./MovesAnnouncement";
import { isResolved } from "./MovesPlan";

/**
 * Table operations shared by the Seating and Moves screens: each runs the command, then keeps
 * the seat changes to announce and confirms with a toast. Errors are shown by `run`.
 */
export function useTableActions() {
  const { t } = useI18n();
  const { id, view, run, playerName } = useTournament();
  const toast = useToast();
  // The view the command starts from, even when called from a handler of an older render.
  const latest = useRef(view);
  latest.current = view;

  const breakTable = async (table: number): Promise<View | null> => {
    const before = latest.current;
    const next = await run({ type: "break_table", table });
    if (!next) return null;
    const changes = seatChanges(before, next);
    announce(id, { kind: "break", table, changes, atMs: next.generatedAtMs });
    toast.success(t("moves.toast.broken", { table, count: changes.length }));
    return next;
  };

  const drawFinalTable = async (table: number): Promise<View | null> => {
    const before = latest.current;
    const next = await run({ type: "form_final_table", table });
    if (!next) return null;
    announce(id, { kind: "final", table, changes: seatChanges(before, next), atMs: next.generatedAtMs });
    toast.success(t("moves.toast.finalDrawn", { table }));
    return next;
  };

  const openTable = async (table: number): Promise<View | null> => {
    const next = await run({ type: "open_table", table });
    if (next) toast.success(t("seating.opened", { table }));
    return next;
  };

  const moveCommand = (step: BalanceStep & { player: number; toSeat: number }) =>
    ({ type: "move_player", player: step.player, to: { table: step.toTable, seat: step.toSeat }, reason: "balance" }) as const;

  /** Applies the first step of the balancing plan. */
  const applyStep = async (step: BalanceStep): Promise<View | null> => {
    if (!isResolved(step)) return null;
    const before = latest.current;
    const next = await run(moveCommand(step));
    if (!next) return null;
    announceBalance(id, seatChanges(before, next), next.generatedAtMs);
    toast.success(t("moves.toast.moved", { name: playerName(step.player) ?? `#${step.player}`, table: step.toTable, seat: step.toSeat }));
    return next;
  };

  /**
   * Applies the plan move by move, each from the plan recomputed after the previous one, and
   * stops at the first step that is not resolved or fails.
   */
  const applyAll = async (): Promise<View | null> => {
    let current = latest.current;
    const moved: SeatChange[] = [];
    for (let left = current.suggestions.balance.length; left > 0; left -= 1) {
      const [step] = current.suggestions.balance;
      if (!step || !isResolved(step)) break;
      const next = await run(moveCommand(step));
      if (!next) break;
      moved.push(...seatChanges(current, next));
      current = next;
    }
    if (moved.length === 0) return null;
    announceBalance(id, moved, current.generatedAtMs);
    toast.success(t("moves.toast.movedMany", { count: new Set(moved.map((change) => change.player)).size }));
    return current;
  };

  return { breakTable, drawFinalTable, openTable, applyStep, applyAll };
}
