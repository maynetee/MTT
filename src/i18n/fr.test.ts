import { describe, expect, it } from "vitest";
import { formatPlace } from "../app/utils/labels";
import { moneyFormatter } from "../app/utils/money";
import { relativeTime } from "../app/utils/relativeTime";
import { en } from "./en";
import { fr } from "./fr";
import { getI18n } from "./index";
import { createTranslate, type Message, type MessageTree } from "./translate";

const NBSP = "\u00a0";
const NNBSP = "\u202f";
/** Either no-break space: which one Intl puts before a unit or % depends on its CLDR data. */
const NB = "[\u00a0\u202f]";

/** Every message of a dictionary by dotted key. */
function messages(tree: MessageTree, prefix = ""): Map<string, Message> {
  const found = new Map<string, Message>();
  for (const [key, node] of Object.entries(tree)) {
    const path = `${prefix}${key}`;
    const isMessage = typeof node === "string" || (typeof node.one === "string" && typeof node.other === "string");
    if (isMessage) found.set(path, node as Message);
    else for (const [child, message] of messages(node as MessageTree, `${path}.`)) found.set(child, message);
  }
  return found;
}

function texts(message: Message): string[] {
  return typeof message === "string" ? [message] : Object.values(message);
}

/** The `{name}` placeholders of a message, every plural form included. */
function placeholders(message: Message): string[] {
  return [...new Set(texts(message).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1])))].sort();
}

const english = messages(en);
const french = messages(fr);
const fr18n = getI18n("fr");

