import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  currencySymbol,
  decimalSeparator,
  moneyFormatter,
  parseMoney,
  rescale,
  sanitizeMoneyText,
  toDecimal,
  toInputText
} from "./money";

const EUR = { code: "EUR", exponent: 2 };
const JPY = { code: "JPY", exponent: 0 };
const KWD = { code: "KWD", exponent: 3 };

describe("parseMoney", () => {
  it("converts major units to minor units without floating point errors", () => {
    expect(parseMoney("19.99", 2)).toBe(1999);
    expect(parseMoney("0.1", 2)).toBe(10);
    expect(parseMoney("0.29", 2)).toBe(29);
    expect(parseMoney("1.15", 2)).toBe(115);
    expect(parseMoney("4.35", 2)).toBe(435);
    expect(parseMoney("110", 2)).toBe(11_000);
    expect(parseMoney("007.50", 2)).toBe(750);
    expect(parseMoney(".5", 2)).toBe(50);
    expect(parseMoney("12.", 2)).toBe(1200);
    expect(parseMoney("1.005", 3)).toBe(1005);
    expect(parseMoney("5000", 0)).toBe(5000);
  });

  it("accepts a comma as the decimal separator", () => {
    expect(parseMoney("1,5", 2)).toBe(150);
    expect(parseMoney(" 12,34 ", 2)).toBe(1234);
  });

  it("keeps every digit up to the largest safe amount", () => {
    expect(parseMoney("90071992547409.91", 2)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoney("9007199254740991", 0)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoney("90071992547409.92", 2)).toBeNull();
    expect(parseMoney("9007199254740992", 0)).toBeNull();
  });

  it("rejects empty, malformed, negative or too precise amounts", () => {
    for (const text of ["", " ", ".", "-1", "1e3", "1.2.3", "abc", "1 000"]) expect(parseMoney(text, 2), text).toBeNull();
    expect(parseMoney("1.005", 2)).toBeNull();
    expect(parseMoney("1.5", 0)).toBeNull();
  });

  it("round-trips through the text shown in a field", () => {
    for (const amount of [0, 1, 10, 99, 100, 1999, 11_000, 123_456_789, Number.MAX_SAFE_INTEGER]) {
      for (const exponent of [0, 2, 3]) {
        expect(parseMoney(toInputText(amount, exponent), exponent)).toBe(amount);
        expect(parseMoney(toDecimal(amount, exponent), exponent)).toBe(amount);
      }
    }
  });
});

describe("money text", () => {
  it("writes minor units as major units", () => {
    expect(toDecimal(1250, 2)).toBe("12.50");
    expect(toDecimal(5, 2)).toBe("0.05");
    expect(toDecimal(500, 0)).toBe("500");
    expect(toDecimal(1, 3)).toBe("0.001");
    expect(toInputText(11_000, 2)).toBe("110");
    expect(toInputText(1250, 2)).toBe("12.50");
    expect(toInputText(null, 2)).toBe("");
    expect(toInputText(Number.NaN, 2)).toBe("");
  });

  it("keeps only what an amount can contain while typing", () => {
    expect(sanitizeMoneyText("€12,345", 2)).toBe("12.34");
    expect(sanitizeMoneyText("1.2.3", 2)).toBe("1.23");
    expect(sanitizeMoneyText("-5a0", 2)).toBe("50");
    expect(sanitizeMoneyText("12.5", 0)).toBe("125");
    expect(sanitizeMoneyText("1234567890123456789", 2)).toBe("123456789012345");
  });

  it("writes the decimal separator of the language in money fields", () => {
    expect(decimalSeparator("en")).toBe(".");
    expect(decimalSeparator("fr")).toBe(",");
    expect(toInputText(1250, 2, ",")).toBe("12,50");
    expect(toInputText(11_000, 2, ",")).toBe("110");
    expect(sanitizeMoneyText("7.5", 2, ",")).toBe("7,5");
    expect(sanitizeMoneyText("7,55", 2, ",")).toBe("7,55");
    expect(parseMoney(toInputText(1250, 2, ","), 2)).toBe(1250);
  });

  it("keeps the amounts typed when the currency changes", () => {
    expect(rescale(10_000, 2, 0)).toBe(100);
    expect(rescale(10_050, 2, 0)).toBe(100);
    expect(rescale(100, 0, 2)).toBe(10_000);
    expect(rescale(1234, 2, 3)).toBe(12_340);
    expect(rescale(Number.NaN, 2, 0)).toBeNaN();
  });
});

describe("currencies", () => {
  it("reads the decimals of a currency from Intl", () => {
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("formats amounts exactly with the tournament currency", () => {
    const eur = moneyFormatter("en", EUR);
    expect(eur(1999)).toBe("€19.99");
    expect(eur(11_000)).toBe("€110.00");
    expect(eur(11_000, { whole: true })).toBe("€110");
    expect(eur(1250, { whole: true })).toBe("€12.50");
    expect(eur(Number.MAX_SAFE_INTEGER)).toBe("€90,071,992,547,409.91");
    expect(moneyFormatter("en", JPY)(123_456)).toBe("¥123,456");
    expect(moneyFormatter("en", KWD)(1005)).toMatch(/^KWD\s1\.005$/);
  });

  it("places the symbol where the locale writes it", () => {
    expect(currencySymbol("en", EUR)).toEqual({ symbol: "€", before: true });
    expect(currencySymbol("fr", EUR)).toEqual({ symbol: "€", before: false });
  });
});
