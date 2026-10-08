/**
 * Crown Pass screens: the progress pill on the Battle tab, the horizontal
 * 30-tier track on the Events tab (and its own screen), the shard picker,
 * and the season history on the Profile tab. Claims pay at once; chests
 * open with the full reveal.
 */
import "../styles/rewards.css";
import type { AppCtx } from "../../app/ctx";
import { getCard, type CardId } from "../../game/cards";
import { addShards } from "../../meta/collection";
import {
  PASS_TIERS,
  claimTier,
  claimableTiers,
  loadPass,
  nextPassEmote,
  passProgress,
  passRewards,
  savePass,
  seasonDaysLeft,
  shardChoices,
  unlockNextEmote,
  unlockTowerFlair,
  type PassReward,
  type PassState,
} from "../../meta/pass";
import { cardDisplayName } from "../../render/cardNames";
import { setTowerFlair } from "../../render3d/scene3d";
import { ARABIC } from "../../render3d/theme";
import { makeCardCanvas } from "../cardFrame";
import { button, screenHeader, sheet, toast } from "../components";
import { fmtNum } from "../i18n";
import { icon } from "../icons";
import { reducedMotion } from "../prefs";
import { buzz, chestArt, chestLabel, rarityLabel, rewardSound } from "./chestReveal";
import { grantCurrency, openChestFlow } from "./chests";

/** The pass for the current season (the season key checked at boot). */
export function currentPass(ctx: AppCtx): PassState {
  return loadPass(ctx.meta.season.key);
}

/** "October 2026" / "أكتوبر ٢٠٢٦" for a season key. */
export function seasonName(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  try {
    return new Date(y, m - 1, 1).toLocaleDateString(ARABIC ? "ar-EG" : "en", { month: "long", year: "numeric" });
  } catch {
    return key;
  }
}

/** Highest flair tier from trophies (600 gilded, 1200 jeweled) or the pass. */
export function flairTier(trophies: number, passFlair: number): number {
  return Math.max(trophies >= 1200 ? 2 : trophies >= 600 ? 1 : 0, passFlair);
}

function rewardLabel(r: PassReward, tr: AppCtx["tr"]): string {
  switch (r.kind) {
    case "gold":
      return tr("Gold", "ذهب");
    case "gems":
      return tr("Gems", "جواهر");
    case "chest":
      return chestLabel(r.chest, tr);
    case "shards":
      return tr("Shards of your choice", "شظايا من اختيارك");
    case "flair":
      return r.tier === 2 ? tr("Jeweled towers", "أبراج مرصّعة") : tr("Gilded towers", "أبراج مذهّبة");
    case "emote":
      return tr("New emote", "تعبير جديد");
  }
}

/** The visual for one reward inside a tier tile. */
function rewardArt(r: PassReward): HTMLElement {
  const art = document.createElement("span");
  art.className = `rw-tier__art rw-tier__art--${r.kind}`;
  switch (r.kind) {
    case "gold":
      art.innerHTML = `${icon("coin")}<b>${fmtNum(r.amount)}</b>`;
      break;
    case "gems":
      art.innerHTML = `${icon("gem")}<b>${fmtNum(r.amount)}</b>`;
      break;
    case "chest":
      art.appendChild(chestArt(r.chest, "rw-chest--tiny"));
      break;
    case "shards":
      art.innerHTML = `${icon("cards")}<b>+${fmtNum(r.amount.common)}</b>`;
      break;
    case "flair":
      art.innerHTML = `${icon("crown")}<b>${r.tier === 2 ? "II" : "I"}</b>`;
      break;
    case "emote": {
      // An emote is the emoji itself: show the one this tier unlocks.
      const next = nextPassEmote();
      art.innerHTML = next ? `<span class="rw-tier__emote">${next.glyph}</span>` : icon("heart");
      break;
    }
  }
  return art;
}

// ---- Claiming -----------------------------------------------------------------

