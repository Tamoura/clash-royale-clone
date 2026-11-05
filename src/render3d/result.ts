/**
 * The match result screen, played as a short timeline: the ribbon drops,
 * each crown fills in turn, trophies and gold count up, the earned chest
 * lands in its slot, then the reward extras other features add. The
 * buttons work from the first frame; the battle report waits, folded, at
 * the bottom. Under reduced motion everything appears at once.
 */
import "../ui/styles/rewards.css";
import { existingSoundEngine } from "../audio/sound";
import type { Side } from "../game/arena";
import { button } from "../ui/components";
import { fmtNum, tr } from "../ui/i18n";
import { icon } from "../ui/icons";
import { reducedMotion } from "../ui/prefs";
import { mountSparkles } from "../ui/sparkles";
import { cardDisplayName } from "../render/cardNames";
import type { Outcome, ResultStats, TimelineLine } from "./hudModel";

export interface ResultData {
  outcome: Outcome;
  myCrowns: number;
  theirCrowns: number;
  myName: string;
  theirName: string;
  /** Trophies won or lost; null when the match was not a ladder match. */
  trophyDelta: number | null;
  /** Gold earned; null or 0 hides the row. */
  goldDelta: number | null;
  /** The chest this match put in a slot, if any. */
  chest: "free" | "rare" | null;
  /** One short line about a special reward ("First clear!"). */
  note: string | null;
  /** Why the match ended this way (a challenge goal, a tower-HP tiebreak), or null. */
  reason?: string | null;
  /** Extra rows from other features (registerResultExtra). */
  extras: HTMLElement[];
  stats: ResultStats;
  timeline: TimelineLine[];
  tip: string | null;
  mySide: Side;
  /** Online match: "Play again" reads "Rematch". */
  online: boolean;
  /** A chest can be opened right now. */
  chestReady: boolean;
}

export interface ResultActions {
  onOk(): void;
  onAgain(): void;
  onOpenChest?(): void;
}

const CROWN_STEP_MS = 250;
const COUNT_MS = 600;
/** A 3-crown win slams its crowns in one by one, slower and harder. */
const SLAM_STEP_MS = 360;

/** How the result screen celebrates: a 3-crown win gets its own show. */
export type Celebration = "three-crowns" | "win" | "none";

export function celebrationFor(outcome: Outcome, myCrowns: number): Celebration {
  if (outcome !== "win") return "none";
  return myCrowns >= 3 ? "three-crowns" : "win";
}

