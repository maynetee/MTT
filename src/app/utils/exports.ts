import { isEngineError, type Engine, type RankingRow } from "../../engine/types";
import type { Currency } from "../../bindings/Currency";
import { i18n as english, type I18n } from "../../i18n";
import { buildRankingCsv } from "./csv";
import { rankingFileName } from "./fileName";

export interface RankingExport {
  tournamentName: string;
  /** Whether the tournament is finished, i.e. whether the ranking is final. */
  finished: boolean;
  winner: number | null;
  rows: readonly RankingRow[];
  /** With money tracking: the exports add a prize column in this currency. */
  currency?: Currency;
}

/** An export failure, with a message ready for the user. */
export class ExportError extends Error {}

function failure(i18n: I18n, format: "CSV" | "PDF", error: unknown): ExportError {
  console.error(`${format} export failed`, error);
  const reason = isEngineError(error) ? i18n.error(error) : error instanceof Error ? error.message : String(error);
  return new ExportError(i18n.t("exports.failed", { format, reason }));
}

/**
 * Saves the ranking as CSV: a download in the browser, the save dialog on the desktop.
 * Resolves to false when the user cancels; rejects with an `ExportError`.
 */
export async function exportCSV(engine: Engine, data: RankingExport, i18n: I18n = english): Promise<boolean> {
  try {
    const content = buildRankingCsv(data.rows, data.winner, i18n, data.currency);
    return await engine.saveExport({
      fileName: rankingFileName(data.tournamentName, "csv"),
      bytes: new TextEncoder().encode(content),
      mimeType: "text/csv;charset=utf-8"
    });
  } catch (error) {
    throw failure(i18n, "CSV", error);
  }
}

/** Same as `exportCSV`, as a PDF. */
export async function exportPDF(engine: Engine, data: RankingExport, i18n: I18n = english): Promise<boolean> {
  try {
    // pdf-lib, fontkit and the fonts are only downloaded when a PDF is actually exported.
    const { buildRankingPdf } = await import("./rankingPdf");
    const bytes = await buildRankingPdf(data.rows, { ...data, i18n });
    return await engine.saveExport({ fileName: rankingFileName(data.tournamentName, "pdf"), bytes, mimeType: "application/pdf" });
  } catch (error) {
    throw failure(i18n, "PDF", error);
  }
}
