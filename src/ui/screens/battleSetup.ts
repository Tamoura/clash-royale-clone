/**
 * Battle Setup: everything about the next bot match except the deck —
 * difficulty, game mode, tower troop and King's ability — in one bottom
 * sheet, opened from the chip row under the Battle button. Choices are
 * saved the moment they are made (the same keys main.ts loads at boot),
 * so the one-tap Battle button always plays the saved setup.
 *
 * Options gated by unlocks.ts show a lock and the arena that opens them.
 */
import type { AppCtx } from "../../app/ctx";
import { ABILITIES, ABILITY_IDS, saveAbility, type AbilityId } from "../../game/abilities";
import { TOWER_TROOPS, TOWER_TROOP_IDS, saveTowerTroop, type TowerTroopId } from "../../game/towers";
import * as Difficulty from "../../match/difficulty";
import { GAME_MODES, MODE_KEY, type GameMode } from "../../match/modes";
import { isOwnedDeck, ownedSet } from "../../meta/progress";
import { modeFeature, type Feature } from "../../meta/unlocks";
import { segmented, type SegmentOption } from "../components";
import { icon, type IconName } from "../icons";
import {
  isFeatureNew,
  isUnlocked,
  lockBadge,
  markFeaturesSeen,
  newBadge,
  openSheet,
  sfx,
} from "./frame";

const { DIFFICULTIES, DIFF_AR, DIFF_KEY } = Difficulty;

// ---- Labels -------------------------------------------------------------------------

/** Known difficulty keys in easy-to-hard order (unknown keys follow). */
const DIFF_ORDER = ["auto", "rookie", "easy", "normal", "hard"];
const DIFF_TEXT: Record<string, { en: string; ar: string; blurbEn: string; blurbAr: string }> = {
  auto: { en: "Auto", ar: "تلقائي", blurbEn: "Adjusts to how you play", blurbAr: "يتكيّف مع طريقة لعبك" },
  rookie: { en: "Rookie", ar: "مبتدئ", blurbEn: "Gentle and forgiving", blurbAr: "لطيف ومتسامح" },
  easy: { en: "Easy", ar: "سهل", blurbEn: "Slow to react", blurbAr: "بطيء في الرد" },
  normal: { en: "Normal", ar: "عادي", blurbEn: "A fair fight", blurbAr: "قتال متكافئ" },
  hard: { en: "Hard", ar: "صعب", blurbEn: "Fast and ruthless", blurbAr: "سريع ولا يرحم" },
};

/** Short mode names and icons (the stock names carry emoji we do not show). */
const MODE_TEXT: Record<string, { en: string; ar: string; icon: IconName }> = {
  classic: { en: "Classic", ar: "كلاسيكي", icon: "sword" },
  triple: { en: "Triple", ar: "ثلاثي", icon: "elixir" },
  mega: { en: "Mega", ar: "هائل", icon: "bolt" },
  mirror: { en: "Mirror", ar: "مرآة", icon: "users" },
  crazy: { en: "Crazy", ar: "جنون", icon: "dice" },
  sandbox: { en: "Sandbox", ar: "تجربة", icon: "wrench" },
};
const TOWER_ICON: Record<TowerTroopId, IconName> = { princess: "arrow", cannoneer: "burst", duchess: "sword" };
const ABILITY_ICON: Record<AbilityId, IconName> = { rally: "flag", restore: "heart", salvo: "bomb" };

const noEmoji = (s: string): string =>
  s.replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "").replace(/\s{2,}/g, " ").trim();

