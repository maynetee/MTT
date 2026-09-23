import { save } from "@tauri-apps/api/dialog";
import { writeBinaryFile, writeTextFile } from "@tauri-apps/api/fs";
import type { RankingEntry } from "../types";
import { emitAppError, isTauriAvailable } from "../api";
import { rankingStatusLabel } from "./ranking";
import { buildRankingPdf } from "./rankingPdf";

export interface PdfExportMeta {
  tournamentName: string;
  /** Whether the tournament is finished, i.e. whether the ranking is final. */
  finished: boolean;
}

function downloadBrowser(filename: string, content: BlobPart, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function reportExportError(format: "CSV" | "PDF", error: unknown) {
  console.error(`${format} export failed`, error);
  const reason = error instanceof Error ? error.message : String(error);
  emitAppError(`${format} export failed: ${reason}`);
}

/** Never rejects: failures are reported through the app error banner. */
export async function exportCSV(entries: RankingEntry[], tournamentName: string): Promise<void> {
  try {
    const header = "Place,Player,Status\n";
    const rows = entries.map((entry) => {
      const safeName = entry.playerName.replace(/"/g, '""');
      return `${entry.place ?? ""},"${safeName}",${rankingStatusLabel(entry)}`;
    });
    const content = header + rows.join("\n");

    if (!isTauriAvailable()) {
      downloadBrowser(`${tournamentName}-ranking.csv`, content, "text/csv");
      return;
    }

    const path = await save({
      defaultPath: `${tournamentName}-ranking.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });
    if (!path) return;
    await writeTextFile(path, content);
  } catch (error) {
    reportExportError("CSV", error);
  }
}

/** Never rejects: failures are reported through the app error banner. */
export async function exportPDF(entries: RankingEntry[], { tournamentName, finished }: PdfExportMeta): Promise<void> {
  try {
    const bytes = await buildRankingPdf(entries, { tournamentName, finished });

    if (!isTauriAvailable()) {
      downloadBrowser(`${tournamentName}-ranking.pdf`, bytes.slice().buffer, "application/pdf");
      return;
    }

    const path = await save({
      defaultPath: `${tournamentName}-ranking.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (!path) return;
    await writeBinaryFile(path, bytes);
  } catch (error) {
    reportExportError("PDF", error);
  }
}
