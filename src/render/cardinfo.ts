import { levelMultiplier } from "../game/battle";
import { getCard, SPEED_TILES_PER_SEC, type CardId, type Speed } from "../game/cards";
import { ARABIC } from "../render3d/theme";
import { cardDisplayName } from "./cardNames";

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** English/Arabic string pair — the Arabic edition shows Arabic tooltips. */
const tr = (en: string, ar: string): string => (ARABIC ? ar : en);

const RARITY_AR: Record<string, string> = {
  common: "شائع",
  rare: "نادر",
  epic: "ملحمي",
};

const SPEED_AR: Record<string, string> = {
  slow: "بطيء",
  medium: "متوسط",
  fast: "سريع",
};

function rarityLabel(rarity: string): string {
  return ARABIC ? RARITY_AR[rarity] ?? rarity : cap(rarity);
}

/** Short tooltip lines describing what a card is and does. */
export function cardStatLines(id: CardId): string[] {
  const card = getCard(id);
  const lines: string[] = [];
  if (card.id === "mirror") {
    lines.push(`${tr("Spell", "تعويذة")} · ${rarityLabel(card.rarity)}`);
    lines.push(
      tr(
        "Replays the last card you played, for its cost +1",
        "تعيد لعب آخر بطاقة لعبتها مقابل كلفتها +1",
      ),
    );
    return lines;
  }
  if (card.kind === "spell") {
    lines.push(`${tr("Spell", "تعويذة")} · ${rarityLabel(card.rarity)}`);
    const bits: string[] = [];
    if (card.damage > 0) bits.push(tr(`${card.damage} damage`, `${card.damage} ضرر`));
    if (card.stunSeconds > 0) {
      bits.push(tr(`${card.stunSeconds}s stun`, `صعق ${card.stunSeconds} ث`));
    }
    if (card.rageSeconds > 0) {
      bits.push(
        tr(`${card.rageSeconds}s boost: faster troops`, `تسريع الوحدات ${card.rageSeconds} ث`),
      );
    }
    if (card.heal > 0) bits.push(tr(`heals ${card.heal}`, `يشفي ${card.heal}`));
    if (card.pull > 0) bits.push(tr("drags enemies to its center", "يسحب الأعداء إلى مركزها"));
    if (card.spawnUnit) {
      bits.push(
        tr(`unloads ${cardDisplayName(card.spawnUnit)}s`, `يطلق ${cardDisplayName(card.spawnUnit)}`),
      );
    }
    bits.push(tr(`radius ${card.radius}`, `نصف قطر ${card.radius}`));
    lines.push(bits.join(" · "));
    return lines;
  }
  const u = card.unit;
  const kind = card.kind === "building" ? tr("Building", "مبنى") : tr("Troop", "وحدة");
  const count = card.kind === "troop" && card.count > 1 ? ` ×${card.count}` : "";
  lines.push(`${kind}${count} · ${rarityLabel(card.rarity)}`);
  lines.push(
    u.damage > 0
      ? tr(`${u.maxHp} HP · ${u.damage} damage`, `${u.maxHp} صحة · ${u.damage} ضرر`)
      : tr(`${u.maxHp} HP`, `${u.maxHp} صحة`),
  );
  const traits: string[] = [];
  if (card.kind === "troop") {
    traits.push(
      ARABIC ? `سرعة ${SPEED_AR[u.speed] ?? u.speed}` : `${cap(u.speed)} speed`,
    );
  }
  if (u.attackRange > 1) traits.push(tr(`range ${u.attackRange}`, `مدى ${u.attackRange}`));
  if (u.flying) traits.push(tr("flies", "يطير"));
  if (u.targetsAir) traits.push(tr("hits air", "يضرب الجو"));
  if (u.targetsBuildingsOnly) traits.push(tr("targets buildings", "يستهدف المباني"));
  if (u.splashRadius > 0) traits.push(tr("splash", "ضرر منطقة"));
  if (u.pierce) traits.push(tr("pierces", "يخترق"));
  if (u.recoil > 0) traits.push(tr("recoil kick", "ارتداد"));
  if (u.chargeDistance > 0) traits.push(tr("charges (2x)", "شحنة (×2)"));
  if (u.jumpsRiver) traits.push(tr("jumps the river", "يقفز النهر"));
  if (traits.length) lines.push(traits.join(" · "));
  const powers: string[] = [];
  if (u.spawnUnitId) {
    powers.push(
      tr(
        `summons ${cardDisplayName(u.spawnUnitId)}s`,
        `يستدعي ${cardDisplayName(u.spawnUnitId)}`,
      ),
    );
  }
  if (u.deathDamage > 0) powers.push(tr("death bomb", "قنبلة موت"));
  if (u.elixirInterval > 0) {
    powers.push(
      tr(`+1 elixir / ${u.elixirInterval}s`, `+1 إكسير كل ${u.elixirInterval} ث`),
    );
  }
  if (card.kind === "building") {
    powers.push(tr(`${card.lifetime}s lifetime`, `يدوم ${card.lifetime} ث`));
  }
  if (powers.length) lines.push(powers.join(" · "));
  return lines;
}

// ---- Stats at a card level (card info sheet) ------------------------------

/** Who a card's attacks can hit. */
export type CardTargets = "ground" | "air-ground" | "buildings" | "area";

/**
 * A card's combat numbers at one level, with the same +10%-per-level
 * multiplier the sim applies (levelMultiplier). Values are unrounded so
 * they match the sim exactly; the UI rounds for display. null = the stat
 * does not apply to this card (a spell has no HP, a collector no DPS).
 */
export interface CardLevelStats {
  kind: "troop" | "building" | "spell";
  level: number;
  /** HP per unit (troops and buildings). */
  hp: number | null;
  /** Damage per hit (troops, buildings) or per cast (spells). */
  damage: number | null;
  /** Damage per second per unit. */
  dps: number | null;
  /** Seconds between hits. */
  hitSpeed: number | null;
  /** Attack range in tiles (troops/buildings) or the spell radius. */
  range: number | null;
  /** Move speed (troops only). */
  speed: Speed | null;
  /** Tiles per second for that speed. */
  tilesPerSec: number | null;
  targets: CardTargets;
  /** Units per deploy (1 for buildings and spells). */
  count: number;
}

/** Pure: the stats for card `id` at `level` (1 = base). */
export function cardStatsAtLevel(id: CardId, level: number): CardLevelStats {
  const card = getCard(id);
  const lvl = Math.max(1, Math.floor(level));
  const mult = levelMultiplier({ [id]: lvl }, id);
  if (card.kind === "spell") {
    return {
      kind: "spell",
      level: lvl,
      hp: null,
      damage: card.damage > 0 ? card.damage * mult : null,
      dps: null,
      hitSpeed: null,
      range: card.radius,
      speed: null,
      tilesPerSec: null,
      targets: "area",
      count: 1,
    };
  }
  const u = card.unit;
  const damage = u.damage > 0 ? u.damage * mult : null;
  return {
    kind: card.kind,
    level: lvl,
    hp: u.maxHp * mult,
    damage,
    dps: damage !== null && u.hitSpeed > 0 ? damage / u.hitSpeed : null,
    hitSpeed: damage !== null ? u.hitSpeed : null,
    range: damage !== null ? u.attackRange : null,
    speed: card.kind === "troop" ? u.speed : null,
    tilesPerSec: card.kind === "troop" ? SPEED_TILES_PER_SEC[u.speed] : null,
    targets: u.targetsBuildingsOnly ? "buildings" : u.targetsAir ? "air-ground" : "ground",
    count: card.kind === "troop" ? card.count : 1,
  };
}
