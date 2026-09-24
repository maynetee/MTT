import type { RankingRow } from "../../engine/types";
import type { Currency } from "../../bindings/Currency";
import { i18n as english, type I18n } from "../../i18n";
import { rankingStatus } from "./labels";
import { toDecimal } from "./money";

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
 * Tied players share their best place; the status column says the tie. With money
 * tracking (`currency`), a prize column in major units ("110.00"), empty without a prize.
 */
export function buildRankingCsv(rows: readonly RankingRow[], winner: number | null, i18n: I18n = english, currency?: Currency): string {
  const { t } = i18n;
  const prize = (row: RankingRow) => (currency ? [row.prize === undefined ? null : toDecimal(row.prize, currency.exponent)] : []);
  const lines = [
    toCsvRow([t("exports.place"), t("exports.player"), t("exports.status"), ...(currency ? [t("exports.prize", { currency: currency.code })] : [])]),
    ...rows.map((row) => toCsvRow([row.place, row.name, rankingStatus(i18n, row, winner), ...prize(row)]))
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
