import { $, browser, expect } from "@wdio/globals";
import { relaunchApp } from "./app";

/**
 * One director session in the real desktop app, step by step: each test starts where the
 * previous one left off. Fictional names only.
 */
const TOURNAMENT = "Desktop Smoke — Øresund";
const PLAYERS = ["Ingrid Solberg", "Thanh Hà Nguyễn", "Łukasz Nowak"];

const TIME = /(?:\d+:)?\d{1,2}:\d{2}/;

/** Seconds shown by the clock in `text` (`12:34` or `1:02:03`). */
function seconds(text: string): number {
  const match = TIME.exec(text);
  if (!match) throw new Error(`no clock time in "${text}"`);
  return match[0].split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clockPod = () => $('[role="group"][aria-label="Tournament clock"]');
const stat = (label: string) => $(`//dt[normalize-space()="${label}"]/following-sibling::dd[1]`);
const button = (name: string) => $(`//button[normalize-space()="${name}" or @aria-label="${name}"]`);

async function openTab(label: string) {
  await $('nav[aria-label="Tournament sections"]').$(`a=${label}`).click();
  await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`/${label.toLowerCase()}`), {
    timeoutMsg: `the ${label} tab did not open`
  });
}

describe("MTT Tournament Director (desktop)", () => {
  it("opens its window on an empty tournament list", async () => {
    await expect(browser).toHaveTitle("MTT Tournament Director");
    expect(await browser.getWindowHandles()).toEqual(["main"]);
    await expect($("p=No tournament yet")).toBeDisplayed();
  });

  it("creates a tournament", async () => {
    await $("a=New tournament").click();
    await expect($("h1=New tournament")).toBeDisplayed();
    await $("aria/Name").setValue(TOURNAMENT);
    await $("aria/Tables").setValue("2");
    await $("aria/Seats per table").setValue("6");
    await button("Create tournament").click();
    await expect($(`h1=${TOURNAMENT}`)).toBeDisplayed();
    await expect(browser).toHaveUrl(expect.stringMatching(/#\/t\/[^/]+\/registration$/));
  });

  it("registers three players", async () => {
    const name = $("aria/Player name");
    for (const player of PLAYERS) {
      await name.setValue(player);
      await button("Register").click();
      await expect(name).toHaveValue("");
      await expect($(`//table//td[normalize-space()="${player}"]`)).toBeDisplayed();
    }
    await expect(stat("Registered")).toHaveText("3");
  });

  it("runs the clock in real time", async () => {
    await clockPod().$("button=Start").click();
    await expect(clockPod()).toHaveText(expect.stringContaining("Running"));
    const before = seconds(await clockPod().getText());
    await sleep(3_000);
    const elapsed = before - seconds(await clockPod().getText());
    expect(elapsed).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThanOrEqual(4);
  });

  it("eliminates a player, then undoes it", async () => {
    await openTab("Players");
    await button("Eliminate Łukasz Nowak").click();
    const row = $('//tr[th[normalize-space()="Łukasz Nowak"]]');
    await expect(row).toHaveText(expect.stringContaining("Eliminated"));
    await expect(stat("Eliminated")).toHaveText("1");

    await button("Undo eliminate Łukasz Nowak").click();
    await expect(row).toHaveText(expect.stringContaining("In play"));
    await expect(button("Eliminate Łukasz Nowak")).toBeDisplayed();
    await expect(stat("Eliminated")).toHaveText("0");
  });

  it("opens the display window and leaves it with its exit control", async () => {
    await openTab("Display");
    await button("Open display window").click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).includes("display"), {
      timeoutMsg: "the display window did not open"
    });
    await browser.switchToWindow("display");
    try {
      await expect(browser).toHaveUrl(expect.stringMatching(/#\/display\/[^/]+$/));
      // Whatever its layout, the display shows the time left and the level.
      const time = $(`//body//*[not(*)][string-length(normalize-space()) > 3][translate(normalize-space(), "0123456789", "") = ":"]`);
      await expect(time).toBeDisplayed();
      expect(seconds(await time.getText())).toBeGreaterThan(0);
      await expect($("body")).toHaveText(expect.stringMatching(/Level 1(?!\d)/i));

      // The exit control shows when the mouse moves.
      await browser.action("pointer").move({ x: 200, y: 200 }).move({ x: 400, y: 300 }).perform();
      const exit = $(`//button[contains(translate(concat(normalize-space(), " ", @aria-label), "EXIT", "exit"), "exit")]`);
      await expect(exit).toBeDisplayed();
      await exit.click();
      await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes("display"), {
        timeoutMsg: "the display window did not close"
      });
    } finally {
      await browser.switchToWindow("main");
    }
    await expect(browser).toHaveTitle("MTT Tournament Director");
  });

  it("keeps the tournament after a restart", async () => {
    // Quitting: the app exits with its last window.
    await browser.closeWindow().catch(() => undefined);
    await relaunchApp();
    await browser.reloadSession();

    await expect(browser).toHaveTitle("MTT Tournament Director");
    const row = $(`//tr[th[normalize-space()="${TOURNAMENT}"]]`);
    await expect(row).toHaveText(expect.stringContaining("In progress"));
    await row.$(`aria/Open ${TOURNAMENT}`).click();
    await expect($(`h1=${TOURNAMENT}`)).toBeDisplayed();
    await expect(stat("Registered")).toHaveText("3");
    await expect(clockPod()).toHaveText(expect.stringContaining("Running"));
    await openTab("Players");
    for (const player of PLAYERS) await expect(button(`Eliminate ${player}`)).toBeDisplayed();
  });
});
