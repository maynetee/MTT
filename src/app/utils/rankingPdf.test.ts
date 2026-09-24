import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { RankingRow } from "../../engine/types";
import type { PdfFontLoader } from "./pdfFonts";
import { buildRankingPdf } from "./rankingPdf";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
// Copy the Node Buffer into a Uint8Array of the test environment's realm (jsdom), as fetch() would provide.
const readFont = (name: string) => new Uint8Array(readFileSync(join(fontsDir, name)));

const loadFontsFromDisk: PdfFontLoader = async () => ({
  regular: readFont("Inter-Regular.ttf"),
  bold: readFont("Inter-Bold.ttf")
});

function row(player: number, name: string, place: number | null, placeTo: number | null = null): RankingRow {
  return { player, name, alive: place === null, seat: null, place, placeTo, provisional: false, inMoney: false, entries: 1 };
}

const rows: RankingRow[] = [row(1, "Łukasz", null), row(2, "Zoë", 2), row(3, "Дмитрий", 3, 4), row(4, "Σωκράτης Ğüneş", 3, 4)];

describe("buildRankingPdf", () => {
  it("renders names outside WinAnsi (Polish, Cyrillic, Greek, Turkish) with the embedded font", async () => {
    const loadFonts = vi.fn(loadFontsFromDisk);
    const bytes = await buildRankingPdf(rows, { tournamentName: "Кубок Łodzi", finished: false, winner: null, loadFonts });

    expect(loadFonts).toHaveBeenCalledOnce();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toMatch(/^Ranking — \d{4}-\d{2}-\d{2} \d{2}:\d{2} - Кубок Łodzi$/);
  });

  it("titles a finished tournament's ranking as final", async () => {
    const bytes = await buildRankingPdf(rows, { tournamentName: "Main Event", finished: true, winner: 1, loadFonts: loadFontsFromDisk });

    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Final ranking - Main Event");
  });

  it("paginates long rankings", async () => {
    const many = Array.from({ length: 120 }, (_, index) => row(index + 1, `Игрок ${index + 1}`, index + 1));
    const bytes = await buildRankingPdf(many, { tournamentName: "Deep Stack", finished: true, winner: 1, loadFonts: loadFontsFromDisk });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});
