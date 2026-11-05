/**
 * Challenges: hand-made "keep your towers standing" puzzles with
 * first-clear gold. Easiest first (by stars); each row shows its goal
 * ("Survive 0:45"), its stars and a check once cleared. Above them, the
 * card trials: one battle per new card with its portrait, playable while
 * the card is still locked.
 */
import type { AppCtx } from "../../app/ctx";
import { CHALLENGES, TRIAL_CHALLENGES, challengeStars, sortedByStars, type Challenge } from "../../game/challenges";
import { challengesDone } from "../../match/rewards";
import { makeCardCanvas } from "../cardFrame";
import { button } from "../components";
import { fmtNum, fmtTime } from "../i18n";
import { icon } from "../icons";
import { lockInfo } from "../newCards";
import { mountSubscreen } from "./frame";
import "../styles/newcards.css";

/** The goal chip's words: [English, Arabic], e.g. "Survive 0:45". */
export function goalText(ch: Pick<Challenge, "surviveFor">): [string, string] {
  return [`Survive ${fmtTime(ch.surviveFor)}`, `اصمد ${fmtTime(ch.surviveFor)}`];
}

function starsRow(ctx: AppCtx, n: 1 | 2 | 3): HTMLElement {
  const row = document.createElement("span");
  row.className = "v2-challenge-stars";
  row.setAttribute("role", "img");
  row.setAttribute(
    "aria-label",
    ctx.tr(`Difficulty: ${n} of 3 stars`, `الصعوبة: ${fmtNum(n)} من ${fmtNum(3)} نجوم`),
  );
  for (let i = 1; i <= 3; i++) row.insertAdjacentHTML("beforeend", icon("star", i <= n ? "is-on" : "is-off"));
  return row;
}

function chip(cls: string, ic: "shield" | "check" | "lock" | "chest", text: string): HTMLElement {
  const c = document.createElement("span");
  c.className = `v2-challenge-chip ${cls}`;
  c.innerHTML = icon(ic);
  const t = document.createElement("span");
  t.textContent = text;
  c.appendChild(t);
  return c;
}

/** One challenge row: badge (or the trial card's portrait), name, stars, chips, blurb, Play. */
function challengeRow(ctx: AppCtx, ch: Challenge, cleared: boolean): HTMLElement {
  const { tr } = ctx;
  const stars = challengeStars(ch);
  const row = document.createElement("article");
  row.className = "challenge-row v2-challenge" + (cleared ? " is-done" : "") + (ch.trial ? " is-trial" : "");
  row.dataset.id = ch.id;
  row.dataset.stars = String(stars);
  if (ch.trial) {
    const art = makeCardCanvas(ch.trial, { size: 96 });
    art.className = "v2-challenge-card";
    row.appendChild(art);
  } else {
    const badge = document.createElement("span");
    badge.className = "v2-challenge-badge";
    badge.innerHTML = icon(cleared ? "check" : "puzzle");
    row.appendChild(badge);
  }
  const info = document.createElement("div");
  info.className = "challenge-info";
  const head = document.createElement("div");
  head.className = "v2-challenge-head";
  const name = document.createElement("div");
  name.className = "challenge-name";
  name.textContent = tr(ch.name, ch.nameAr);
  head.append(name, starsRow(ctx, stars));
  const chips = document.createElement("div");
  chips.className = "v2-challenge-chips";
  const [goalEn, goalAr] = goalText(ch);
  chips.appendChild(chip("is-goal", "shield", tr(goalEn, goalAr)));
  if (cleared) chips.appendChild(chip("is-cleared", "check", tr("Cleared", "أُنجز")));
  if (ch.trial) {
    const lock = lockInfo(ch.trial, new Set(ctx.meta.profile.owned), ctx.meta.profile.trophies, tr);
    if (lock) chips.appendChild(chip(lock.findable ? "is-findable" : "is-locked", lock.findable ? "chest" : "lock", lock.text));
  }
  const blurb = document.createElement("div");
  blurb.className = "challenge-blurb";
  blurb.textContent = tr(ch.blurb, ch.blurbAr);
  info.append(head, chips, blurb);
  row.appendChild(info);
  const play = button({
    variant: cleared ? "secondary" : "cta",
    icon: "play",
    label: cleared ? tr("Replay", "أعد اللعب") : tr(`Play · +${fmtNum(ch.goldReward)} gold`, `العب (+${fmtNum(ch.goldReward)} ذهب)`),
    ariaLabel: cleared
      ? tr(`Replay challenge ${ch.name}`, `أعد تحدي ${ch.nameAr}`)
      : tr(`Play challenge ${ch.name} for ${ch.goldReward} gold`, `العب تحدي ${ch.nameAr} مقابل ${fmtNum(ch.goldReward)} ذهب`),
    onClick: () => ctx.startChallenge(ch),
  });
  play.classList.add("challenge-play");
  row.appendChild(play);
  return row;
}

function sectionTitle(text: string): HTMLElement {
  const h = document.createElement("h3");
  h.className = "v2-challenge-section";
  h.textContent = text;
  return h;
}

export function openChallenges(ctx: AppCtx): void {
  const { tr } = ctx;
  const done = challengesDone();
  mountSubscreen(ctx, {
    id: "challenges",
    title: tr("Challenges", "التحديات"),
    build: (body) => {
      const intro = document.createElement("p");
      intro.className = "v2-hint";
      intro.textContent = tr(
        "Hand-made battles with fixed decks. Keep every tower standing until the clock runs out. Win one for the first time to earn its gold.",
        "معارك مصممة بمجموعات ثابتة. حافظ على كل أبراجك حتى ينتهي الوقت. انتصر فيها أول مرة لتربح ذهبها.",
      );
      body.appendChild(intro);
      // The card trials lead: try the new cards, locked or not.
      body.appendChild(sectionTitle(tr("Try the new cards", "جرّب البطاقات الجديدة")));
      const trials = document.createElement("div");
      trials.className = "v2-challenges v2-trials";
      for (const ch of TRIAL_CHALLENGES) trials.appendChild(challengeRow(ctx, ch, done.has(ch.id)));
      body.appendChild(trials);
      body.appendChild(sectionTitle(tr("Puzzles", "الألغاز")));
      const list = document.createElement("div");
      list.className = "v2-challenges";
      // The guided tutorial battle is a challenge too, but not a listed one.
      const listed = sortedByStars(
        CHALLENGES.filter((ch) => ch.id !== "tutorial" && !(ch as { hidden?: boolean }).hidden),
      );
      for (const ch of listed) list.appendChild(challengeRow(ctx, ch, done.has(ch.id)));
      body.appendChild(list);
    },
  });
}
