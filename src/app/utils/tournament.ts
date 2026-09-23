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
