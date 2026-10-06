/** Challenges: hand-made scenarios with first-clear gold. */
import type { AppCtx } from "../../app/ctx";
import { CHALLENGES } from "../../game/challenges";
import { challengesDone } from "../../match/rewards";

export function openChallenges(ctx: AppCtx): void {
  const { pickerRoot, tr } = ctx;
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = tr("Challenges", "التحديات");
  pickerRoot.appendChild(title);

  const done = challengesDone();
  for (const ch of CHALLENGES) {
    const row = document.createElement("div");
    row.className = "challenge-row";
    const info = document.createElement("div");
    info.className = "challenge-info";
    info.innerHTML =
      `<div class="challenge-name">${done.has(ch.id) ? "✅ " : ""}${tr(ch.name, ch.nameAr)}</div>` +
      `<div class="challenge-blurb">${tr(ch.blurb, ch.blurbAr)}</div>`;
    row.appendChild(info);
    const play = document.createElement("button");
    play.className = "battle-btn challenge-play";
    play.textContent = done.has(ch.id) ? "Replay" : `Play · +${ch.goldReward} 🪙`;
    play.setAttribute("aria-label", `Play challenge ${ch.name}`);
    play.addEventListener("click", () => ctx.startChallenge(ch));
    row.appendChild(play);
    pickerRoot.appendChild(row);
  }

  const back = document.createElement("button");
  back.className = "battle-btn friend";
  back.textContent = tr("← Home", "→ الرئيسية");
  back.addEventListener("click", () => ctx.openHome());
  pickerRoot.appendChild(back);
  ctx.showPicker("challenges");
}
