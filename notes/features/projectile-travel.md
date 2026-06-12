# Projectile travel + fireball knockback (realism)

- Ranged damage now lands on ARRIVAL: dealDamage spawns a homing
  Projectile (9 t/s) for any attacker with range > 1 (troops,
  towers, buildings); tickProjectiles flies them, applies damage +
  splash at impact, and fizzles shots whose target died mid-air.
- Renderer mirrors sim projectiles 1:1 (syncProjectiles map by id,
  arc from launch-leg progress); the old event-based cosmetic shot
  is reduced to the muzzle flash.
- Fireball gains knockback 0.8 tiles (SpellCard.knockback): living
  troops are shoved from the blast center; towers/buildings immune.
