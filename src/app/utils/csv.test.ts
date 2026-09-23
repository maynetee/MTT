import { describe, expect, it } from "vitest";
import type { RankingEntry } from "../types";
import { buildRankingCsv, escapeCsvField, toCsvRow } from "./csv";

describe("escapeCsvField", () => {
  it("leaves plain values untouched", () => {
    expect(escapeCsvField("Łukasz")).toBe("Łukasz");
    expect(escapeCsvField("Anne Marie")).toBe("Anne Marie");
    expect(escapeCsvField(12)).toBe("12");
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes fields containing commas, quotes or line breaks", () => {
    expect(escapeCsvField("Doe, John")).toBe('"Doe, John"');
    expect(escapeCsvField('John "The Rock" Doe')).toBe('"John ""The Rock"" Doe"');
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvField("line\r\nbreak")).toBe('"line\r\nbreak"');
  });

  it.each([
    ["=HYPERLINK(\"http://evil\")", "\"'=HYPERLINK(\"\"http://evil\"\")\""],
    ["+1+2", "'+1+2"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A2)", "'@SUM(A1:A2)"],
    ["\t=1+1", "'\t=1+1"],
    ["\r=1+1", "\"'\r=1+1\""],
    ["=1+1,2", "\"'=1+1,2\""]
  ])("neutralizes formula injection in %j", (input, expected) => {
    expect(escapeCsvField(input)).toBe(expected);
  });

  it("only neutralizes a formula character at the start of the field", () => {
    expect(escapeCsvField("Jean-Luc")).toBe("Jean-Luc");
    expect(escapeCsvField("a=b")).toBe("a=b");
  });
});

describe("buildRankingCsv", () => {
  it("writes a header and one escaped row per entry, with a BOM and CRLF line endings", () => {
    const entries: RankingEntry[] = [
      { place: null, playerId: 1, playerName: "Zoë", status: "active", eliminatedAt: null },
      { place: 2, playerId: 2, playerName: "Doe, John", status: "eliminated", eliminatedAt: 2 },
      { place: 3, playerId: 3, playerName: "=cmd|' /C calc'!A0", status: "eliminated", eliminatedAt: 1 }
    ];

    expect(buildRankingCsv(entries)).toBe(
      "﻿" +
        "Place,Player,Status\r\n" +
        ",Zoë,In play\r\n" +
        '2,"Doe, John",Eliminated\r\n' +
        "3,'=cmd|' /C calc'!A0,Eliminated\r\n"
    );
  });

  it("joins rows of mixed fields", () => {
    expect(toCsvRow([1, "a,b", null, "@x"])).toBe('1,"a,b",,\'@x');
  });
});
