/**
 * layout.ts predicts the tray's and the hand panel's size from the
 * stylesheet's numbers (the camera frames the board with them before the
 * browser has laid anything out). This reads those numbers back out of
 * styles/hud.css, so a change on either side that the other does not
 * follow fails here instead of putting the board under the hand.
 */
import { describe, expect, it } from "vitest";
// Vitest blanks every stylesheet import (even ?raw), so the file is read from
// disk. The project ships no Node typings (browser code only), hence the directive.
// @ts-expect-error -- "node:fs" has no type declarations here; Vitest runs in Node.
import { readFileSync } from "node:fs";
import { BATTLE_BOX } from "../render3d/scene/fit";
import {
  CARD_ASPECT,
  SIDE_GAP,
  SIDE_MIN,
  SIDE_SLIM,
  cardHeight,
  handGridW,
  handPanelBudget,
  handPanelHeight,
  handPanelInnerW,
  tallLayout,
  trayHeight,
  wideLayout,
} from "./layout";

const hudCss: string = readFileSync(new URL("./styles/hud.css", import.meta.url), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const css = hudCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const selectors = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (!selectors.includes(selector)) continue;
    const out: Record<string, string> = {};
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim().replace(/\s+/g, " ");
    }
    return out;
  }
  throw new Error(`no rule for ${selector}`);
}

