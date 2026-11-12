/**
 * Tell the kid when auto difficulty moves. After the solo ladder match that
 * changed the auto tier, the result screen shows one friendly banner:
 * "The bot is getting smarter!" when it steps up, and "The bot will go
 * easier next time" when it steps down. A tier the player picked never
 * moves, so it never shows one.
 *
 * installAutoDifficulty() (difficulty.ts) records the step for the match
 * (noteTierStep) and installs the result-screen slot, so main.ts needs no
 * wiring of its own.
 */
import { registerResultExtra } from "../app/slots";
import type { BattleState } from "../game/battle";
import { ARABIC } from "../render3d/theme";
import { tr } from "../ui/i18n";
import { icon } from "../ui/icons";

export type TierStepDir = "up" | "down";

/** The banner's words, [English, Arabic], per direction. */
export const TIER_STEP_LINES: Record<TierStepDir, readonly [string, string]> = {
  up: ["The bot is getting smarter!", "الروبوت يزداد ذكاءً!"],
  down: ["The bot will go easier next time", "سيكون الروبوت أسهل في المرة القادمة"],
};

/** The banner's line in the current edition. */
export function tierBannerText(step: TierStepDir): string {
  const [en, ar] = TIER_STEP_LINES[step];
  return tr(en, ar);
}

/** The result-screen banner for a step (a rising arrow going up, a heart going down). */
export function tierBannerElement(step: TierStepDir): HTMLElement {
  const box = document.createElement("div");
  box.className = `ui-tier-banner ui-tier-banner--${step}`;
  box.dataset.step = step;
  box.setAttribute("role", "status");
  if (ARABIC) box.dir = "rtl";
  box.insertAdjacentHTML("beforeend", icon(step === "up" ? "upgrade" : "heart"));
  const text = document.createElement("p");
  text.className = "ui-tier-banner__text";
  text.textContent = tierBannerText(step);
  box.appendChild(text);
  return box;
}

/** Steps taken at the end of a match, by the match's battle (the result screen may be built twice). */
const steps = new WeakMap<BattleState, TierStepDir>();

/** Remember that the match on `battle` moved the auto tier. */
export function noteTierStep(battle: BattleState, step: TierStepDir | null): void {
  if (step) steps.set(battle, step);
  else steps.delete(battle);
}

/** The step the match on `battle` took, if any. */
export function tierStepFor(battle: BattleState): TierStepDir | null {
  return steps.get(battle) ?? null;
}

/** Show the banner on the result screen of a match that moved the auto tier. */
export function installTierBanner(): () => void {
  return registerResultExtra((s) => {
    const step = tierStepFor(s.battle);
    return step ? tierBannerElement(step) : null;
  });
}