/** Pick one of three owned cards for a shard reward; resolves null if dismissed. */
function pickShardCard(ctx: AppCtx, t: number, amount: Record<"common" | "rare" | "epic", number>): Promise<CardId | null> {
  const { tr, meta } = ctx;
  const choices = shardChoices(meta.profile.owned, meta.playerDeck, meta.season.key, t);
  return new Promise((resolve) => {
    let picked: CardId | null = null;
    const content = document.createElement("div");
    content.className = "rw-pick";
    if (ARABIC) content.dir = "rtl";
    const hint = document.createElement("p");
    hint.className = "rw-note";
    hint.textContent = tr("Choose the card these shards go to.", "اختر البطاقة التي تذهب إليها هذه الشظايا.");
    content.appendChild(hint);
    const row = document.createElement("div");
    row.className = "rw-pick__row";
    content.appendChild(row);
    const s = sheet({
      title: tr(`Tier ${t}: pick a card`, `المستوى ${fmtNum(t)}: اختر بطاقة`),
      content,
      onClose: () => resolve(picked),
    });
    for (const id of choices) {
      const rarity = getCard(id).rarity;
      const b = document.createElement("button");
      b.type = "button";
      b.className = `rw-pick__card rw-pick__card--${rarity}`;
      b.appendChild(makeCardCanvas(id, { style: "tile", size: 112 }));
      const name = document.createElement("span");
      name.className = "rw-pick__name";
      name.textContent = cardDisplayName(id);
      const plus = document.createElement("span");
      plus.className = "rw-pick__plus";
      plus.textContent = `+${fmtNum(amount[rarity])}`;
      const have = document.createElement("span");
      have.className = "rw-pick__have";
      have.textContent = `${rarityLabel(rarity, tr)} · ${tr("have", "لديك")} ${fmtNum(meta.profile.shards[id] ?? 0)}`;
      b.append(name, plus, have);
      b.setAttribute("aria-label", `${cardDisplayName(id)}: +${amount[rarity]} ${tr("shards", "شظايا")}`);
      b.addEventListener("click", () => {
        picked = id;
        s.close();
      });
      row.appendChild(b);
    }
  });
}

/**
 * Claim tier t: shard tiers ask for a card first (dismissing keeps the tier
 * unclaimed), then the claim is saved before anything is paid, so a reload
 * can never pay it twice. Chests open with the reveal.
 */
export async function claimPassTier(ctx: AppCtx, t: number): Promise<boolean> {
  const { tr, meta } = ctx;
  const rewards = passRewards(t);
  const shardReward = rewards.find((r): r is Extract<PassReward, { kind: "shards" }> => r.kind === "shards");
  let shardCard: CardId | null = null;
  if (shardReward) {
    if (!claimTier(currentPass(ctx), t)) return false;
    shardCard = await pickShardCard(ctx, t, shardReward.amount);
    if (!shardCard) return false;
  }
  const res = claimTier(currentPass(ctx), t);
  if (!res) return false;
  savePass(res.state);
  rewardSound(ctx).claim?.();
  buzz("claim");
  const notes: string[] = [];
  const chests: ("free" | "rare")[] = [];
  for (const r of res.rewards) {
    switch (r.kind) {
      case "gold":
        grantCurrency(ctx, r.amount, 0);
        notes.push(`+${fmtNum(r.amount)} ${tr("gold", "ذهب")}`);
        break;
      case "gems":
        grantCurrency(ctx, 0, r.amount);
        notes.push(`+${fmtNum(r.amount)} ${tr("gems", "جواهر")}`);
        break;
      case "shards": {
        if (!shardCard) break;
        const n = r.amount[getCard(shardCard).rarity];
        meta.profile = { ...meta.profile, shards: addShards(meta.profile.shards, shardCard, n) };
        ctx.persistProfile();
        notes.push(`+${fmtNum(n)} ${cardDisplayName(shardCard)}`);
        break;
      }
      case "flair": {
        const tier = unlockTowerFlair(r.tier);
        setTowerFlair(flairTier(meta.profile.trophies, tier));
        notes.push(r.tier === 2 ? tr("Jeweled towers unlocked!", "فُتحت الأبراج المرصّعة!") : tr("Gilded towers unlocked!", "فُتحت الأبراج المذهّبة!"));
        break;
      }
      case "emote": {
        const e = unlockNextEmote();
        notes.push(e ? `${tr("New emote:", "تعبير جديد:")} ${e.glyph}` : tr("All emotes unlocked", "كل التعابير مفتوحة"));
        break;
      }
      case "chest":
        chests.push(r.chest);
        break;
    }
  }
  if (notes.length > 0) toast(notes.join(" · "), "success");
  for (const c of chests) {
    await openChestFlow(ctx, { kind: "bonus", rarity: c }, tr(`Crown Pass · Tier ${t}`, `تذكرة التاج · المستوى ${fmtNum(t)}`));
  }
  return true;
}

// ---- Pill (Battle tab) ----------------------------------------------------------