/** Difficulty keys on offer, read from DIFFICULTIES at call time. */
export function difficultyKeys(current: string): string[] {
  const keys = Object.keys(DIFFICULTIES);
  // 'auto' is a pseudo-option where the difficulty module supports it.
  const supportsAuto = typeof (Difficulty as unknown as Record<string, unknown>).autoTier === "function";
  if ((supportsAuto || current === "auto") && !keys.includes("auto")) keys.push("auto");
  if (current && !keys.includes(current)) keys.push(current);
  const rank = (k: string): number => {
    const i = DIFF_ORDER.indexOf(k);
    return i < 0 ? DIFF_ORDER.length : i;
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}

export function difficultyLabel(ctx: AppCtx, key: string): string {
  const t = DIFF_TEXT[key];
  if (t) return ctx.tr(t.en, t.ar);
  return ctx.tr(key[0].toUpperCase() + key.slice(1), DIFF_AR[key] ?? key);
}

export function modeLabel(ctx: AppCtx, m: GameMode): string {
  const t = MODE_TEXT[m.id];
  return t ? ctx.tr(t.en, t.ar) : ctx.tr(noEmoji(m.name), noEmoji(m.nameAr));
}

const modeIcon = (m: GameMode): IconName => MODE_TEXT[m.id]?.icon ?? "sword";

/** Features this sheet can unlock (for the NEW dot on the chip row). */
const SETUP_FEATURES: Feature[] = ["sandbox", "triple", "mirror", "mega", "crazy", "towerTroops", "abilities"];

// ---- Unlock enforcement ----------------------------------------------------------

/**
 * Snap saved choices that are still locked back to the defaults (Classic,
 * Princess, Royal Rally), so a one-tap battle never plays a locked setup.
 */
export function enforceUnlocks(ctx: AppCtx): void {
  const { meta } = ctx;
  const mf = modeFeature(meta.gameMode.id);
  if (mf && !isUnlocked(ctx, mf)) {
    meta.gameMode = GAME_MODES[0];
    store(MODE_KEY, meta.gameMode.id);
  }
  if (!isUnlocked(ctx, "towerTroops") && meta.towerTroop !== TOWER_TROOP_IDS[0]) {
    meta.towerTroop = TOWER_TROOP_IDS[0];
    saveTowerTroop(meta.towerTroop);
  }
  if (!isUnlocked(ctx, "abilities") && meta.abilityChoice !== ABILITY_IDS[0]) {
    meta.abilityChoice = ABILITY_IDS[0];
    saveAbility(meta.abilityChoice);
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts for this session
  }
}

// ---- Chip row ---------------------------------------------------------------------

/** The setup summary under the Battle button; tapping it opens the sheet. */
export function setupChipRow(ctx: AppCtx, onChange: () => void): HTMLButtonElement {
  const { meta, tr } = ctx;
  const row = document.createElement("button");
  row.type = "button";
  row.className = "v2-setup-row";
  row.setAttribute("aria-label", tr("Battle setup: difficulty, mode and loadout", "إعداد المعركة: الصعوبة والنمط والتجهيز"));
  const chip = (ic: IconName, text: string, iconOnly = false): string =>
    iconOnly
      ? `<span class="v2-setup-chip is-icon" title="${escapeHtml(text)}">${icon(ic)}</span>`
      : `<span class="v2-setup-chip">${icon(ic)}<span>${escapeHtml(text)}</span></span>`;
  let html = chip("gauge", difficultyLabel(ctx, meta.difficulty)) + chip(modeIcon(meta.gameMode), modeLabel(ctx, meta.gameMode));
  // Loadout picks show as icons, so the row never truncates.
  if (isUnlocked(ctx, "towerTroops")) {
    const t = TOWER_TROOPS[meta.towerTroop];
    html += chip(TOWER_ICON[meta.towerTroop], tr(t.name, t.ar), true);
  }
  if (isUnlocked(ctx, "abilities")) {
    const a = ABILITIES[meta.abilityChoice];
    html += chip(ABILITY_ICON[meta.abilityChoice], tr(a.name, a.ar), true);
  }
  const fresh = SETUP_FEATURES.some((f) => isFeatureNew(ctx, f));
  html += `<span class="v2-setup-more${fresh ? " has-new" : ""}">${icon("sliders")}</span>`;
  row.innerHTML = html;
  if (fresh) row.setAttribute("aria-description", tr("New options unlocked", "خيارات جديدة مفتوحة"));
  row.addEventListener("click", () => {
    sfx(ctx, "uiTap");
    openBattleSetup(ctx, onChange);
  });
  return row;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---- Sheet ------------------------------------------------------------------------

interface GroupOpts<T> {
  title: string;
  options: (SegmentOption<T> & { feature?: Feature | null })[];
  value: T;
  set: (v: T) => void;
  /** The whole group is locked behind this feature. */
  lockedBy?: Feature;
}

/** A titled segmented group; locked options get a lock and their arena. */
function setupGroup<T>(ctx: AppCtx, o: GroupOpts<T>): HTMLElement {
  const g = document.createElement("section");
  g.className = "v2-setup-group";
  const head = document.createElement("div");
  head.className = "v2-setup-head";
  const h = document.createElement("h3");
  h.textContent = o.title;
  head.appendChild(h);
  g.appendChild(head);

  const groupLocked = o.lockedBy && !isUnlocked(ctx, o.lockedBy) ? o.lockedBy : null;
  if (groupLocked) {
    head.appendChild(lockBadge(ctx, groupLocked));
    g.classList.add("is-locked");
  } else if (o.lockedBy && isFeatureNew(ctx, o.lockedBy)) {
    head.appendChild(newBadge(ctx));
  }

  let current = o.value;
  const seg = segmented<T>({
    options: o.options,
    value: o.value,
    ariaLabel: o.title,
    onChange: (v) => {
      const opt = o.options.find((x) => x.value === v);
      if (groupLocked || (opt?.feature && !isUnlocked(ctx, opt.feature))) {
        // Keyboard arrows can land on a locked option: refuse it.
        seg.setValue(current);
        return;
      }
      current = v;
      sfx(ctx, "uiTap");
      o.set(v);
    },
  });
  const buttons = seg.querySelectorAll<HTMLButtonElement>(".ui-seg__opt");
  o.options.forEach((opt, i) => {
    const b = buttons[i];
    if (!b) return;
    const locked = groupLocked ?? (opt.feature && !isUnlocked(ctx, opt.feature) ? opt.feature : null);
    if (locked) {
      b.disabled = true;
      b.classList.add("is-locked");
      if (!groupLocked) b.appendChild(lockBadge(ctx, locked));
    } else if (opt.feature && isFeatureNew(ctx, opt.feature)) {
      b.appendChild(newBadge(ctx));
    }
  });
  if (groupLocked) {
    const note = document.createElement("p");
    note.className = "v2-setup-locknote";
    note.textContent = ctx.tr(
      "Win battles to climb the trophy road and unlock this choice.",
      "انتصر في المعارك لتصعد طريق الكؤوس وتفتح هذا الخيار.",
    );
    g.appendChild(note);
  }
  g.appendChild(seg);
  return g;
}

/** Open the Battle Setup sheet. `onChange` runs after any saved change. */
export function openBattleSetup(ctx: AppCtx, onChange: () => void = () => undefined): void {
  const { meta, tr } = ctx;
  const content = document.createElement("div");
  content.className = "v2-setup";

  // Difficulty
  content.appendChild(
    setupGroup<string>(ctx, {
      title: tr("Bot difficulty", "صعوبة الروبوت"),
      options: difficultyKeys(meta.difficulty).map((k) => {
        const t = DIFF_TEXT[k];
        return { value: k, label: difficultyLabel(ctx, k), blurb: t ? tr(t.blurbEn, t.blurbAr) : undefined };
      }),
      value: meta.difficulty,
      set: (k) => {
        meta.difficulty = k;
        store(DIFF_KEY, k);
        onChange();
      },
    }),
  );

  // Game mode
  const modes = setupGroup<string>(ctx, {
    title: tr("Game mode", "نمط اللعب"),
    options: GAME_MODES.map((m) => ({
      value: m.id,
      label: modeLabel(ctx, m),
      icon: modeIcon(m),
      blurb: noEmoji(tr(m.blurb, m.blurbAr)),
      feature: modeFeature(m.id),
    })),
    value: meta.gameMode.id,
    set: (id) => {
      meta.gameMode = GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
      store(MODE_KEY, meta.gameMode.id);
      onChange();
    },
  });
  modes.classList.add("v2-setup-group--modes");
  content.appendChild(modes);

  // Tower troop
  content.appendChild(
    setupGroup<TowerTroopId>(ctx, {
      title: tr("Tower troop", "حامي الأبراج"),
      lockedBy: "towerTroops",
      options: TOWER_TROOP_IDS.map((id) => {
        const d = TOWER_TROOPS[id];
        return { value: id, label: tr(d.name, d.ar), icon: TOWER_ICON[id], blurb: tr(d.blurb, d.blurbAr) };
      }),
      value: meta.towerTroop,
      set: (id) => {
        meta.towerTroop = id;
        saveTowerTroop(id);
        onChange();
      },
    }),
  );

  // King's ability
  content.appendChild(
    setupGroup<AbilityId>(ctx, {
      title: tr("King's ability", "قدرة الملك"),
      lockedBy: "abilities",
      options: ABILITY_IDS.map((id) => {
        const d = ABILITIES[id];
        return { value: id, label: tr(d.name, d.ar), icon: ABILITY_ICON[id], blurb: tr(d.blurb, d.blurbAr) };
      }),
      value: meta.abilityChoice,
      set: (id) => {
        meta.abilityChoice = id;
        saveAbility(id);
        onChange();
      },
    }),
  );

  // Links: deck and online
  const links = document.createElement("div");
  links.className = "v2-setup-links";
  const link = (ic: IconName, label: string, sub: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "v2-link-row";
    b.innerHTML = `${icon(ic)}<span class="v2-link-text"><b></b><small></small></span>${icon("back", "v2-chev")}`;
    b.querySelector("b")!.textContent = label;
    b.querySelector("small")!.textContent = sub;
    b.addEventListener("click", fn);
    links.appendChild(b);
    return b;
  };
  let close = (): void => undefined;
  link("cards", tr("Edit deck", "تعديل المجموعة"), tr("Choose your 8 cards", "اختر بطاقاتك الثماني"), () => {
    close();
    ctx.openDeckPicker({ mode: "battle" });
  });
  const owned = ownedSet(meta.profile.owned);
  const hasChampion = meta.playerDeck.includes("champion");
  const online = link(
    "globe",
    tr("Play online", "العب عبر الإنترنت"),
    hasChampion
      ? tr("Your Champion is for bot battles only", "بطلك لمعارك الروبوت فقط")
      : tr("Quick match or a friend's code", "مباراة سريعة أو رمز صديق"),
    () => {
      close();
      ctx.openLobby();
    },
  );
  online.disabled = hasChampion || !isOwnedDeck(meta.playerDeck, owned);
  content.appendChild(links);

  const s = openSheet({ title: tr("Battle setup", "إعداد المعركة"), content, className: "v2-setup-sheet" });
  close = s.close;
  // Looking at the sheet clears its NEW badges (next time).
  markFeaturesSeen(ctx, SETUP_FEATURES);
}
