/** Challenges: hand-made scenarios with first-clear gold. */
import type { AppCtx } from "../../app/ctx";
import { CHALLENGES } from "../../game/challenges";
import { challengesDone } from "../../match/rewards";
import { button } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { mountSubscreen } from "./frame";

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
        "Hand-made battles with fixed decks. Win one for the first time to earn its gold.",
        "معارك مصممة بمجموعات ثابتة. انتصر فيها أول مرة لتربح ذهبها.",
      );
      body.appendChild(intro);
      const list = document.createElement("div");
      list.className = "v2-challenges";
      // The guided tutorial battle is a challenge too, but not a listed one.
      const listed = CHALLENGES.filter((ch) => ch.id !== "tutorial" && !(ch as { hidden?: boolean }).hidden);
      for (const ch of listed) {
        const cleared = done.has(ch.id);
        const row = document.createElement("article");
        row.className = "challenge-row v2-challenge" + (cleared ? " is-done" : "");
        const badge = document.createElement("span");
        badge.className = "v2-challenge-badge";
        badge.innerHTML = icon(cleared ? "check" : "puzzle");
        row.appendChild(badge);
        const info = document.createElement("div");
        info.className = "challenge-info";
        const name = document.createElement("div");
        name.className = "challenge-name";
        name.textContent = tr(ch.name, ch.nameAr);
        const blurb = document.createElement("div");
        blurb.className = "challenge-blurb";
        blurb.textContent = tr(ch.blurb, ch.blurbAr);
        info.append(name, blurb);
        row.appendChild(info);
        const play = button({
          variant: cleared ? "secondary" : "cta",
          icon: "play",
          label: cleared ? tr("Replay", "أعد اللعب") : tr(`Play · +${fmtNum(ch.goldReward)} gold`, `العب (+${fmtNum(ch.goldReward)} ذهب)`),
          ariaLabel: cleared
            ? tr(`Replay challenge ${ch.name}`, `أعد تحدي ${ch.nameAr}`)
            : tr(`Play challenge ${ch.name} for ${ch.goldReward} gold`, `العب تحدي ${ch.nameAr} مقابل ${ch.goldReward} ذهب`),
          onClick: () => ctx.startChallenge(ch),
        });
        play.classList.add("challenge-play");
        row.appendChild(play);
        list.appendChild(row);
      }
      body.appendChild(list);
    },
  });
}
