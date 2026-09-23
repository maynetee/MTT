import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { RankingEntry } from "../types";
import type { PdfFontLoader } from "./pdfFonts";
import { buildRankingPdf } from "./rankingPdf";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
// Copy the Node Buffer into a Uint8Array of the test environment's realm (jsdom), as fetch() would provide.
const readFont = (name: string) => new Uint8Array(readFileSync(join(fontsDir, name)));

const loadFontsFromDisk: PdfFontLoader = async () => ({
  regular: readFont("Inter-Regular.ttf"),
  bold: readFont("Inter-Bold.ttf")
});

const entries: RankingEntry[] = [
  { place: null, playerId: 1, playerName: "Łukasz", status: "active", eliminatedAt: null },
  { place: 2, playerId: 2, playerName: "Zoë", status: "eliminated", eliminatedAt: 2_000 },
  { place: 3, playerId: 3, playerName: "Дмитрий", status: "eliminated", eliminatedAt: 1_000 },
  { place: 4, playerId: 4, playerName: "Σωκράτης Ğüneş", status: "eliminated", eliminatedAt: 500 }
];

describe("buildRankingPdf", () => {
  it("renders names outside WinAnsi (Polish, Cyrillic, Greek, Turkish) with the embedded font", async () => {
    const loadFonts = vi.fn(loadFontsFromDisk);
    const bytes = await buildRankingPdf(entries, { tournamentName: "Кубок Łodzi", finished: false, loadFonts });

    expect(loadFonts).toHaveBeenCalledOnce();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toMatch(/^Ranking — \d{4}-\d{2}-\d{2} \d{2}:\d{2} - Кубок Łodzi$/);
  });

  it("titles a finished tournament's ranking as final", async () => {
    const bytes = await buildRankingPdf(entries, { tournamentName: "Main Event", finished: true, loadFonts: loadFontsFromDisk });

    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Final ranking - Main Event");
  });

  it("paginates long rankings", async () => {
    const many: RankingEntry[] = Array.from({ length: 120 }, (_, index) => ({
      place: index + 1,
      playerId: index + 1,
      playerName: `Игрок ${index + 1}`,
      status: "eliminated",
      eliminatedAt: 10_000 - index
    }));
    const bytes = await buildRankingPdf(many, { tournamentName: "Deep Stack", finished: true, loadFonts: loadFontsFromDisk });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});
