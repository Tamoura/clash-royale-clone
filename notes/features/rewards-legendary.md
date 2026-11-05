# Rewards: Legendary tier, coin bursts, 3-crown celebration

Wave 2 package `rewards-legendary`. Rarity is meta-only: no sim change, the
golden checksum and bot tests are untouched, SIM_VERSION / PROTOCOL_VERSION
unchanged.

## Legendary tier
- `Rarity` gains `"legendary"` (`src/game/cards.ts`, type + `rarity:` fields
  only). Six legendaries: **Digger** and **Comet** (the new signature cards),
  plus the pool cards that are Legendary in the original game: **Mega Knight,
  Electro Wizard, Magic Archer, Princess**. Ice Wizard stays Epic to keep the
  tier at six. No starter-deck card and no token is legendary (tested).
- Labels: "Legendary" / "أسطورية" (card info badge, reveal, pass picker) and
  "أسطوري" in the battle tooltip (`src/render/cardinfo.ts`, `rarityWord`).

### Chest odds (`src/meta/chests.ts`)
- When a chest rolls its new card, a legendary weighs **0.1** (Wooden) or
  **0.3** (Rare) against 1 for any other unowned card
  (`LEGENDARY_NEW_CARD_WEIGHT`).
- A shard drop that lands on an owned legendary sticks only **20%** (Wooden)
  / **45%** (Rare) of the time, else it rerolls to a non-legendary
  (`LEGENDARY_SHARD_KEEP`); legendary shards come one or two at a time.
- Measured with no pity (starter collection, 20k chests each):
  450 trophies 0.5% Wooden / 2.2% Rare; 2100 trophies 0.7% / 3.5%;
  3000 trophies 1.0% / 4.6%.
- **Guarantee only in the big chest.** A pity counter
  (`cr-clone-legendary-pity`) counts chests opened since the last legendary.
  Once it reaches **8**, the next **Rare** chest is sure to hold a legendary:
  a new one when one is findable at the player's arena, else shards for an
  owned one. Wooden chests never cash the guarantee in. Below 400 trophies
  (Digger's arena) nothing can drop, so the counter is simply full when a kid
  reaches Barbarian Bowl: the arena's gate chest on the Trophy Road (a Rare
  chest) then brings the Digger.
- `rollChest(chest, trophies, owned, rng, pity)` is pure (tests drive it);
  `openChest(..., kv)` reads and moves the stored counter, once per chest
  actually opened (only `tryOpenChest` calls it).

### Costs (`src/meta/economy.ts`)
- `UPGRADE_BASE.legendary = { gold: 400, shards: 1 }` (times the level being
  left): the most gold per level of any rarity, but half the shards of an
  Epic because legendary shards are scarce.
- Crown Pass shard tiers pay 1 (early) / 2 (late) legendary shards.

### Legendary frame (`src/ui/cardFrame.ts`, `src/ui/styles/legendary.css`)
- Every tile that carries the rarity class (collection, deck builder, card
  info, draft, chest reveal card and summary cell, pass shard picker) gets a
  gold border whose ring slowly turns through a rainbow (Classic) or gold /
  turquoise / lapis (Golden Age, tokens in `tokens.css`), plus a sweep of
  light across the art every ~4 s. The battle hand gets a still ring (no
  repaint cost in a match). Locked legendaries show a dim, still ring.
- The card canvas adds what survives everywhere, even with motion off: a warm
  halo behind the portrait, a gold inner rim and four seeded twinkles
  (`legendaryTwinkles`, tested).
- Reduced motion (the pref's `.v2-calm` / `.is-calm` roots, the result's
  `.calm`, or the OS setting): the ring stands still and the sweep is gone.
- The frame never animates `box-shadow` on `.v2-tile`, so the deck builder's
  chosen ring and the upgrade-ready glow still show on legendary tiles.

