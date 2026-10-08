/**
 * Shared menu chrome: the resource bar, the bottom tab bar and the
 * sub-screen frame (mountSubscreen) that hosts Collection, Challenges,
 * Draft, Studio and the deck editor inside the same shell as Home, so
 * navigation looks and works the same everywhere.
 *
 * In the Islamic edition every menu root gets dir="rtl" (the canvas and
 * the battle HUD never do); layout CSS uses logical properties so it
 * mirrors on its own.
 */
import type { AppCtx } from "../../app/ctx";
import { arenaIndexAt } from "../../meta/arenas";
import {
  FEATURE_LABEL,
  featureArena,
  featureUnlocked,
  isNew,
  loadSeen,
  markSeen,
  markToasted,
  pendingToasts,
  reachedArenaIndex,
  saveSeen,
  type Feature,
} from "../../meta/unlocks";
import { ARABIC } from "../../render3d/theme";
import { badge, confirm, screenHeader, sheet, toast, type ConfirmOpts, type SheetOpts } from "../components";
import { fmtNum } from "../i18n";
import { icon, type CrestIndex, type IconName } from "../icons";
import { getPrefs, reducedMotion } from "../prefs";
import { openSettings } from "./settings";
import { startTutorial } from "../tutorialOverlay";
import "../styles/home.css";

export type HomeTab = "shop" | "cards" | "battle" | "events" | "profile";

/** Bottom tabs in visual order (mirrored by dir=rtl in Arabic). */
export const TABS: ReadonlyArray<readonly [HomeTab, IconName, string, string]> = [
  ["shop", "shop", "Shop", "المتجر"],
  ["cards", "cards", "Cards", "البطاقات"],
  ["battle", "sword", "Battle", "قتال"],
  ["events", "events", "Events", "فعاليات"],
  ["profile", "profile", "Profile", "الملف"],
];

let homeTab: HomeTab = "battle";
export const getHomeTab = (): HomeTab => homeTab;
export function setHomeTab(t: HomeTab): void {
  homeTab = t;
}
export const tabIndex = (t: HomeTab): number => TABS.findIndex(([id]) => id === t);

/** Menu roots read right-to-left in the Islamic edition. */
export function applyDir(el: HTMLElement): void {
  if (ARABIC) el.dir = "rtl";
  else el.removeAttribute("dir");
}

/** Mark a root for calm mode (no pulses or slides) when motion is reduced. */
export function applyMotion(el: HTMLElement): void {
  el.classList.toggle("v2-calm", reducedMotion());
}

/** components.confirm(), mirrored for Arabic (it mounts on <body>). */
export function ask(o: ConfirmOpts): Promise<boolean> {
  const p = confirm(o);
  const modals = document.querySelectorAll<HTMLElement>("body > .ui-modal");
  const m = modals[modals.length - 1];
  if (m) applyDir(m);
  return p;
}

