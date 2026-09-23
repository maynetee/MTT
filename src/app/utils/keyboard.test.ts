import { describe, expect, it } from "vitest";
import { isEditableTarget } from "./keyboard";

function element(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.querySelector("[data-target]") as HTMLElement;
}

describe("isEditableTarget", () => {
  it.each([
    ["an input", `<input data-target />`],
    ["a textarea", `<textarea data-target></textarea>`],
    ["a select", `<select data-target></select>`],
    ["a contenteditable element", `<div contenteditable="true" data-target></div>`],
    ["a child of a contenteditable element", `<div contenteditable><span data-target></span></div>`]
  ])("returns true for %s", (_, html) => {
    expect(isEditableTarget(element(html))).toBe(true);
  });

  it.each([
    ["a button", `<button data-target></button>`],
    ["a plain element", `<div data-target></div>`],
    ["a non-editable island", `<div contenteditable><span contenteditable="false" data-target></span></div>`]
  ])("returns false for %s", (_, html) => {
    expect(isEditableTarget(element(html))).toBe(false);
  });

  it("returns false for the body, the window and a missing target", () => {
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