## Chest reveal (`src/ui/screens/chestReveal.ts`)
- A legendary card waits face down for 1.9 s (`LEGENDARY_BUILD_MS`; a tap
  flips sooner): the room warms to gold, legendary rays spin, sparkles rise
  and the card back glows and trembles. The flip flashes gold, throws a ring
  of light and a spray of sparkles, stamps **LEGENDARY!** / **أسطورية!** and
  plays `sting("legendary")` (for legendary shards too). Reduced motion keeps
  a still gold glow and the sting.
- Sparkle layouts are seeded and pure (`src/ui/sparkles.ts`, tested).

## Reward claims (`src/ui/components.ts`, `src/ui/styles/rewards.css`)
- `rewardBurst` / `rewardBursts`: 4-12 coins (or gems) scatter from the claim
  button and swoop into the wallet counter on screen; the counter ticks up as
  they land and ends exactly on the new total. The wallet is looked up after
  the caller's re-render (`[data-wallet]` pills, the top-bar chips, the chest
  room's pills). Reduced motion just shows the total.
- Used by the Trophy Road and Crown Pass claims (both screens now carry a
  gold / gems wallet in their header; the road's trophies stay on the "You"
  marker), Profile achievements, and chest gold and gems on Collect.
- Toasts now stack near the bottom of the screen, lifted above the tab bar
  or a sticky footer (`toastBottom`, tested), so they never cover a screen
  title or the wallet (checked on road, pass, Events, chest room).

## 3-crown win (`src/render3d/result.ts`)
- `celebrationFor(outcome, myCrowns)`: a 3-crown win slams its crowns in one
  by one (the panel thumps; the legendary sting on the third), stamps
  **3 CROWNS!** / **٣ تيجان!** under the ribbon with a sparkle burst, and
  throws twice the confetti, bigger, with gold crowns in it
  (`confettiPlan`). Other wins are unchanged (42 pieces); reduced motion
  shows everything still.

## Golden Age Crown Pass text (`src/ui/passText.ts`)
- The Arabic-Indic zero (٠) is a dot, so "المستوى ٠ · ٢/١٠" read like
  "2/1000". Golden Age now writes "المستوى ٠، ٢ من ١٠" ("2 of 10") and
  separates parts with the Arabic comma everywhere on the pass screens;
  Classic keeps "Tier 0 · 2/10". The Profile's "Cards found" uses the same
  form. Tested: no dot, middle dot or slash next to a zero.

## Forcing a legendary reveal (manual check)
Fresh profile, `cr-clone-trophies` = 450, `cr-clone-chests` =
`[{"rarity":"rare","readyAt":0},null,null,null]`, `cr-clone-legendary-pity`
= `8`: open the chest from the Chests room and the Digger arrives with the
full build-up (with `digger` already in `cr-clone-owned`, legendary shards
arrive instead).

## Verified
- `npx tsc --noEmit`, `npx vitest run` (125 files, 1417 tests), `npm run build`
  pass; `tools/perf-budget.mjs` 152 empty / 380 fight calls (budgets 220 /
  450). `golden.test.ts` and `bot.test.ts` byte-identical.
- In the real game (headless Chromium, both editions): legendary frames in
  the collection, deck builder, card info and battle hand; forced legendary
  chest (new card and shards) with build-up, burst and summary, calm variant;
  coin bursts and counting wallets on road, pass screen, Events tab, profile
  achievements and chest Collect; toasts below titles; a forced 3-crown
  ladder win (EN 390x844, AR 360x740, calm 844x390) and a 1-crown win
  unchanged; Golden Age pass pill / bar text. No horizontal scroll at
  390x844, 360x740, 844x390, 1280x800; no console or page errors.

## Known gaps
- The battle result's Crown Pass line ("+3 Crown Pass 3/10") is drawn by
  `src/meta/rewardsWire.ts`, outside this package; it still uses a slash.
- Home's quest claims (`home.ts`) and the Home upgrade offers keep their own
  code: quests do not burst yet, and crafting a legendary shard costs the
  same 15 gold as any other (`SHARD_GOLD_PRICE`, shared with `home.ts`).
- The pity counter is not shown to the player.
