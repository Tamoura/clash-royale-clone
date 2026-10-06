/**
 * Trophy Road: a vertical road from Training Camp (bottom) to the summit
 * (top), split by arena gates named in both editions. Reached nodes pulse
 * until claimed; a marker shows where the player stands. Opened from the
 * Home battle tab (a slot button under the arena banner).
 */
import "../styles/rewards.css";
import type { AppCtx } from "../../app/ctx";
import { ARENAS } from "../../meta/arenas";
import { claim, claimable, loadRoad, nextRoadNode, saveRoad } from "../../meta/road";
import { roadSections, type RoadNode } from "../../meta/roadRewards";
import { ARABIC } from "../../render3d/theme";
import { button, screenHeader, toast } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { reducedMotion } from "../prefs";
import { buzz, chestArt, chestLabel, rewardSound } from "./chestReveal";
import { grantCurrency, openChestFlow } from "./chests";

/** Highest trophies ever reached: road nodes stay reached through season resets. */
export function roadReached(ctx: AppCtx): number {
  const { meta } = ctx;
  return Math.max(meta.profile.trophies, meta.achievements.counters.bestTrophies, meta.season.best);
}

/** Road nodes waiting to be claimed right now. */
export function roadClaimable(ctx: AppCtx): RoadNode[] {
  return claimable(roadReached(ctx), loadRoad().claimed);
}

