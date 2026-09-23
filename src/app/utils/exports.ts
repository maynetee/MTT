import { save } from "@tauri-apps/api/dialog";
import { writeBinaryFile, writeTextFile } from "@tauri-apps/api/fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { RankingEntry } from "../types";
import { isTauriAvailable } from "../api";

function downloadBrowser(filename: string, content: BlobPart, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportCSV(entries: RankingEntry[], tournamentName: string) {
  const header = "Place,Player,Status\n";
  const rows = entries.map((entry) => {
    const status = entry.status === "eliminated" ? "Eliminated" : "Active";
    const safeName = entry.playerName.replace(/"/g, '""');
    return `${entry.place},"${safeName}",${status}`;
  });
  const content = header + rows.join("\n");

  if (!isTauriAvailable()) {
    downloadBrowser(`${tournamentName}-ranking.csv`, content, "text/csv");
    return;
  }

  try {
    const path = await save({
      defaultPath: `${tournamentName}-ranking.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });
    if (!path) return;
    await writeTextFile(path, content);
  } catch (err) {
    console.error("Export failed", err);
  }
}

export async function exportPDF(entries: RankingEntry[], tournamentName: string) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  page.drawText("Final Ranking", { x: 40, y, size: 20, font: titleFont, color: rgb(0, 0, 0) });
  y -= 26;
  page.drawText(tournamentName, { x: 40, y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
  y -= 20;

  for (const entry of entries) {
    if (y < 40) {
      y = 800;
      page = pdfDoc.addPage([595, 842]);
    }
    const status = entry.status === "eliminated" ? "Eliminated" : "Active";
    page.drawText(`#${entry.place}  ${entry.playerName}`, { x: 40, y, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText(status, { x: 430, y, size: 12, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 18;
  }

  const bytes = await pdfDoc.save();

  if (!isTauriAvailable()) {
    downloadBrowser(`${tournamentName}-ranking.pdf`, bytes.slice().buffer, "application/pdf");
    return;
  }

  try {
    const path = await save({
      defaultPath: `${tournamentName}-ranking.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (!path) return;
    await writeBinaryFile(path, bytes);
  } catch (err) {
    console.error("Export failed", err);
  }
}