/** Every px length in a value, in order ("6px 8px max(10px, env(x))" -> [6, 8, 10]). */
const px = (value: string): number[] => [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
/** What a wide panel's width takes off its column ("calc(var(--side) - 24px)" -> 24). */
const inset = (selector: string): number => px(rule(selector).width)[0];
/** A plain shorthand's lengths, zeros included ("14px 0 6px" -> [14, 0, 6]). */
const lengths = (value: string): number[] => value.split(" ").map((t) => parseFloat(t));

describe("the tray's stylesheet numbers match layout.ts", () => {
  const tray = rule("#hud.v2");
  const card = rule("#hud.v2 button.card");

  it("tall tray: border, padding, the elixir rail and the gap to the cards", () => {
    const [padTop, gutter, padBottom] = px(tray.padding);
    const [rail] = px(tray["grid-template-rows"]);
    const [rowGap] = px(tray.gap);
    const [border] = px(tray["border-top-width"]);
    expect(tray.padding).toContain("env(safe-area-inset-bottom)");
    for (const cw of [56, 66.75, 96]) {
      expect(trayHeight(cw) - cardHeight(cw)).toBe(border + padTop + rail + rowGap + padBottom);
    }
    // The home indicator replaces the bottom padding once it is taller.
    expect(trayHeight(64, { top: 0, left: 0, right: 0, bottom: padBottom + 20 })).toBe(trayHeight(64) + 20);
    expect(trayHeight(64, { top: 0, left: 0, right: 0, bottom: padBottom - 2 })).toBe(trayHeight(64));
    // The row: gutters, then Next, four cards and KING with five gaps between them.
    const [gap] = px(tray["--tray-gap"]);
    expect(tray["grid-template-columns"]).toBe("var(--nw) auto var(--kw)");
    expect(rule("#hud.v2 .hand-row")["grid-template-columns"]).toBe("repeat(4, var(--cw))");
    for (const [w, h] of [[360, 640], [390, 844], [820, 1180]]) {
      const t = tallLayout(w, h);
      expect(t.handW - 4 * t.cardW - t.nextW - t.kingW).toBeCloseTo(2 * gutter + 5 * gap, 9);
    }
    // The elixir rail is one row of the grid, exactly as tall as its bar.
    expect(px(rule("#hud.v2 .elixir-row").height)).toEqual([rail]);
    expect(px(rule("#hud.v2 .elixir-bar").height)).toEqual([rail]);
  });

  it("cards: a 3px border around 4:5 art, sized by the layout's variables", () => {
    const [border] = px(card.border);
    expect(card["box-sizing"]).toBe("border-box");
    expect(card.width).toBe("var(--cw)");
    expect(card.height).toBe("var(--ch)");
    for (const cw of [56, 72, 104]) {
      expect((cardHeight(cw) - 2 * border) / (cw - 2 * border)).toBeCloseTo(CARD_ASPECT, 9);
    }
    // Between battles the tray keeps a phone's sizes (no variables are set).
    const [cw] = px(tray["--cw"]);
    const [ch] = px(tray["--ch"]);
    expect(ch).toBe(cardHeight(cw));
    expect(px(tray["--nw"])[0]).toBe(tallLayout(390, 844).nextW);
    expect(px(tray["--kw"])[0]).toBe(tallLayout(390, 844).kingW);
    // The cost droplet hangs into the tray's bottom padding, not past it.
    const hang = -px(rule("#hud.v2 .card-cost").bottom)[0];
    expect(hang).toBeGreaterThan(0);
    expect(hang).toBeLessThan(px(tray.padding)[2]);
  });

  it("wide panel: its inset, border and padding, the hand's gaps, Next and the elixir row", () => {
    const panel = rule(':root[data-layout="wide"] #hud.v2');
    const [border] = px(panel.border);
    const [padTop, padX, padBottom] = px(panel.padding);
    const [inset] = px(panel.width); // calc(var(--side) - 24px)
    expect(panel.width).toBe(`calc(var(--side) - ${inset}px)`);
    for (const side of [144, 200, 271]) {
      expect(handPanelInnerW(side)).toBe(side - inset - 2 * border - 2 * padX);
    }
    const [gapY, gapX] = px(rule(':root[data-layout="wide"] #hud.v2 .hand-row').gap);
    expect(handGridW(80, 2)).toBe(2 * 80 + gapX);
    expect(handGridW(80, 1)).toBe(80);
    // Inline: Next (margin, mini card, the label tab under it) beside the elixir bar.
    const next = rule(':root[data-layout="wide"] #hud.v2 .hud-next');
    const [nextTop, , nextBottom] = lengths(next.margin);
    const [mini] = px(rule(':root[data-layout="wide"] #hud.v2 .hud-next-art canvas').height);
    const chrome = 2 * border + padTop + padBottom;
    expect(handPanelHeight(80, 2, false)).toBe(chrome + 2 * cardHeight(80) + gapY + nextTop + mini + nextBottom);
    // Its label tab hangs as far under the mini card as the margin leaves room for.
    expect(-px(rule("#hud.v2 .hud-next-label").bottom)[0]).toBeLessThanOrEqual(nextBottom);
    // The elixir row beside it never stands taller than Next.
    const elixir = rule(':root[data-layout="wide"] #hud.v2 .elixir-row');
    expect(px(elixir["margin-top"])[0] + px(elixir.height)[0]).toBeLessThanOrEqual(nextTop + mini + nextBottom);
    // Stacked: the Next row on top, the elixir row at the foot.
    const nextRow = rule(':root[data-layout="wide"][data-panel="stacked"] #hud.v2 .hud-next');
    const [, , headGap] = lengths(nextRow.margin);
    const [miniStacked] = px(rule(':root[data-layout="wide"][data-panel="stacked"] #hud.v2 .hud-next-art canvas').height);
    const [footGap] = px(rule(':root[data-layout="wide"][data-panel="stacked"] #hud.v2 .elixir-row')["margin-top"]);
    const [footH] = px(elixir.height);
    expect(handPanelHeight(80, 2, true)).toBe(chrome + miniStacked + headGap + 2 * cardHeight(80) + gapY + footGap + footH);
    expect(handPanelHeight(80, 1, true)).toBe(chrome + miniStacked + headGap + 4 * cardHeight(80) + 3 * gapY + footGap + footH);
    // The panel keeps 12px from the screen's top and bottom.
    expect(panel.bottom).toBe("max(12px, env(safe-area-inset-bottom))");
    expect(handPanelBudget(600)).toBe(600 - 24);
  });

  it("wide panels hug the board: the column, its inset and the gap the camera keeps", () => {
    // layout.ts: a panel column is `side` wide, the panel itself 12px in from
    // each of its edges; the board's column starts SIDE_GAP past it.
    const lay = wideLayout(1440, 900);
    expect(lay).not.toBeNull();
    if (!lay) return;
    expect(lay.insets.left).toBe(lay.side + SIDE_GAP);
    expect(lay.fieldW).toBe(Math.round(((2 * BATTLE_BOX.halfW) / BATTLE_BOX.height) * 900));
    const hug = rule(':root[data-layout="wide"]')["--hug"];
    expect(hug).toBe("max(12px, calc((100vw - var(--field-w)) / 2 - var(--side) + 12px))");
    // A slim left panel (under SIDE_SLIM) may use the column's inner inset
    // for its clock row, but never more than the column itself.
    expect(SIDE_MIN).toBeLessThan(SIDE_SLIM);
    const [slimInset] = px(rule(':root[data-layout="wide"][data-slim] #topbar.v2').width);
    expect(slimInset).toBeGreaterThanOrEqual(12);
    expect(slimInset).toBeLessThan(inset(':root[data-layout="wide"] #topbar'));
  });
});
