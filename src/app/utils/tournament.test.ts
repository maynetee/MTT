import { describe, expect, it } from "vitest";
import { formatTime, moneyStatus, playLevelNumber } from "./tournament";

describe("formatTime", () => {
  it("formats seconds as zero-padded minutes and seconds", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(20 * 60)).toBe("20:00");
    expect(formatTime(125 * 60 + 9)).toBe("125:09");
  });
});

describe("playLevelNumber", () => {
  const levels = [
    { index: 0, isBreak: false },
    { index: 1, isBreak: false },
    { index: 2, isBreak: true },
    { index: 3, isBreak: false },
    { index: 4, isBreak: false },
    { index: 5, isBreak: true },
    { index: 6, isBreak: false }
  ];

  it("numbers play levels without counting the breaks before them", () => {
    expect(levels.map((level) => playLevelNumber(levels, level))).toEqual([1, 2, null, 3, 4, null, 5]);
  });

  it("does not depend on the order of the structure", () => {
    expect(playLevelNumber([...levels].reverse(), levels[4])).toBe(4);
  });

  it("gives a level appended to the structure the next play-level number", () => {
    expect(playLevelNumber(levels, { index: levels.length, isBreak: false })).toBe(6);
  });
});

describe("moneyStatus", () => {
  it("counts the eliminations left before every remaining player is paid", () => {
    expect(moneyStatus(20, 9)).toEqual({ kind: "away", text: "11 eliminations to the money" });
    expect(moneyStatus(11, 9)).toEqual({ kind: "away", text: "2 eliminations to the money" });
  });

  it("announces the bubble when one elimination is left", () => {
    expect(moneyStatus(10, 9)).toEqual({ kind: "bubble", text: "Bubble!" });
  });

  it("reports the money once the remaining players are all paid", () => {
    expect(moneyStatus(9, 9)).toEqual({ kind: "itm", text: "In the money" });
    expect(moneyStatus(3, 9)).toEqual({ kind: "itm", text: "In the money" });
  });
});
