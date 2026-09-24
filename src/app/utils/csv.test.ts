import { describe, expect, it } from "vitest";
import type { RankingRow } from "../../engine/types";
import { getI18n } from "../../i18n";
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

function row(player: number, name: string, place: number | null, extra: Partial<RankingRow> = {}): RankingRow {
  return {
    player,
    name,
    alive: place === null,
    seat: place === null ? { table: 1, seat: player } : null,
    place,
    placeTo: null,
    provisional: false,
    inMoney: false,
    entries: 1,
    ...extra
  };
}

describe("buildRankingCsv", () => {
  it("writes a header and one escaped row per player, with a BOM and CRLF line endings", () => {
    const rows = [row(1, "Zoë", null), row(2, "Doe, John", 2), row(3, "=cmd|' /C calc'!A0", 3)];

    expect(buildRankingCsv(rows, null)).toBe(
      "\uFEFF" +
        "Place,Player,Status\r\n" +
        ",Zoë,In play\r\n" +
        '2,"Doe, John",Eliminated\r\n' +
        "3,'=cmd|' /C calc'!A0,Eliminated\r\n"
    );
  });

  it("names the winner and says ties and provisional places", () => {
    const rows = [
      row(1, "Ann", 1, { alive: true }),
      row(2, "Ben", 2, { placeTo: 3 }),
      row(3, "Cat", 2, { placeTo: 3, provisional: true })
    ];

    expect(buildRankingCsv(rows, 1).split("\r\n").slice(1)).toEqual([
      "1,Ann,Winner",
      "2,Ben,Eliminated (tie 2–3)",
      "2,Cat,\"Eliminated (tie 2–3, provisional)\"",
      ""
    ]);
  });

  it("adds the prize in major units when money is tracked", () => {
    const rows = [row(1, "Ann", 1, { alive: true, prize: 75_050 }), row(2, "Ben", 2, { prize: 45_000 }), row(3, "Cat", 3)];

    expect(buildRankingCsv(rows, 1, undefined, { code: "EUR", exponent: 2 }).split("\r\n")).toEqual([
      "\uFEFFPlace,Player,Status,Prize (EUR)",
      "1,Ann,Winner,750.50",
      "2,Ben,Eliminated,450.00",
      "3,Cat,Eliminated,",
      ""
    ]);
  });

  it("writes the header and the statuses in the language of the export", () => {
    const rows = [
      row(1, "Ann", 1, { alive: true, prize: 75_050 }),
      row(2, "Ben", 2, { placeTo: 3 }),
      row(3, "Cat", 2, { placeTo: 3, provisional: true }),
      row(4, "Dan", null, { alive: true })
    ];

    expect(buildRankingCsv(rows, 1, getI18n("fr"), { code: "EUR", exponent: 2 }).split("\r\n")).toEqual([
      "\uFEFFPlace,Joueur,État,Gain (EUR)",
      "1,Ann,Vainqueur,750.50",
      "2,Ben,Éliminé (ex æquo 2e–3e),",
      '2,Cat,"Éliminé (ex æquo 2e–3e, provisoire)",',
      ",Dan,En jeu,",
      ""
    ]);
  });

  it("joins rows of mixed fields", () => {
    expect(toCsvRow([1, "a,b", null, "@x"])).toBe('1,"a,b",,\'@x');
  });
});