/** Battle-tab pill: tier, crowns toward the next tier, and a dot when tiers wait. */
export function passPill(ctx: AppCtx): HTMLElement {
  const { tr } = ctx;
  const pass = currentPass(ctx);
  const p = passProgress(pass);
  const waiting = claimableTiers(pass).length;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rw-hubcard rw-hubcard--pass" + (waiting > 0 ? " is-ready" : "");
  const art = document.createElement("span");
  art.className = "rw-hubcard__art";
  art.innerHTML = icon("crown-filled");
  const title = document.createElement("b");
  title.textContent = tr("Crown Pass", "تذكرة التاج");
  const sub = document.createElement("span");
  sub.className = "rw-hubcard__sub";
  sub.textContent = p.maxed ? tr("Complete!", "اكتملت!") : `${tr("Tier", "المستوى")} ${fmtNum(p.tier)} · ${fmtNum(p.into)}/${fmtNum(p.need)}`;
  const bar = document.createElement("span");
  bar.className = "rw-minibar";
  const fill = document.createElement("i");
  fill.style.width = `${Math.round((p.into / p.need) * 100)}%`;
  bar.appendChild(fill);
  btn.append(art, title, sub, bar);
  if (waiting > 0) {
    const dot = document.createElement("span");
    dot.className = "rw-dot";
    dot.textContent = fmtNum(waiting);
    btn.appendChild(dot);
  }
  btn.setAttribute(
    "aria-label",
    `${tr("Crown Pass", "تذكرة التاج")}: ${sub.textContent}${waiting > 0 ? `. ${tr(`${waiting} to claim`, `${fmtNum(waiting)} للاستلام`)}` : ""}`,
  );
  btn.dataset.crowns = String(pass.crowns);
  btn.addEventListener("click", () => openPass(ctx));
  return btn;
}

// ---- Track (Events tab and the pass screen) -----------------------------------------

/**
 * The pass card: title, season clock, progress, and the horizontal 30-tier
 * track scrolled to the player's tier. `after` runs after a claim.
 */
export function passTrack(ctx: AppCtx, after: () => void): HTMLElement {
  const { tr } = ctx;
  const pass = currentPass(ctx);
  const p = passProgress(pass);
  const waiting = new Set(claimableTiers(pass));
  const card = document.createElement("section");
  card.className = "rw-pass";
  if (ARABIC) card.dir = "rtl";

  const head = document.createElement("div");
  head.className = "rw-pass__head";
  head.innerHTML = `<span class="rw-pass__crown">${icon("crown-filled")}</span>`;
  const titles = document.createElement("div");
  titles.className = "rw-pass__titles";
  const h = document.createElement("h3");
  h.textContent = tr("Crown Pass", "تذكرة التاج");
  const sub = document.createElement("span");
  const days = seasonDaysLeft(new Date());
  sub.textContent = `${seasonName(pass.key)} · ${tr(days === 1 ? "ends tomorrow" : `${days} days left`, `باقٍ ${fmtNum(days)} يوم`)}`;
  titles.append(h, sub);
  head.appendChild(titles);
  const free = document.createElement("span");
  free.className = "rw-pass__free";
  free.textContent = tr("FREE", "مجانية");
  head.appendChild(free);
  card.appendChild(head);

  const prog = document.createElement("div");
  prog.className = "rw-pass__progress";
  const bar = document.createElement("div");
  bar.className = "rw-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(p.need));
  bar.setAttribute("aria-valuenow", String(p.into));
  const fill = document.createElement("div");
  fill.className = "rw-bar__fill";
  fill.style.width = `${Math.round((p.into / p.need) * 100)}%`;
  const label = document.createElement("span");
  label.className = "rw-bar__label";
  label.innerHTML = p.maxed
    ? tr("All 30 tiers open!", "فُتحت المستويات الثلاثون!")
    : `${icon("crown-filled")} ${fmtNum(p.into)} / ${fmtNum(p.need)} · ${tr("next tier", "المستوى التالي")} ${fmtNum(p.tier + 1)}`;
  bar.append(fill, label);
  prog.appendChild(bar);
  const how = document.createElement("p");
  how.className = "rw-note rw-note--tight";
  how.textContent = tr(
    "Every crown you take in a battle fills the pass. 10 crowns open a tier.",
    "كل تاج تنتزعه في معركة يملأ التذكرة. ١٠ تيجان تفتح مستوى.",
  );
  prog.appendChild(how);
  card.appendChild(prog);

  const track = document.createElement("ol");
  track.className = "rw-track";
  track.setAttribute("aria-label", tr("Crown Pass tiers", "مستويات تذكرة التاج"));
  let focus: HTMLElement | null = null;
  for (let t = 1; t <= PASS_TIERS; t++) {
    const rewards = passRewards(t);
    const claimed = pass.claimed.includes(t);
    const open = t <= p.tier;
    const li = document.createElement("li");
    li.className =
      "rw-tier" +
      (claimed ? " is-claimed" : waiting.has(t) ? " is-ready" : open ? "" : " is-locked") +
      (t % 10 === 0 ? " is-big" : "");
    const num = document.createElement("span");
    num.className = "rw-tier__num";
    num.textContent = fmtNum(t);
    li.appendChild(num);
    const arts = document.createElement("span");
    arts.className = "rw-tier__arts";
    for (const r of rewards) arts.appendChild(rewardArt(r));
    li.appendChild(arts);
    const name = document.createElement("span");
    name.className = "rw-tier__name";
    name.textContent = rewards.map((r) => rewardLabel(r, tr)).join(" + ");
    li.appendChild(name);
    if (waiting.has(t)) {
      const b = button({
        variant: "cta",
        label: tr("Claim", "استلم"),
        onClick: () => {
          b.disabled = true;
          void claimPassTier(ctx, t).then((ok) => {
            b.disabled = false;
            if (ok) after();
          });
        },
      });
      b.classList.add("rw-tier__claim");
      li.appendChild(b);
      focus ??= li;
    } else {
      const state = document.createElement("span");
      state.className = "rw-tier__state";
      state.innerHTML = claimed ? icon("check") : open ? "" : icon("lock");
      li.appendChild(state);
    }
    if (!focus && t === p.tier + 1) focus = li;
    li.setAttribute("aria-label", `${tr("Tier", "المستوى")} ${t}: ${name.textContent}`);
    track.appendChild(li);
  }
  card.appendChild(track);
  // Bring the first waiting tier (or the next one to earn) into view.
  requestAnimationFrame(() => {
    if (!focus || !track.isConnected) return;
    // Centre it by geometry: works the same in LTR and RTL scrolling.
    const f = focus.getBoundingClientRect();
    const r = track.getBoundingClientRect();
    track.scrollLeft += f.left + f.width / 2 - (r.left + r.width / 2);
  });
  return card;
}

