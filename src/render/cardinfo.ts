import { getCard, type CardId } from "../game/cards";

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** Short tooltip lines describing what a card is and does. */
export function cardStatLines(id: CardId): string[] {
  const card = getCard(id);
  const lines: string[] = [];
  if (card.kind === "spell") {
    lines.push(`Spell · ${cap(card.rarity)}`);
    const bits: string[] = [];
    if (card.damage > 0) bits.push(`${card.damage} damage`);
    if (card.stunSeconds > 0) bits.push(`${card.stunSeconds}s stun`);
    if (card.rageSeconds > 0) bits.push(`${card.rageSeconds}s boost: faster troops`);
    bits.push(`radius ${card.radius}`);
    lines.push(bits.join(" · "));
    return lines;
  }
  const u = card.unit;
  const kind = card.kind === "building" ? "Building" : "Troop";
  const count = card.kind === "troop" && card.count > 1 ? ` ×${card.count}` : "";
  lines.push(`${kind}${count} · ${cap(card.rarity)}`);
  lines.push(
    u.damage > 0 ? `${u.maxHp} HP · ${u.damage} damage` : `${u.maxHp} HP`,
  );
  const traits: string[] = [];
  if (card.kind === "troop") traits.push(`${cap(u.speed)} speed`);
  if (u.attackRange > 1) traits.push(`range ${u.attackRange}`);
  if (u.flying) traits.push("flies");
  if (u.targetsAir) traits.push("hits air");
  if (u.targetsBuildingsOnly) traits.push("targets buildings");
  if (u.splashRadius > 0) traits.push("splash");
  if (u.chargeDistance > 0) traits.push("charges (2x)");
  if (u.jumpsRiver) traits.push("jumps the river");
  if (traits.length) lines.push(traits.join(" · "));
  const powers: string[] = [];
  if (u.spawnUnitId) powers.push(`summons ${getCard(u.spawnUnitId).name}s`);
  if (u.deathDamage > 0) powers.push("death bomb");
  if (u.elixirInterval > 0) powers.push(`+1 elixir / ${u.elixirInterval}s`);
  if (card.kind === "building") powers.push(`${card.lifetime}s lifetime`);
  if (powers.length) lines.push(powers.join(" · "));
  return lines;
}
