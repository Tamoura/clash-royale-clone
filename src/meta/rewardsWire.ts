/**
 * Rewards wiring: plugs the reward loop into the app through the hook bus
 * and the UI slots, so no shared screen is edited.
 *
 * - matchStart: remember the chest slots (to count newly earned chests for
 *   the early timers), apply tower flair, add unlocked emotes to the tray.
 * - matchEnd: Crown Pass crowns, Draft runs and road news (settleExtras),
 *   shown on the result screen through registerResultExtra.
 * - Season rollover (checkSeason): archive the pass, queue the season payout.
 * - Home slots: battle-top (rewards inbox, pass pill, road, free chest),
 *   shop (free chest, chest slots with gem skip), events (the pass track),
 *   profile (season history).
 *
 * Storage keys owned here: 'cr-clone-reward-inbox', 'cr-clone-draft-run'.
 */
import type { AppCtx } from "../app/ctx";
import { emit, on, type MatchEndPayload, type MatchStartPayload } from "../app/hooks";
import { registerHomeSlot, registerResultExtra } from "../app/slots";
import type { BattleState } from "../game/battle";
import { setTowerFlair } from "../render3d/scene3d";
import { ARABIC } from "../render3d/theme";
import { button, toast } from "../ui/components";
import { fmtNum } from "../ui/i18n";
import { icon } from "../ui/icons";
import { reducedMotion } from "../ui/prefs";
import { buzz, chestArt, chestLabel, rewardSound } from "../ui/screens/chestReveal";
import { chestSlotsGrid, freeChestTile, grantCurrency, openChestFlow } from "../ui/screens/chests";
import { flairTier, passPill, passTrack, seasonHistory, seasonName } from "../ui/screens/pass";
import { roadButton, roadReached } from "../ui/screens/road";
import { onSeasonRollover } from "./achievements";
import { hasChestsEarned, noteChestsEarned, setChestsEarned, type ChestSlot } from "./chests";
import { readJson, writeJson } from "./kv";
import { loadPass, passProgress, savePass, seasonPayout, towerFlairUnlocked, unlockedEmoteGlyphs } from "./pass";
import { loadRoad } from "./road";
import { DRAFT_RUN_WINS, settleExtras, type SettleExtras } from "./settleExtras";

// ---- Rewards inbox: payouts that wait on the Home screen ---------------------------

export const INBOX_KEY = "cr-clone-reward-inbox";
export const DRAFT_RUN_KEY = "cr-clone-draft-run";

export type InboxItem =
  | { id: string; kind: "chest"; rarity: "free" | "rare"; source: "draft" }
  | { id: string; kind: "season"; key: string; best: number; gold: number };

export function loadInbox(): InboxItem[] {
  const raw = readJson<unknown>(INBOX_KEY, []);
  return Array.isArray(raw)
    ? raw.filter((x): x is InboxItem => !!x && typeof x === "object" && typeof (x as InboxItem).id === "string")
    : [];
}

export function pushInbox(item: InboxItem): void {
  const items = loadInbox();
  if (items.some((i) => i.id === item.id)) return;
  writeJson(INBOX_KEY, [...items, item]);
}

/** Remove and return an inbox item (null when already taken: never pays twice). */
export function takeInbox(id: string): InboxItem | null {
  const items = loadInbox();
  const item = items.find((i) => i.id === id) ?? null;
  if (item) writeJson(INBOX_KEY, items.filter((i) => i.id !== id));
  return item;
}