describe("French messages", () => {
  it("have exactly the keys of the English ones", () => {
    const missing = [...english.keys()].filter((key) => !french.has(key));
    const extra = [...french.keys()].filter((key) => !english.has(key));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    expect(french.size).toBeGreaterThan(700);
  });

  it("use exactly the placeholders of the English ones", () => {
    const mismatches = [...english]
      .filter(([key, message]) => french.has(key) && placeholders(french.get(key)!).join() !== placeholders(message).join())
      .map(([key]) => key);
    expect(mismatches).toEqual([]);
  });

  it("follow French typography", () => {
    const problems: string[] = [];
    for (const [key, message] of french) {
      for (const text of texts(message)) {
        // A no-break space before ":" (but "−1:00" is a time), a narrow one before ; ! ?
        for (const match of text.matchAll(/(.)([:;!?])/g)) {
          const [, before, mark] = match;
          if (mark === ":" && /\d/.test(before)) continue;
          if (before !== (mark === ":" ? NBSP : NNBSP)) problems.push(`${key}: "${before}${mark}"`);
        }
        if (/«(?!\u00a0)|(?<!\u00a0)»/.test(text)) problems.push(`${key}: guillemets need no-break spaces inside`);
        if (/ %/.test(text) || /\d%/.test(text)) problems.push(`${key}: a no-break space before %`);
        if (text.includes("'")) problems.push(`${key}: typographic apostrophe`);
        if (text.includes("...")) problems.push(`${key}: ellipsis character`);
        if (/[“”"]/.test(text)) problems.push(`${key}: guillemets, not quotes`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("never spell a count in a singular form, which French also uses for 0", () => {
    const hardcoded = [...french]
      .filter(([, message]) => typeof message !== "string" && /(^|\D)1(\D|$)/.test(message.one))
      .map(([key]) => key);
    expect(hardcoded).toEqual([]);
  });
});

describe("French plurals", () => {
  it("treat 0 and 1 as singular, from 2 plural", () => {
    expect(fr18n.t("seating.players", { count: 0 })).toBe("0 joueur");
    expect(fr18n.t("seating.players", { count: 1 })).toBe("1 joueur");
    expect(fr18n.t("seating.players", { count: 2 })).toBe("2 joueurs");
    expect(fr18n.t("display.toMoney", { count: 1 })).toBe("1 élimination avant l’argent");
    expect(fr18n.t("display.toMoney", { count: 12 })).toBe("12 éliminations avant l’argent");
    // English keeps 0 plural.
    expect(getI18n("en").t("seating.players", { count: 0 })).toBe("0 players");
  });

  it("still use a zero form when the message has one", () => {
    expect(fr18n.t("presets.breaksCount", { count: 0 })).toBe("aucune pause");
    expect(fr18n.warning({ code: "STRUCTURE_ENDING", params: { levelsLeft: 0 } })).toBe("C’est le dernier niveau de la structure.");
    expect(fr18n.warning({ code: "STRUCTURE_ENDING", params: { levelsLeft: 1 } })).toBe("Plus que 1 niveau dans la structure.");
  });

  it("choose the form with Intl.PluralRules for the language", () => {
    const translate = createTranslate({ n: { one: "{count} un", other: "{count} autres" } }, "fr");
    expect(translate("n", { count: 1.5 })).toBe("1,5 un");
    expect(translate("n", { count: 2 })).toBe("2 autres");
  });

  it("write places as French ordinals", () => {
    expect(formatPlace(fr18n, { place: 1, placeTo: null })).toBe("1er");
    expect(formatPlace(fr18n, { place: 2, placeTo: null })).toBe("2e");
    expect(formatPlace(fr18n, { place: 3, placeTo: 4 })).toBe("3e–4e");
    expect(formatPlace(fr18n, { place: null, placeTo: null })).toBe("—");
  });
});

describe("French formats", () => {
  it("write numbers with a decimal comma and narrow no-break spaces between thousands", () => {
    expect(fr18n.number(1234.5)).toBe(`1${NNBSP}234,5`);
    expect(fr18n.number(1_234_567)).toBe(`1${NNBSP}234${NNBSP}567`);
    expect(fr18n.t("config.capacitySeats", { count: 1200 })).toBe(`1${NNBSP}200 sièges`);
    expect(fr18n.bigBlinds(6250)).toBe("62,5");
    expect(fr18n.percent(0.8)).toMatch(new RegExp(`^80${NB}%$`));
  });

  it("write amounts, times, durations and lists the French way", () => {
    expect(moneyFormatter("fr", { code: "EUR", exponent: 2 })(123_450)).toBe(`1${NNBSP}234,50${NBSP}€`);
    expect(moneyFormatter("fr", { code: "EUR", exponent: 2 })(11_000, { whole: true })).toBe(`110${NBSP}€`);
    expect(fr18n.timeOfDay(new Date(2026, 0, 1, 21, 5).getTime())).toBe("21:05");
    expect(fr18n.durationWords(2 * 3_600_000)).toMatch(new RegExp(`^2${NB}h$`));
    expect(fr18n.durationWords(90 * 60_000)).toMatch(new RegExp(`^90${NB}min$`));
    expect(fr18n.list(["Ann", "Ben", "Cat"])).toBe("Ann, Ben et Cat");
    expect(fr18n.dateTime(new Date(2026, 8, 24, 21, 5).getTime())).toMatch(/^24 sept\. 2026.*21:05$/);
    expect(relativeTime(0, 5 * 60_000, "fr")).toBe("il y a 5 minutes");
  });

  it("translate core errors with their parameters", () => {
    const names = (player: number) => (player === 7 ? "Łukasz" : undefined);
    expect(fr18n.error({ code: "NAME_TAKEN", params: { player: 7 } }, names)).toBe("Łukasz est déjà inscrit.");
    expect(fr18n.error({ code: "SEAT_OCCUPIED", params: { table: 2, seat: 7 } })).toBe(`Le siège 7 de la table 2 est occupé.`);
    expect(fr18n.error({ code: "INVALID_BLINDS", params: { index: 2 } })).toMatch(new RegExp(`^Ligne 3${NBSP}: `));
    expect(fr18n.error({ code: "CONFIG_LOCKED", params: { field: "seatsPerTable" } })).toBe(
      `Le réglage «${NBSP}Sièges par table${NBSP}» ne peut plus changer à ce stade du tournoi.`
    );
    expect(fr18n.error({ code: "INVALID_TIME_ADJUSTMENT", params: { maxMs: 86_400_000 } })).toMatch(
      new RegExp(`^L’horloge peut être décalée d’au plus 24${NB}h à la fois\\.$`)
    );
    expect(fr18n.error({ code: "FROM_THE_FUTURE" } as never)).toBe(`Une erreur est survenue${NBSP}: FROM_THE_FUTURE`);
  });

  it("label undoable actions without eliding before a name", () => {
    const label = { seq: 5, atMs: 0, table: null, kind: "players_busted", names: ["Élodie", "Ben"] };
    expect(fr18n.t("header.undoAction", { action: fr18n.action(label) })).toBe(`Annuler${NBSP}: éliminer Élodie et Ben`);
    expect(fr18n.action({ ...label, kind: "table_broken", names: [], table: 3 })).toBe("casser la table 3");
  });
});