/** Claim one node: pay gold/gems, then reveal its chest if it has one. */
export async function claimRoadNode(ctx: AppCtx, at: number): Promise<boolean> {
  const { tr } = ctx;
  const res = claim(loadRoad(), at, roadReached(ctx));
  if (!res) return false;
  // Save the claim first: a reload mid-reveal can never pay it twice.
  saveRoad(res.state);
  const n = res.node;
  grantCurrency(ctx, n.gold ?? 0, n.gems ?? 0);
  rewardSound(ctx).claim?.();
  buzz("claim");
  const bits = [n.gold ? `+${fmtNum(n.gold)} ${tr("gold", "ذهب")}` : "", n.gems ? `+${fmtNum(n.gems)} ${tr("gems", "جواهر")}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (bits) toast(bits, "success");
  if (n.chest) await openChestFlow(ctx, { kind: "bonus", rarity: n.chest }, tr("Trophy Road", "طريق الكؤوس"));
  return true;
}

function arenaNumber(id: string): number {
  return ARENAS.findIndex((a) => a.id === id);
}

/** Reward chips for one node (gold, gems, chest art). */
export function nodeRewards(ctx: AppCtx, n: RoadNode): HTMLElement {
  const { tr } = ctx;
  const box = document.createElement("span");
  box.className = "rw-node__rewards";
  if (n.chest) {
    const c = document.createElement("span");
    c.className = "rw-reward rw-reward--chest";
    c.appendChild(chestArt(n.chest, "rw-chest--tiny"));
    c.title = chestLabel(n.chest, tr);
    box.appendChild(c);
  }
  if (n.gold) {
    const g = document.createElement("span");
    g.className = "rw-reward";
    g.innerHTML = `${icon("coin")}<b>${fmtNum(n.gold)}</b>`;
    box.appendChild(g);
  }
  if (n.gems) {
    const g = document.createElement("span");
    g.className = "rw-reward";
    g.innerHTML = `${icon("gem")}<b>${fmtNum(n.gems)}</b>`;
    box.appendChild(g);
  }
  const parts = [
    n.chest ? chestLabel(n.chest, tr) : "",
    n.gold ? `${fmtNum(n.gold)} ${tr("gold", "ذهب")}` : "",
    n.gems ? `${fmtNum(n.gems)} ${tr("gems", "جواهر")}` : "",
  ].filter(Boolean);
  box.setAttribute("aria-label", parts.join(", "));
  return box;
}

// ---- Home entry -------------------------------------------------------------------

/** The Home button into the road: next node, or how many rewards wait. */
export function roadButton(ctx: AppCtx): HTMLElement {
  const { tr } = ctx;
  const ready = roadClaimable(ctx).length;
  const next = nextRoadNode(ctx.meta.profile.trophies);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rw-hubcard rw-hubcard--road" + (ready > 0 ? " is-ready" : "");
  const art = document.createElement("span");
  art.className = "rw-hubcard__art";
  art.innerHTML = icon("trophy");
  const title = document.createElement("b");
  title.textContent = tr("Trophy Road", "طريق الكؤوس");
  const sub = document.createElement("span");
  sub.className = "rw-hubcard__sub";
  sub.textContent =
    ready > 0
      ? tr(ready === 1 ? "1 reward!" : `${ready} rewards!`, `${fmtNum(ready)} مكافأة!`)
      : next
        ? `${tr("Next", "التالي")} ${fmtNum(next.at)}`
        : tr("Road complete", "اكتمل الطريق");
  btn.append(art, title, sub);
  if (ready > 0) {
    const dot = document.createElement("span");
    dot.className = "rw-dot";
    dot.textContent = fmtNum(ready);
    btn.appendChild(dot);
  }
  btn.setAttribute("aria-label", `${tr("Trophy Road", "طريق الكؤوس")}: ${sub.textContent}`);
  btn.addEventListener("click", () => openRoad(ctx));
  return btn;
}

// ---- The road screen -----------------------------------------------------------------

export function openRoad(ctx: AppCtx): void {
  buildRoad(ctx, true);
  ctx.showPicker("road");
}

function buildRoad(ctx: AppCtx, scrollToMarker: boolean): void {
  const { pickerRoot, tr, meta } = ctx;
  const keepScroll = pickerRoot.scrollTop;
  pickerRoot.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "rw-screen rw-road-screen" + (reducedMotion() ? " is-calm" : "");
  if (ARABIC) screen.dir = "rtl";
  pickerRoot.appendChild(screen);

  const trophies = meta.profile.trophies;
  const reached = roadReached(ctx);
  const road = loadRoad();
  const claimedSet = new Set(road.claimed);
  const waiting = claimable(reached, road.claimed);

  const chip = document.createElement("span");
  chip.className = "rw-pill";
  chip.innerHTML = `${icon("trophy")}<b>${fmtNum(trophies)}</b>`;
  screen.appendChild(
    screenHeader({ title: tr("Trophy Road", "طريق الكؤوس"), onBack: () => ctx.openHome(), backLabel: tr("Back", "رجوع"), trailing: chip }),
  );

  const intro = document.createElement("p");
  intro.className = "rw-note";
  const next = nextRoadNode(trophies);
  intro.textContent =
    waiting.length > 0
      ? tr(`${waiting.length} reward${waiting.length === 1 ? "" : "s"} waiting. Tap Claim!`, `${fmtNum(waiting.length)} مكافأة بانتظارك. اضغط استلم!`)
      : next
        ? tr(`Win battles to reach ${next.at} trophies for the next reward.`, `انتصر لتبلغ ${fmtNum(next.at)} كأسًا وتنال المكافأة التالية.`)
        : tr("You reached the end of the road. Legend!", "بلغت نهاية الطريق. أسطورة!");
  screen.appendChild(intro);

  const list = document.createElement("ol");
  list.className = "rw-road";
  list.setAttribute("aria-label", tr("Trophy Road rewards", "مكافآت طريق الكؤوس"));
  screen.appendChild(list);
  const calm = reducedMotion();

  let marker: HTMLElement | null = null;
  const addMarker = (): void => {
    if (marker) return;
    marker = document.createElement("li");
    marker.className = "rw-road__you";
    marker.innerHTML = `<span class="rw-road__youpin">${icon("profile")}</span><span>${tr("You", "أنت")} · ${icon("trophy")} ${fmtNum(trophies)}</span>`;
    list.appendChild(marker);
  };

  // Highest first: the road climbs up the screen.
  const sections = roadSections().slice().reverse();
  for (const sec of sections) {
    const nodes = sec.nodes.slice().reverse();
    for (const n of nodes) {
      if (!marker && trophies >= n.at) addMarker();
      const li = document.createElement("li");
      const done = claimedSet.has(n.at);
      const isReady = !done && n.at <= reached;
      li.className = "rw-node" + (done ? " is-claimed" : isReady ? " is-ready" : " is-locked") + (n.gate ? " is-gate" : "");
      if (calm) li.classList.add("is-calm");
      const dot = document.createElement("span");
      dot.className = "rw-node__dot";
      dot.innerHTML = done ? icon("check") : isReady ? icon("star") : icon("lock");
      const at = document.createElement("span");
      at.className = "rw-node__at";
      at.innerHTML = `${icon("trophy")}<b>${fmtNum(n.at)}</b>`;
      li.append(dot, at, nodeRewards(ctx, n));
      if (isReady) {
        const b = button({
          variant: "cta",
          label: tr("Claim", "استلم"),
          onClick: () => {
            b.disabled = true;
            void claimRoadNode(ctx, n.at).then(() => buildRoad(ctx, false));
          },
        });
        b.classList.add("rw-node__claim");
        li.appendChild(b);
      } else if (done) {
        const tag = document.createElement("span");
        tag.className = "rw-node__state";
        tag.textContent = tr("Claimed", "مُستلَمة");
        li.appendChild(tag);
      }
      list.appendChild(li);
    }
    // The arena's gate banner sits below its nodes (you climb into it).
    const gate = document.createElement("li");
    gate.className = "rw-gate" + (reached >= sec.arena.trophies ? " is-open" : "");
    const num = arenaNumber(sec.arena.id);
    gate.innerHTML =
      `<span class="rw-gate__num">${num === 0 ? tr("Start", "البداية") : `${tr("Arena", "الساحة")} ${fmtNum(num)}`}</span>` +
      `<b class="rw-gate__name"></b>` +
      `<span class="rw-gate__at">${icon("trophy")} ${fmtNum(sec.arena.trophies)}</span>`;
    gate.querySelector(".rw-gate__name")!.textContent = tr(sec.arena.name, sec.arena.ar);
    // Standing between this gate and the section's first node.
    if (!marker && trophies >= sec.arena.trophies) addMarker();
    list.appendChild(gate);
  }
  addMarker();

  // Land on the lowest waiting reward (else the marker), or keep the
  // place after a claim.
  requestAnimationFrame(() => {
    if (!scrollToMarker) {
      pickerRoot.scrollTop = keepScroll;
      return;
    }
    const ready = list.querySelectorAll<HTMLElement>(".rw-node.is-ready");
    const lowestReady = ready.length > 0 ? ready[ready.length - 1] : null;
    (lowestReady ?? marker)?.scrollIntoView({ block: "center", behavior: "auto" });
  });
}
