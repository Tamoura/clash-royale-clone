/**
 * King's Ability: one active power per side on a charge meter. It fills
 * over the match and fires on demand — a second decision layer on top of
 * card play. Bots pick and use theirs too.
 */
import { ARENA_HEIGHT, ARENA_WIDTH, type Side } from "./arena";
import { applySpell, distance, sideState, type BattleState } from "./battle";

export type AbilityId = "rally" | "restore" | "salvo";

export interface AbilityDef {
  id: AbilityId;
  name: string;
  ar: string;
  icon: string;
  blurb: string;
  blurbAr: string;
  /** Seconds for the meter to fill from empty. */
  chargeSeconds: number;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  rally: {
    id: "rally",
    name: "Royal Rally",
    ar: "النفير الملكي",
    icon: "⚔️",
    blurb: "Every troop you own rages for 5 seconds.",
    blurbAr: "كل وحداتك تغضب لمدة ٥ ثوانٍ.",
    chargeSeconds: 55,
  },
  restore: {
    id: "restore",
    name: "Royal Restore",
    ar: "الترميم الملكي",
    icon: "💖",
    blurb: "Heal your towers 500 and your troops 300.",
    blurbAr: "اشفِ أبراجك ٥٠٠ ووحداتك ٣٠٠.",
    chargeSeconds: 55,
  },
  salvo: {
    id: "salvo",
    name: "King's Salvo",
    ar: "وابل الملك",
    icon: "💣",
    blurb: "The King bombards the 4 nearest enemies for 180 each.",
    blurbAr: "الملك يقصف أقرب ٤ أعداء بـ ١٨٠ لكل منهم.",
    chargeSeconds: 55,
  },
};

export const ABILITY_IDS: AbilityId[] = ["rally", "restore", "salvo"];

export const RALLY_SECONDS = 5;
export const RESTORE_TOWER_HP = 500;
export const RESTORE_TROOP_HP = 300;
export const SALVO_TARGETS = 4;
export const SALVO_DAMAGE = 180;
export const SALVO_RADIUS = 1.3;

export function isAbilityId(v: unknown): v is AbilityId {
  return v === "rally" || v === "restore" || v === "salvo";
}

export const ABILITY_KEY = "cr-clone-ability";

export function loadAbility(): AbilityId {
  try {
    const v = localStorage.getItem(ABILITY_KEY);
    return isAbilityId(v) ? v : "rally";
  } catch {
    return "rally";
  }
}

export function saveAbility(id: AbilityId): void {
  try {
    localStorage.setItem(ABILITY_KEY, id);
  } catch {
    // storage unavailable
  }
}

/** Advance both meters (called from the sim tick). */
export function tickAbilities(state: BattleState, dt: number): void {
  for (const me of [state.player, state.enemy]) {
    if (!me.ability) continue;
    const secs = ABILITIES[me.ability].chargeSeconds;
    me.abilityCharge = Math.min(1, me.abilityCharge + dt / secs);
  }
}

/** Fire `side`'s ability if it's chosen and fully charged. */
export function useAbility(state: BattleState, side: Side): boolean {
  if (state.result) return false;
  const me = sideState(state, side);
  if (!me.ability || me.abilityCharge < 1) return false;
  const king = state.entities.find((e) => e.side === side && e.kind === "king-tower");
  const kx = king?.x ?? ARENA_WIDTH / 2;
  const ky = king?.y ?? (side === "player" ? ARENA_HEIGHT - 2.5 : 2.5);

  switch (me.ability) {
    case "rally":
      // One arena-wide zone: every friendly unit rages, wherever it stands.
      state.buffZones.push({ side, x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, radius: 40, ttl: RALLY_SECONDS });
      break;
    case "restore":
      for (const e of state.entities) {
        if (e.side !== side || e.hp <= 0) continue;
        if (e.kind === "troop") e.hp = Math.min(e.maxHp, e.hp + RESTORE_TROOP_HP);
        else if (e.kind === "princess-tower" || e.kind === "king-tower") {
          e.hp = Math.min(e.maxHp, e.hp + RESTORE_TOWER_HP);
          state.effects.push({ cardId: "heal", x: e.x, y: e.y, radius: 2.2, ttl: 0.6 });
        }
      }
      break;
    case "salvo": {
      const targets = state.entities
        .filter((e) => e.side !== side && e.hp > 0 && (e.kind === "troop" || e.kind === "building"))
        .sort((a, b) => distance(a, { x: kx, y: ky }) - distance(b, { x: kx, y: ky }))
        .slice(0, SALVO_TARGETS);
      for (const t of targets) {
        state.events.push({ type: "spell", side, cardId: "fireball", x: t.x, y: t.y });
        // Credited to no card — it's the King's own shot.
        applySpell(state, side, "fireball", t.x, t.y, SALVO_DAMAGE, SALVO_RADIUS, 0, 0.5, false);
      }
      break;
    }
  }
  state.events.push({ type: "ability", side, ability: me.ability, x: kx, y: ky });
  me.abilityCharge = 0;
  return true;
}
