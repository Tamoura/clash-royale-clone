# Feature: more-cards-and-gameplay

Branch: `feature/more-cards-and-gameplay` (stacked on
`feature/3d-characters-and-sound`)

Goal: gameplay closer to Clash Royale + 6 new cards (14 total).
Original character designs only — archetypes, not Supercell's art.

## New mechanics (all TDD'd in the sim)

- **Air units**: `flying` units hover, fly straight over the river
  (no bridge detours), and can only be hit by units with
  `targetsAir` (and towers). Ground-only attackers must ignore them.
- **Splash damage**: `splashRadius > 0` damages everything enemy
  within the radius of the struck target.
- **Charge**: after 2.5 tiles of uninterrupted approach, next hit
  deals 2x (Prince). Progress resets on each attack.
- **Buildings**: deployable `building` cards (Cannon) on your own
  half; they decay over a lifetime, attack ground only, and count
  as buildings for giant-style targeting (bait!).
- **Deploy delay**: troops stand frozen 1s after deployment.

## New cards

| Card        | Cost | Notes                                   |
| ----------- | ---- | --------------------------------------- |
| Wizard      | 5    | ranged splash, hits air                 |
| Baby Dragon | 4    | flying, splash, hits air                |
| Gargoyles   | 3    | 3 flying melee, hit air                 |
| Valkyrie    | 4    | tanky melee splash (ground only)        |
| Prince      | 5    | charge: 2x damage after 2.5-tile run-up |
| Cannon      | 3    | building, ground-only, 30s lifetime     |

Both sides cycle the full 14-card deck (4-card hand unchanged).

## Presentation

- New 3D rigs (wizard/dragon/gargoyle/valkyrie/prince-on-horse) +
  cannon building mesh; wings flap; flyers hover.
- Visual projectiles on ranged attack events (attack events now
  carry target coords).
- New 2D card portraits for the HUD (drawCardArt painters).

## Status

- [x] Air units
- [x] Splash
- [x] Charge
- [x] Buildings + decay
- [x] Deploy delay
- [x] 14-card deck definitions
- [x] Attack event target coords + projectiles
- [x] 3D rigs + card art
- [x] Bot handles buildings
- [x] Docs, verify, PR (+ tower HP numbers, user request mid-feature)