/** components.sheet(), mirrored for Arabic and calm when motion is reduced. */
export function openSheet(o: SheetOpts & { className?: string }): { el: HTMLElement; close: () => void } {
  const s = sheet(o);
  applyDir(s.el);
  applyMotion(s.el);
  s.el.classList.add("v2-sheet");
  if (o.className) s.el.classList.add(o.className);
  // Start focus on the panel, not its first control: on touch screens a
  // ringed first button reads as "selected". Tab still enters the panel.
  window.setTimeout(() => {
    const panel = s.el.querySelector<HTMLElement>(".ui-sheet__panel");
    if (panel && s.el.isConnected && panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, 60);
  return s;
}

type UiSound = "uiTap" | "uiBack" | "claim";
/** Optional UI sounds (the audio package adds them; absent = silent). */
export function sfx(ctx: AppCtx, name: UiSound): void {
  try {
    (ctx.sound as unknown as Partial<Record<UiSound, () => void>>)[name]?.();
  } catch {
    // audio is a bonus, never a blocker
  }
}

/** The player's display name (prefs) or the default label. */
export function playerName(ctx: AppCtx): string {
  return getPrefs().playerName || ctx.tr("Player", "لاعب");
}

export function crestIcon(extra = ""): string {
  return icon(`crest-${getPrefs().crest as CrestIndex}`, extra);
}

/** "Arena N" caption for lock badges. */
export function arenaLabel(ctx: AppCtx, n: number): string {
  return ctx.tr(`Arena ${fmtNum(n)}`, `الساحة ${fmtNum(n)}`);
}

/** The trophy-road arena the player stands in now. */
export const currentArenaIndex = (ctx: AppCtx): number => arenaIndexAt(ctx.meta.profile.trophies);

// ---- Feature unlocks -------------------------------------------------------------

/** The highest arena reached (features stay open after a trophy drop). */
export function reachedArena(ctx: AppCtx): number {
  const { profile, achievements, season } = ctx.meta;
  return reachedArenaIndex(profile.trophies, Math.max(achievements.counters.bestTrophies, season.best));
}

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export const isUnlocked = (ctx: AppCtx, f: Feature): boolean => featureUnlocked(f, reachedArena(ctx));

/** Unlocked but never looked at. */
export function isFeatureNew(ctx: AppCtx, f: Feature): boolean {
  const arena = reachedArena(ctx);
  return isNew(f, loadSeen(storage(), arena), arena);
}

/** Clear the NEW badge for these features. */
export function markFeaturesSeen(ctx: AppCtx, fs: readonly Feature[]): void {
  const arena = reachedArena(ctx);
  const st = storage();
  saveSeen(st, markSeen(loadSeen(st, arena), fs, arena));
}

/** One toast per newly unlocked feature, once ever. */
export function toastNewUnlocks(ctx: AppCtx): void {
  const arena = reachedArena(ctx);
  const st = storage();
  const state = loadSeen(st, arena);
  const due = pendingToasts(state, arena);
  if (due.length === 0) return;
  saveSeen(st, markToasted(state, due));
  // Up to two arrive one by one; a bigger jump is summed up in one toast.
  const groups: Feature[][] = due.length <= 2 ? due.map((f) => [f]) : [due];
  groups.forEach((fs, i) => {
    const en = fs.map((f) => FEATURE_LABEL[f][0]).join(", ");
    const ar = fs.map((f) => FEATURE_LABEL[f][1]).join("، ");
    window.setTimeout(() => toast(ctx.tr(`Unlocked: ${en}!`, `فُتح: ${ar}!`), "accent"), 500 + i * 900);
  });
}

/** A small "NEW" pill. */
export const newBadge = (ctx: AppCtx): HTMLElement => {
  const b = badge(ctx.tr("NEW", "جديد"), "accent");
  b.classList.add("v2-new");
  return b;
};

/** A lock pill: lock icon plus "Arena N". */
export function lockBadge(ctx: AppCtx, f: Feature): HTMLElement {
  const b = document.createElement("span");
  b.className = "v2-lock";
  b.innerHTML = icon("lock");
  const t = document.createElement("span");
  t.textContent = arenaLabel(ctx, featureArena(f));
  b.appendChild(t);
  return b;
}

// ---- Resource bar ---------------------------------------------------------------

/**
 * Top bar: the player chip (crest, name, trophies; opens Profile), gold,
 * gems and the Settings gear.
 */
export function buildTopBar(ctx: AppCtx, goTab: (t: HomeTab) => void): HTMLElement {
  const { tr } = ctx;
  const bar = document.createElement("header");
  bar.className = "v2-topbar";

  const me = document.createElement("button");
  me.type = "button";
  me.className = "v2-me";
  me.setAttribute("aria-label", tr("Open your profile", "افتح ملفك"));
  me.addEventListener("click", () => {
    sfx(ctx, "uiTap");
    goTab("profile");
  });
  bar.appendChild(me);

  const res = document.createElement("div");
  res.className = "v2-res";
  bar.appendChild(res);

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "v2-gear";
  gear.innerHTML = icon("settings");
  gear.setAttribute("aria-label", tr("Settings", "الإعدادات"));
  gear.addEventListener("click", () => {
    sfx(ctx, "uiTap");
    openSettings({ onClose: () => refreshTopBars(ctx), onReplayTutorial: () => startTutorial(ctx) });
  });
  bar.appendChild(gear);

  fillTopBar(ctx, bar);
  return bar;
}

function fillTopBar(ctx: AppCtx, bar: HTMLElement): void {
  const { profile } = ctx.meta;
  const me = bar.querySelector<HTMLElement>(".v2-me");
  if (me) {
    me.innerHTML =
      `<span class="v2-me-crest">${crestIcon()}</span>` +
      `<span class="v2-me-text"><b class="v2-me-name"></b>` +
      `<span class="v2-me-trophies">${icon("trophy")}<span>${fmtNum(profile.trophies)}</span></span></span>`;
    me.querySelector(".v2-me-name")!.textContent = playerName(ctx);
  }
  const res = bar.querySelector<HTMLElement>(".v2-res");
  if (res) {
    res.innerHTML =
      `<span class="v2-chip v2-chip--gold" aria-label="${ctx.tr("Gold", "ذهب")}">${icon("coin")}<b>${fmtNum(profile.gold)}</b></span>` +
      `<span class="v2-chip v2-chip--gems" aria-label="${ctx.tr("Gems", "جواهر")}">${icon("gem")}<b>${fmtNum(profile.gems)}</b></span>`;
  }
}

/** Re-read gold, gems, trophies, name and crest into every mounted top bar. */
export function refreshTopBars(ctx: AppCtx): void {
  document.querySelectorAll<HTMLElement>(".v2-topbar").forEach((bar) => fillTopBar(ctx, bar));
}

// ---- Tab bar ------------------------------------------------------------------------

/** The five-tab bar. `active` is null on sub-screens (no tab lit). */
export function buildTabBar(ctx: AppCtx, active: HomeTab | null, pick: (t: HomeTab) => void): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "home-tabs v2-tabs";
  nav.setAttribute("aria-label", ctx.tr("Main menu", "القائمة الرئيسية"));
  for (const [id, ic, en, ar] of TABS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "home-tab" + (id === active ? " active" : "");
    b.dataset.tab = id;
    b.innerHTML = `${icon(ic)}<span>${ctx.tr(en, ar)}</span>`;
    b.setAttribute("aria-current", id === active ? "page" : "false");
    b.addEventListener("click", () => pick(id));
    nav.appendChild(b);
  }
  return nav;
}

// ---- Sub-screen frame ----------------------------------------------------------

export interface SubscreenOpts {
  /** Screen id for the screen hook (e.g. "collection"). */
  id: string;
  title: string;
  /** Fill the scrolling body. */
  build: (body: HTMLElement) => void;
  /** Runs before leaving by Back or a tab (stop previews, save drafts…). */
  onLeave?: () => void;
  /** Where Back goes; default Home. */
  onBack?: () => void;
  /** Pinned under the body, above the tab bar (e.g. a Start button). */
  footer?: HTMLElement;
  /** Element at the header's inline end. */
  trailing?: HTMLElement;
}

/**
 * Render a sub-screen inside the shell: resource bar, a header with a
 * 44px Back button at the inline start, the scrolling body, an optional
 * sticky footer and the tab bar. Shows it as screen `id`.
 */
export function mountSubscreen(ctx: AppCtx, o: SubscreenOpts): { root: HTMLElement; body: HTMLElement } {
  const { pickerRoot, tr } = ctx;
  pickerRoot.innerHTML = "";
  applyDir(pickerRoot);
  const root = document.createElement("div");
  root.className = "v2-screen";
  root.dataset.screen = o.id;
  applyDir(root);
  applyMotion(root);

  const leave = (then: () => void): void => {
    o.onLeave?.();
    then();
  };
  const goTab = (t: HomeTab): void =>
    leave(() => {
      sfx(ctx, "uiTap");
      setHomeTab(t);
      ctx.openHome();
    });

  root.appendChild(buildTopBar(ctx, goTab));
  root.appendChild(
    screenHeader({
      title: o.title,
      backLabel: tr("Back", "رجوع"),
      onBack: () =>
        leave(() => {
          sfx(ctx, "uiBack");
          (o.onBack ?? ctx.openHome)();
        }),
      trailing: o.trailing,
    }),
  );
  const body = document.createElement("div");
  body.className = "v2-screen-body";
  root.appendChild(body);
  o.build(body);
  if (o.footer) {
    o.footer.classList.add("v2-footer");
    root.appendChild(o.footer);
  }
  root.appendChild(buildTabBar(ctx, null, goTab));
  pickerRoot.appendChild(root);
  ctx.showPicker(o.id);
  return { root, body };
}

/** A titled section inside a screen body or tab panel. */
export function section(title: string, extra?: HTMLElement): { el: HTMLElement; head: HTMLElement } {
  const el = document.createElement("section");
  el.className = "v2-section";
  const head = document.createElement("div");
  head.className = "v2-section-head";
  const h = document.createElement("h3");
  h.textContent = title;
  head.appendChild(h);
  if (extra) head.appendChild(extra);
  el.appendChild(head);
  return { el, head };
}

// ---- Claim buttons (quests and achievements) --------------------------------------

export type ClaimState = "locked" | "claimable" | "claimed";

/**
 * A 44px reward button in one of three states: locked (grey with a lock),
 * claimable (gold, pulsing) or claimed (green check).
 */
export function claimButton(ctx: AppCtx, state: ClaimState, reward: number, onClaim: () => void): HTMLButtonElement {
  const { tr } = ctx;
  const b = document.createElement("button");
  b.type = "button";
  b.className = `v2-claim is-${state}`;
  if (state === "claimed") {
    b.innerHTML = icon("check");
    b.disabled = true;
    b.setAttribute("aria-label", tr("Claimed", "تم الاستلام"));
  } else if (state === "claimable") {
    b.innerHTML = `${icon("coin")}<span>${fmtNum(reward)}</span>`;
    b.setAttribute("aria-label", tr(`Claim ${reward} gold`, `استلم ${reward} ذهب`));
    b.addEventListener("click", () => {
      sfx(ctx, "claim");
      onClaim();
    });
  } else {
    b.innerHTML = `${icon("lock")}<span>${fmtNum(reward)}</span>`;
    b.disabled = true;
    b.setAttribute("aria-label", tr(`Locked: ${reward} gold when complete`, `مقفل: ${reward} ذهب عند الإكمال`));
  }
  return b;
}

/** One progress row of a quest or achievement board. */
export function goalRow(label: string, progress: number, target: number, button: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "v2-goal";
  const text = document.createElement("div");
  text.className = "v2-goal-text";
  const l = document.createElement("span");
  l.className = "v2-goal-label";
  l.textContent = label;
  text.appendChild(l);
  const bar = document.createElement("div");
  bar.className = "v2-goal-bar";
  const fill = document.createElement("i");
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress / target)) * 100)}%`;
  bar.appendChild(fill);
  const c = document.createElement("span");
  c.textContent = `${fmtNum(Math.min(target, Math.round(progress)))} / ${fmtNum(target)}`;
  bar.appendChild(c);
  text.appendChild(bar);
  row.append(text, button);
  return row;
}