function loadDraftWins(): number {
  const n = readJson<number>(DRAFT_RUN_KEY, 0);
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

// ---- Season rollover --------------------------------------------------------------
// Registered at import, so it is in place before main.ts runs checkSeason at boot.

onSeasonRollover(({ ended, nextKey }) => {
  loadPass(nextKey); // archives the ended month's pass and starts a fresh one
  pushInbox({ id: `season-${ended.key}`, kind: "season", key: ended.key, best: ended.best, gold: seasonPayout(ended.best) });
});

// ---- Match settlement -----------------------------------------------------------------

let chestSnapshot: (ChestSlot | null)[] | null = null;
const settled = new WeakMap<BattleState, SettleExtras>();

/** Settle the reward extras of one finished match (idempotent per battle). */
function settle(ctx: AppCtx, s: MatchEndPayload): SettleExtras {
  const hit = settled.get(s.battle);
  if (hit) return hit;
  // Chests the built-in settlement just granted: new slot objects.
  if (chestSnapshot) {
    const before = chestSnapshot;
    chestSnapshot = null;
    const added = ctx.meta.profile.chests.filter((c) => c && !before.includes(c)).length;
    if (added > 0) noteChestsEarned(added);
  }
  const res = settleExtras(s, {
    pass: loadPass(ctx.meta.season.key),
    roadClaimed: loadRoad().claimed,
    reached: roadReached(ctx),
    draftWins: loadDraftWins(),
  });
  if (res.passCrownsAdded > 0) savePass(res.pass);
  writeJson(DRAFT_RUN_KEY, res.draftWins);
  if (res.draftReward) {
    pushInbox({ id: `draft-${s.battle.time.toFixed(2)}-${Date.now()}`, kind: "chest", rarity: res.draftReward, source: "draft" });
  }
  settled.set(s.battle, res);
  return res;
}

function line(iconName: Parameters<typeof icon>[0], text: string, cls = ""): HTMLElement {
  const row = document.createElement("div");
  row.className = `rw-result__line ${cls}`.trim();
  row.innerHTML = icon(iconName);
  const span = document.createElement("span");
  span.textContent = text;
  row.appendChild(span);
  return row;
}

/** The result-screen lines: pass crowns, a waiting road reward, the Draft run. */
function resultLines(ctx: AppCtx, s: MatchEndPayload): HTMLElement | null {
  const { tr } = ctx;
  const res = settle(ctx, s);
  const box = document.createElement("div");
  box.className = "rw-result";
  if (ARABIC) box.dir = "rtl";
  if (res.passCrownsAdded > 0) {
    const n = res.passCrownsAdded;
    const p = passProgress(res.pass);
    const row = line("crown-filled", tr(`+${n} Crown Pass`, `+${fmtNum(n)} ${n === 1 ? "تاج" : "تيجان"} في تذكرة التاج`), "rw-result__line--pass");
    const bar = document.createElement("span");
    bar.className = "rw-minibar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.round((p.into / p.need) * 100)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);
    const tag = document.createElement("b");
    tag.className = "rw-result__tag";
    tag.textContent = res.passTierUp
      ? tr(`Tier ${p.tier}!`, `المستوى ${fmtNum(p.tier)}!`)
      : `${fmtNum(p.into)}/${fmtNum(p.need)}`;
    row.appendChild(tag);
    box.appendChild(row);
  }
  if (res.roadNowClaimable.length > 0) {
    box.appendChild(line("trophy", tr("Road reward ready", "مكافأة الطريق جاهزة"), "rw-result__line--road"));
  }
  if (res.draftReward) {
    box.appendChild(line("chest", tr("Draft run complete! A Rare Chest waits at Home", "اكتملت سلسلة الانتقاء! صندوق نادر بانتظارك"), "rw-result__line--draft"));
  } else if (s.kind === "draft" && !s.online && !s.replay && res.draftWins > 0) {
    box.appendChild(
      line("dice", tr(`Draft run: ${res.draftWins}/${DRAFT_RUN_WINS} wins`, `سلسلة الانتقاء: ${fmtNum(res.draftWins)}/${fmtNum(DRAFT_RUN_WINS)} انتصارات`)),
    );
  }
  return box.childElementCount > 0 ? box : null;
}

/**
 * Until the staged result screen (which appends resultExtras itself, on
 * #overlay.v2) lands, show the lines on the current result overlay.
 */
function legacyResult(ctx: AppCtx, s: MatchEndPayload): void {
  const overlay = document.getElementById("overlay");
  if (!overlay || overlay.classList.contains("v2")) return;
  overlay.querySelector(".rw-result")?.remove();
  const el = resultLines(ctx, s);
  if (!el) return;
  el.classList.add("rw-result--legacy");
  const again = overlay.querySelector(".again");
  if (again) overlay.insertBefore(el, again);
  else overlay.appendChild(el);
}

// ---- In-battle unlocks ----------------------------------------------------------------

function applyFlair(ctx: AppCtx): void {
  setTowerFlair(flairTier(ctx.meta.profile.trophies, towerFlairUnlocked()));
}

/** Add the Crown Pass emotes to the emote tray (solo only: online emotes are synced). */
function syncEmoteTray(ctx: AppCtx, s: MatchStartPayload): void {
  const bar = document.getElementById("emotes");
  const tray = bar?.querySelector<HTMLElement>(".emote-tray");
  if (!bar || !tray) return;
  tray.querySelectorAll(".rw-emote").forEach((b) => b.remove());
  if (s.online || s.replay) return;
  for (const glyph of unlockedEmoteGlyphs()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rw-emote";
    b.textContent = glyph;
    b.setAttribute("aria-label", ctx.tr("Crown Pass emote", "تعبير تذكرة التاج"));
    b.addEventListener("click", () => {
      ctx.scene.showEmote(s.mySide, glyph);
      ctx.sound.emotePop();
      bar.classList.remove("open");
      bar.querySelector(".emote-toggle")?.setAttribute("aria-expanded", "false");
      emit("input", { kind: "emote" });
    });
    tray.appendChild(b);
  }
}

// ---- Home slots ---------------------------------------------------------------------

function slotBox(cls: string): HTMLElement {
  const box = document.createElement("div");
  box.className = `rw-home ${cls}` + (reducedMotion() ? " is-calm" : "");
  if (ARABIC) box.dir = "rtl";
  return box;
}

/** A waiting payout on the Battle tab (season reward, Draft run chest). */
function inboxCard(ctx: AppCtx, item: InboxItem, refresh: () => void): HTMLElement {
  const { tr } = ctx;
  const card = document.createElement("div");
  card.className = `rw-inbox rw-inbox--${item.kind}`;
  const art = document.createElement("div");
  art.className = "rw-inbox__art";
  const text = document.createElement("div");
  text.className = "rw-inbox__text";
  const title = document.createElement("b");
  const sub = document.createElement("span");
  text.append(title, sub);
  let cta: HTMLButtonElement;
  if (item.kind === "season") {
    art.innerHTML = icon("trophy");
    title.textContent = tr("Season over!", "انتهى الموسم!");
    sub.textContent = tr(
      `${seasonName(item.key)}: best ${item.best} trophies`,
      `${seasonName(item.key)}: أفضل ${fmtNum(item.best)} كأس`,
    );
    cta = button({
      variant: "cta",
      icon: "coin",
      label: `+${fmtNum(item.gold)}`,
      ariaLabel: tr(`Collect ${item.gold} gold`, `استلم ${fmtNum(item.gold)} ذهبة`),
      onClick: () => {
        const got = takeInbox(item.id);
        if (got?.kind !== "season") return;
        grantCurrency(ctx, got.gold, 0);
        rewardSound(ctx).claim?.();
        buzz("claim");
        toast(tr(`Season reward: +${got.gold} gold`, `مكافأة الموسم: +${fmtNum(got.gold)} ذهبة`), "success");
        refresh();
      },
    });
  } else {
    art.appendChild(chestArt(item.rarity, "rw-chest--mini"));
    title.textContent = tr("Draft run reward", "مكافأة سلسلة الانتقاء");
    sub.textContent = chestLabel(item.rarity, tr);
    cta = button({
      variant: "cta",
      label: tr("Open", "افتح"),
      onClick: () => {
        const got = takeInbox(item.id);
        if (got?.kind !== "chest") return;
        cta.disabled = true;
        void openChestFlow(ctx, { kind: "bonus", rarity: got.rarity }, tr("Draft run reward", "مكافأة سلسلة الانتقاء")).then(refresh);
      },
    });
  }
  card.append(art, text, cta);
  return card;
}

let registered = false;

/** Register the reward loop's hooks and slots (once, after AppCtx exists). */
export function registerRewards(ctx: AppCtx): void {
  if (registered) return;
  registered = true;
  const { meta } = ctx;

  // Players from before the early-chest schedule are not new: seed the
  // counter with the chests they already earned (opened plus held).
  if (!hasChestsEarned()) {
    setChestsEarned(meta.achievements.counters.chests + meta.profile.chests.filter(Boolean).length);
  }
  applyFlair(ctx);

  on("matchStart", (s) => {
    chestSnapshot = meta.profile.chests.slice();
    applyFlair(ctx);
    syncEmoteTray(ctx, s);
    document.querySelector("#overlay .rw-result")?.remove();
  });
  on("matchEnd", (s) => {
    settle(ctx, s);
    legacyResult(ctx, s);
  });
  on("screen", (s) => {
    if (s.id === "home") applyFlair(ctx);
  });
  registerResultExtra((s) => resultLines(ctx, s));

  const refresh = (): void => ctx.openHome();

  registerHomeSlot("battle-top", (host) => {
    const box = slotBox("rw-home--battle");
    for (const item of loadInbox()) box.appendChild(inboxCard(ctx, item, refresh));
    const hub = document.createElement("div");
    hub.className = "rw-hub";
    hub.append(passPill(ctx), roadButton(ctx), freeChestTile(ctx, refresh, true));
    box.appendChild(hub);
    host.appendChild(box);
  });
  registerHomeSlot("shop", (host) => {
    const box = slotBox("rw-home--shop");
    const h = document.createElement("h3");
    h.className = "rw-section";
    h.textContent = ctx.tr("Free chest", "الصندوق المجاني");
    box.append(h, freeChestTile(ctx, refresh));
    const h2 = document.createElement("h3");
    h2.className = "rw-section";
    h2.textContent = ctx.tr("Chest slots", "خانات الصناديق");
    box.append(h2, chestSlotsGrid(ctx, refresh, true));
    host.appendChild(box);
  });
  registerHomeSlot("events", (host) => {
    const box = slotBox("rw-home--events");
    box.appendChild(passTrack(ctx, refresh));
    host.appendChild(box);
  });
  registerHomeSlot("profile", (host) => {
    const box = slotBox("rw-home--profile");
    box.appendChild(seasonHistory(ctx));
    host.appendChild(box);
  });
}