/** Profile tab: past seasons with best trophies and the pass tier reached. */
export function seasonHistory(ctx: AppCtx): HTMLElement {
  const { tr, meta } = ctx;
  const pass = currentPass(ctx);
  const box = document.createElement("section");
  box.className = "rw-history";
  if (ARABIC) box.dir = "rtl";
  const h = document.createElement("h3");
  h.className = "rw-section";
  h.textContent = tr("Season history", "سجل المواسم");
  box.appendChild(h);
  const rows: { key: string; best: number; tier: number | null; now: boolean }[] = [
    { key: meta.season.key, best: Math.max(meta.season.best, meta.profile.trophies), tier: passProgress(pass).tier, now: true },
    ...meta.season.history.map((s) => ({
      key: s.key,
      best: s.best,
      tier: pass.archive.find((a) => a.key === s.key)?.tier ?? null,
      now: false,
    })),
  ];
  const list = document.createElement("ul");
  list.className = "rw-history__list";
  for (const r of rows) {
    const li = document.createElement("li");
    li.className = "rw-history__row" + (r.now ? " is-now" : "");
    const name = document.createElement("span");
    name.className = "rw-history__name";
    name.textContent = r.now ? `${seasonName(r.key)} · ${tr("now", "الآن")}` : seasonName(r.key);
    const best = document.createElement("span");
    best.className = "rw-history__stat";
    best.innerHTML = `${icon("trophy")}<b>${fmtNum(r.best)}</b>`;
    best.title = tr("Best trophies", "أفضل كؤوس");
    const tier = document.createElement("span");
    tier.className = "rw-history__stat";
    tier.innerHTML = `${icon("crown-filled")}<b>${r.tier === null ? "-" : fmtNum(r.tier)}</b>`;
    tier.title = tr("Crown Pass tier", "مستوى تذكرة التاج");
    li.append(name, best, tier);
    list.appendChild(li);
  }
  box.appendChild(list);
  if (rows.length === 1) {
    const note = document.createElement("p");
    note.className = "rw-note rw-note--tight";
    note.textContent = tr(
      "Seasons end with the month: you keep a reward of 100 gold plus a tenth of your best trophies.",
      "ينتهي الموسم بانتهاء الشهر: تنال ١٠٠ ذهبة وعُشر أفضل كؤوسك.",
    );
    box.appendChild(note);
  }
  return box;
}

// ---- The pass screen ------------------------------------------------------------

export function openPass(ctx: AppCtx): void {
  buildPass(ctx);
  ctx.showPicker("pass");
}

function buildPass(ctx: AppCtx): void {
  const { pickerRoot, tr } = ctx;
  pickerRoot.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "rw-screen" + (reducedMotion() ? " is-calm" : "");
  if (ARABIC) screen.dir = "rtl";
  pickerRoot.appendChild(screen);
  screen.appendChild(screenHeader({ title: tr("Crown Pass", "تذكرة التاج"), onBack: () => ctx.openHome(), backLabel: tr("Back", "رجوع") }));
  screen.appendChild(passTrack(ctx, () => buildPass(ctx)));
  screen.appendChild(seasonHistory(ctx));
}
