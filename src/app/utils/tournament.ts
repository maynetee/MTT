import type { Level } from "../types";

export function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

// 1-based number of a play level, counting only the non-break levels before it; null for a break.
export function playLevelNumber(levels: Pick<Level, "index" | "isBreak">[], level: Pick<Level, "index" | "isBreak">): number | null {
  if (level.isBreak) return null;
  return levels.filter((l) => !l.isBreak && l.index < level.index).length + 1;
}

export interface MoneyStatus {
  kind: "away" | "bubble" | "itm";
  text: string;
}

// `alive` players remain and the top `paid` finish in the money.
export function moneyStatus(alive: number, paid: number): MoneyStatus {
  if (alive <= paid) return { kind: "itm", text: "In the money" };
  if (alive === paid + 1) return { kind: "bubble", text: "Bubble!" };
  // At least two eliminations are left here, so the plural always applies.
  return { kind: "away", text: `${alive - paid} eliminations to the money` };
}
