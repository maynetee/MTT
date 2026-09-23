import { describe, expect, it } from "vitest";
import { rankingFileName, sanitizeFileName } from "./fileName";

describe("sanitizeFileName", () => {
  it("removes characters that are invalid on Windows or macOS", () => {
    expect(sanitizeFileName('Main Event: "Day 1" <A/B> | Final? * \\')).toBe("Main Event Day 1 A B Final");
    expect(sanitizeFileName("Tab\there\u0000")).toBe("Tab here");
  });

  it("keeps Unicode letters and common punctuation", () => {
    expect(sanitizeFileName("Kraków Open — Łódź (2026) #3")).toBe("Kraków Open — Łódź (2026) #3");
  });

  it("drops leading dots and trailing dots or spaces", () => {
    expect(sanitizeFileName("..hidden")).toBe("hidden");
    expect(sanitizeFileName("Sunday Major. . ")).toBe("Sunday Major");
  });

  it("avoids Windows reserved device names", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("lpt1.csv")).toBe("_lpt1.csv");
    expect(sanitizeFileName("Console")).toBe("Console");
  });

  it("falls back when nothing is left", () => {
    expect(sanitizeFileName(' <>:"/\\|?* ')).toBe("export");
    expect(sanitizeFileName("...", "MTT")).toBe("MTT");
  });
});

describe("rankingFileName", () => {
  it("builds the export file name from the tournament name", () => {
    expect(rankingFileName("High Roller 10/20", "csv")).toBe("High Roller 10 20-ranking.csv");
    expect(rankingFileName("???", "pdf")).toBe("MTT-ranking.pdf");
  });

  it("truncates very long names without splitting characters", () => {
    expect(rankingFileName("🂡".repeat(150), "pdf")).toBe(`${"🂡".repeat(100)}-ranking.pdf`);
  });
});
