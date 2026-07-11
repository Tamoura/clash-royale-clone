# Feature: islamic-character-models

Branch: `feature/islamic-character-models`

## Goal

Islamic mode should change the **look** of characters, not just their
names. The naming layer (`src/render/cardNames.ts`) already renames every
card (Giant → "War Elephant", Hog Rider → "Camel Raider", etc.). Now the
3D geometry must match — the flagship example the user gave is the Giant
becoming an actual **war elephant carrying a turbaned rider**.

Scope (user choice): **whole roster** — reskin every Islamic-named unit's
geometry, done iteratively card-by-card over multiple rounds.

## Architecture decision

Previously each `buildXxx()` in `characters3d.ts` had an inline
`if (ARABIC) { …add a turban… }`. That works for light theming but not for
full silhouette swaps (elephant vs strongman).

New pattern: a parallel `ISLAMIC_BUILDERS: Partial<Record<CardId, () => TroopRig>>`
registry. `buildTroop()` prefers the Islamic builder when `ARABIC` is true,
else falls back to the default `BUILDERS[cardId]`. Cards that only need a
turban keep their single inline-themed builder (no Islamic override). Cards
that need a new body get a dedicated `buildXxxIslamic()`.

```ts
const builder = (ARABIC && ISLAMIC_BUILDERS[cardId]) || BUILDERS[cardId];
```

Note: in node tests there is no localStorage, so `ARABIC` defaults to
**true** (theme.ts catch → "arabic"). Existing giant tests therefore already
run the Arabic branch. Keep the rider human (addEyes → "brow"/"mouth"/"eye"
named meshes) so the `moods angle the brows` and shared-geo tests still pass.

## Rig conventions (must satisfy)

- Return a `TroopRig`: `{ group, arm, armRest, swingAmp, height, legs?, offArm?, wings?, hover?, extras? }`.
- `arm` = weapon shoulder group (rotated on attack), `legs` swing alternately
  (i%2 dir), `offArm` counter-sways. 4-leg quadrupeds: order
  [frontL, frontR, backL, backR] like the Prince's pony / Hog.
- Faces via `addEyes(head, r, spread, up, mood)`; turbans via `turban(r, cloth, gem)`;
  curved blades via `scimitar()`.
- Primitives `box/sphere/cyl/cone` share cached geometry (disposal-safe).

## Progress

- [x] Architecture: ISLAMIC_BUILDERS registry + buildTroop dispatch
- [x] giant → War Elephant + turbaned rider (flagship)
- [x] hog-rider → Camel Raider (dromedary mount, bobbing neck, scimitar rider)
- [x] balloon → Fire-Kite (diamond paper kite, gold spars, brazier + fire pots)
- [x] musketeer → Janissary (tall white börk, deep-blue coat, matchlock)
- [x] mini-pekka → Duelist (turbaned swordsman, buckler + scimitar)
- [x] witch → War Drummer (copper war-drum + mallets)
- [x] wizard → Alchemist (emerald robe, alembic staff, green elixir)
- [x] pekka → Cataphract (barded horse, nasal helm, kontos lance)
- [x] mega-knight → Mamluk Amir (teal/gold plate, fluted helm, spiked maces)
- [x] baby-dragon → Roc Hatchling (cream/gold chick, hooked beak, feather wings)
- [x] gargoyles / minions → War Falcon (hooded falconry bird, talons)
- [x] skeletons / skeleton-army → Militia (tiny turbaned spearmen)
- [x] royal-giant → Bombardier (bronze bombard with gold bands)
- [ ] remaining light-theme cards (knight, archers, prince, valkyrie, princess,
      executioner, bats, electro/ice wizard) — still inline turban/scimitar cues

## Verification gotcha

WebGL can't run in the MCP automation tab (no context). Visual check must
happen in the user's own visible browser tab (`npm run dev`, port 3101).
Headless coverage = the rig structural tests in `characters3d.test.ts`.
Gallery: `?gallery=<cardId>` still works for every troop builder.