/** Confetti for a celebration: a 3-crown win throws more, bigger pieces with gold crowns among them. */
export function confettiPlan(c: Celebration): { pieces: number; scale: number; crowns: number } {
  if (c === "three-crowns") return { pieces: 84, scale: 1.45, crowns: 10 };
  if (c === "win") return { pieces: 42, scale: 1, crowns: 0 };
  return { pieces: 0, scale: 1, crowns: 0 };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** "+30" / "−20" / "0" with edition digits. */
export function signed(n: number): string {
  const v = Math.round(n);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v))}`;
}

export class ResultScreen {
  private timers: number[] = [];
  private raf = 0;
  private open = false;

  constructor(private readonly root: HTMLElement) {
    root.classList.add("v2");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", tr("Match result", "نتيجة المباراة"));
  }

  get shown(): boolean {
    return this.open;
  }

  hide(): void {
    this.cancel();
    this.open = false;
    this.root.classList.remove("show");
    delete this.root.dataset.kind;
    delete this.root.dataset.celebrate;
    this.root.replaceChildren();
  }

  show(d: ResultData, act: ResultActions): void {
    this.cancel();
    this.open = true;
    const calm = reducedMotion();
    const root = this.root;
    root.replaceChildren();
    root.dataset.kind = d.outcome;
    root.classList.toggle("calm", calm);
    const celebrate = celebrationFor(d.outcome, d.myCrowns);
    if (celebrate === "three-crowns") root.dataset.celebrate = "three";
    else delete root.dataset.celebrate;

    if (d.outcome === "win" && !calm) root.appendChild(this.confetti(confettiPlan(celebrate)));

    const panel = el("div", "res-panel");
    root.appendChild(panel);

    // Ribbon.
    const ribbon = el(
      "div",
      "res-ribbon",
      d.outcome === "win" ? tr("VICTORY", "انتصار") : d.outcome === "loss" ? tr("DEFEAT", "هزيمة") : tr("DRAW", "تعادل"),
    );
    ribbon.setAttribute("role", "heading");
    ribbon.setAttribute("aria-level", "2");
    panel.appendChild(ribbon);

    // "3 CROWNS!": its own banner, stamped in once the third crown lands.
    let three: HTMLElement | null = null;
    if (celebrate === "three-crowns") {
      three = el("div", "res-three");
      three.insertAdjacentHTML("beforeend", icon("crown-filled"));
      three.appendChild(el("span", "res-three__text", tr("3 CROWNS!", "٣ تيجان!")));
      three.insertAdjacentHTML("beforeend", icon("crown-filled"));
      three.setAttribute("role", "status");
      panel.appendChild(three);
    }

    // The why, right under the verdict: kids should never wonder why they lost.
    if (d.reason) {
      const why = el("div", "res-reason");
      why.insertAdjacentHTML("beforeend", icon(d.outcome === "win" ? "star" : "info"));
      const text = el("span", "", d.reason);
      text.dir = "auto";
      why.appendChild(text);
      panel.appendChild(why);
    }

    // Crowns: your row, then theirs, each crown filling in turn.
    const crowns = el("div", "res-crowns");
    const fills: HTMLElement[] = [];
    const row = (name: string, n: number, cls: string): void => {
      const r = el("div", `res-side ${cls}`);
      r.appendChild(el("span", "res-name", name));
      const slots = el("span", "res-crown-slots");
      slots.setAttribute("role", "img");
      slots.setAttribute("aria-label", tr(`${n} of 3 crowns`, `${fmtNum(n)} من ٣ تيجان`));
      for (let i = 0; i < 3; i++) {
        const c = el("span", "res-crown");
        c.innerHTML = icon("crown-empty");
        slots.appendChild(c);
        if (i < n) fills.push(c);
      }
      r.appendChild(slots);
      crowns.appendChild(r);
    };
    row(d.myName, d.myCrowns, "me");
    row(d.theirName, d.theirCrowns, "them");
    panel.appendChild(crowns);

    // Trophies and gold.
    const counters: { node: HTMLElement; to: number }[] = [];
    const rewards = el("div", "res-rewards");
    const reward = (iconName: "trophy" | "coin", value: number, label: string, cls: string): void => {
      const r = el("div", `res-reward ${cls}`);
      r.setAttribute("aria-label", `${label} ${signed(value)}`);
      r.insertAdjacentHTML("beforeend", icon(iconName));
      const num = el("b", "res-num", calm ? signed(value) : signed(0));
      r.appendChild(num);
      rewards.appendChild(r);
      counters.push({ node: num, to: value });
    };
    if (d.trophyDelta !== null) {
      reward("trophy", d.trophyDelta, tr("Trophies", "الكؤوس"), d.trophyDelta < 0 ? "down" : "up");
    }
    if (d.goldDelta) reward("coin", d.goldDelta, tr("Gold", "الذهب"), "up");
    if (counters.length) panel.appendChild(rewards);

    // The chest that just landed in a slot.
    let chestEl: HTMLElement | null = null;
    if (d.chest) {
      chestEl = el("div", `res-chest ${d.chest}`);
      const slot = el("span", "res-chest-slot");
      slot.innerHTML = icon("chest");
      const text = el("span", "res-chest-text");
      text.appendChild(el("b", "", d.chest === "rare" ? tr("Rare Chest", "صندوق نادر") : tr("Wooden Chest", "صندوق خشبي")));
      text.appendChild(el("small", "", tr("Added to your chest slots", "أُضيف إلى خانات صناديقك")));
      chestEl.append(slot, text);
      panel.appendChild(chestEl);
    }

    if (d.note) panel.appendChild(el("div", "res-note", d.note));

    if (d.extras.length) {
      const extras = el("div", "res-extras");
      extras.append(...d.extras);
      panel.appendChild(extras);
    }

    // Buttons: the next step is always one tap away.
    const actions = el("div", "res-actions");
    if (d.chestReady && act.onOpenChest) {
      const open = button({ variant: "cta", size: "lg", icon: "chest", label: tr("Open chest", "افتح الصندوق"), onClick: () => act.onOpenChest?.() });
      open.classList.add("res-open-chest");
      actions.appendChild(open);
    }
    const again = button({
      variant: "secondary",
      size: "lg",
      label: d.online ? tr("Rematch", "مباراة ثأرية") : tr("Play again", "العب مجددًا"),
      onClick: () => act.onAgain(),
    });
    again.classList.add("res-again");
    const ok = button({ variant: "primary", size: "lg", label: tr("OK", "حسنًا"), onClick: () => act.onOk() });
    ok.classList.add("res-ok");
    const pair = el("div", "res-pair");
    pair.append(again, ok);
    actions.appendChild(pair);
    panel.appendChild(actions);

    panel.appendChild(this.report(d));

    root.classList.add("show");
    ok.focus({ preventScroll: true });

    // ---- Timeline
    if (calm) {
      for (const c of fills) this.fill(c, false);
      three?.classList.add("in");
      if (chestEl) chestEl.classList.add("in");
      return;
    }
    let t = 280; // after the ribbon lands
    if (celebrate === "three-crowns") {
      // Mine slam in one by one (the panel thumps), then the banner and a burst.
      const mine = fills.slice(0, Math.min(3, d.myCrowns));
      const rest = fills.slice(mine.length);
      t += 120;
      mine.forEach((c, i) => {
        this.later(t, () => {
          this.fill(c, true, "slam");
          panel.classList.remove("is-thump");
          void panel.offsetWidth;
          panel.classList.add("is-thump");
          if (i === mine.length - 1) {
            try {
              existingSoundEngine()?.sting("legendary");
            } catch {
              // a celebration without sound is still a celebration
            }
          }
        });
        t += SLAM_STEP_MS;
      });
      const node = three;
      this.later(t, () => {
        node?.classList.add("in");
        mountSparkles(root, { count: 28, seed: 33, mode: "burst", className: "res-three-sparks", lifeMs: 1500 });
      });
      t += 420;
      for (const c of rest) {
        this.later(t, () => this.fill(c, true));
        t += CROWN_STEP_MS;
      }
    } else {
      for (const c of fills) {
        this.later(t, () => this.fill(c, true));
        t += CROWN_STEP_MS;
      }
    }
    if (counters.length) {
      this.later(t, () => this.countUp(counters));
      t += COUNT_MS;
    }
    if (chestEl) {
      const node = chestEl;
      this.later(t, () => node.classList.add("in"));
    }
  }

  private report(d: ResultData): HTMLElement {
    const det = el("details", "res-report");
    det.appendChild(el("summary", "", tr("Battle report", "تقرير المعركة")));
    const body = el("div", "res-report-body");
    const s = d.stats;
    const table = el("div", "res-stats");
    const head = el("div", "res-stat res-stat-head");
    head.append(el("span", "mine", d.myName), el("span", ""), el("span", "theirs", d.theirName));
    table.appendChild(head);
    const line = (label: string, mine: number, theirs: number): void => {
      const r = el("div", "res-stat");
      r.append(el("span", "mine", fmtNum(mine)), el("label", "", label), el("span", "theirs", fmtNum(theirs)));
      table.appendChild(r);
    };
    line(tr("Damage", "الضرر"), s.me.damage, s.them.damage);
    line(tr("Elixir spent", "الإكسير المصروف"), s.me.spent, s.them.spent);
    line(tr("Elixir leaked", "الإكسير المهدور"), s.me.leaked, s.them.leaked);
    if (s.me.collected > 0 || s.them.collected > 0) {
      line(tr("Elixir collected", "الإكسير المجموع"), s.me.collected, s.them.collected);
    }
    body.appendChild(table);

    if (s.leaders.length) {
      body.appendChild(el("div", "res-sub", tr("Damage leaders", "الأكثر ضررًا")));
      const max = s.leaders[0].damage || 1;
      s.leaders.forEach((l, i) => {
        const r = el("div", "res-leader");
        const name = el("span", "res-leader-name");
        if (i === 0) name.insertAdjacentHTML("beforeend", icon("crown"));
        name.appendChild(document.createTextNode(cardDisplayName(l.id)));
        const bar = el("span", "res-leader-bar");
        const fill = el("i", "");
        fill.style.setProperty("--w", String(Math.round((l.damage / max) * 100)));
        bar.appendChild(fill);
        r.append(name, bar, el("span", "res-leader-num", fmtNum(l.damage)));
        body.appendChild(r);
      });
    }

    if (d.timeline.length) {
      body.appendChild(el("div", "res-sub", tr("Towers", "الأبراج")));
      for (const l of d.timeline) {
        const r = el("div", `res-tl ${l.mine ? "lost" : "took"}`);
        r.insertAdjacentHTML("beforeend", icon(l.mine ? "shield" : "sword"));
        r.appendChild(el("span", "", l.text));
        body.appendChild(r);
      }
    }

    if (d.tip) {
      const tip = el("div", "res-tip");
      tip.insertAdjacentHTML("beforeend", icon("info"));
      const text = el("span", "");
      text.appendChild(el("b", "", tr("Tip", "نصيحة")));
      text.appendChild(document.createTextNode(` ${d.tip}`));
      tip.appendChild(text);
      body.appendChild(tip);
    }
    det.appendChild(body);
    return det;
  }

  private fill(c: HTMLElement, animate: boolean, how: "pop" | "slam" = "pop"): void {
    c.innerHTML = icon("crown-filled");
    c.classList.add("filled");
    if (animate) c.classList.add(how);
  }

  private countUp(items: { node: HTMLElement; to: number }[]): void {
    const start = performance.now();
    const step = (): void => {
      // Wall-clock progress (rAF timestamps can trail performance.now()).
      const k = Math.min(1, Math.max(0, (performance.now() - start) / COUNT_MS));
      const e = 1 - (1 - k) * (1 - k) * (1 - k); // ease-out cubic
      for (const it of items) it.node.textContent = signed(it.to * e);
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private cancel(): void {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    cancelAnimationFrame(this.raf);
  }

  private confetti(plan: { pieces: number; scale: number; crowns: number }): HTMLElement {
    const box = el("div", "confetti-box");
    box.setAttribute("aria-hidden", "true");
    const colors = ["#f6c14e", "#3b82f6", "#ef4444", "#66bb6a", "#e879d0", "#fff"];
    for (let i = 0; i < plan.pieces; i++) {
      const p = el("span", "confetti");
      p.style.left = `${(i * 137.5) % 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${(i % 7) * 0.35}s`;
      p.style.animationDuration = `${2.4 + ((i * 13) % 10) * 0.18}s`;
      p.style.width = `${Math.round((7 + (i % 3) * 3) * plan.scale)}px`;
      p.style.height = `${Math.round((10 + ((i * 5) % 3) * 4) * plan.scale)}px`;
      box.appendChild(p);
    }
    // Gold crowns tumble down with the paper on a 3-crown win.
    for (let i = 0; i < plan.crowns; i++) {
      const c = el("span", "confetti confetti--crown");
      c.innerHTML = icon("crown-filled");
      c.style.left = `${(i * 97.3 + 5) % 96}%`;
      c.style.animationDelay = `${0.4 + (i % 5) * 0.5}s`;
      c.style.animationDuration = `${3 + (i % 4) * 0.35}s`;
      box.appendChild(c);
    }
    return box;
  }
}
