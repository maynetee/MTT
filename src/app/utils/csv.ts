import type { RankingEntry } from "../types";
import { rankingStatusLabel } from "./ranking";

/** Characters that make spreadsheet applications evaluate a cell as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * Escapes one CSV field (RFC 4180) and neutralizes spreadsheet formula injection:
 * text starting with =, +, -, @, tab or carriage return is prefixed with a single quote.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const text = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvRow(fields: ReadonlyArray<string | number | null | undefined>): string {
  return fields.map(escapeCsvField).join(",");
}

/**
 * Ranking as CSV: CRLF line endings, and a UTF-8 byte order mark so that
 * spreadsheet applications such as Excel decode non-ASCII names correctly.
 */
export function buildRankingCsv(entries: readonly RankingEntry[]): string {
  const rows = [
    toCsvRow(["Place", "Player", "Status"]),
    ...entries.map((entry) => toCsvRow([entry.place, entry.playerName, rankingStatusLabel(entry)]))
  ];
  return `﻿${rows.join("\r\n")}\r\n`;
}
