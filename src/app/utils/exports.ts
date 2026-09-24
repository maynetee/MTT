import type { RankingEntry } from "../types";
import { emitAppError, isTauriAvailable, saveExport } from "../api";
import { buildRankingCsv } from "./csv";
import { rankingFileName } from "./fileName";

export interface PdfExportMeta {
  tournamentName: string;
  /** Whether the tournament is finished, i.e. whether the ranking is final. */
  finished: boolean;
}

/** Delay before releasing a download's object URL (the value FileSaver.js uses). */
export const OBJECT_URL_REVOKE_DELAY_MS = 40_000;

function downloadBrowser(filename: string, content: BlobPart, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously after click() can cancel the download before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}

function reportExportError(format: "CSV" | "PDF", error: unknown) {
  console.error(`${format} export failed`, error);
  const reason = error instanceof Error ? error.message : String(error);
  emitAppError(`${format} export failed: ${reason}`);
}

/** Never rejects: failures are reported through the app error banner. */
export async function exportCSV(entries: RankingEntry[], tournamentName: string): Promise<void> {
  try {
    const content = buildRankingCsv(entries);
    const fileName = rankingFileName(tournamentName, "csv");

    if (!isTauriAvailable()) {
      downloadBrowser(fileName, content, "text/csv;charset=utf-8");
      return;
    }

    await saveExport(fileName, new TextEncoder().encode(content));
  } catch (error) {
    reportExportError("CSV", error);
  }
}

/** Never rejects: failures are reported through the app error banner. */
export async function exportPDF(entries: RankingEntry[], { tournamentName, finished }: PdfExportMeta): Promise<void> {
  try {
    // pdf-lib, fontkit and the fonts are only downloaded when a PDF is actually exported.
    const { buildRankingPdf } = await import("./rankingPdf");
    const bytes = await buildRankingPdf(entries, { tournamentName, finished });
    const fileName = rankingFileName(tournamentName, "pdf");

    if (!isTauriAvailable()) {
      downloadBrowser(fileName, bytes.slice().buffer, "application/pdf");
      return;
    }

    await saveExport(fileName, bytes);
  } catch (error) {
    reportExportError("PDF", error);
  }
}
