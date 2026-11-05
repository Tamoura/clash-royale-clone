# Enhancement Plan (living roadmap)

Prepared as the game developer on the project. Grounded in the actual
architecture (pure deterministic sim in `src/game/`, thin render/audio/net
shell) and in measured signals from self-play testing.

> This is a living doc — reorder, prune, and check items off as we ship.

## Current state

**Strengths**
- Pure, deterministic, fully-tested simulation (`src/game/`). The renderer
  (`src/render3d/`), audio (`src/audio/`), and net (`src/net/`) are a thin
  shell driven by the sim's event stream. → replays, balance testing, and
  puzzle scenarios are cheap to build.
- 29-card pool, 8-card decks, trophies + card levels, bot difficulties,
  elixir-rate game modes, LAN 1v1 lockstep, character gallery.

**Known issues (data-backed via self-play, 2026-06 → updated 2026-07):**
- ⚖️ ~~Giant / hog-rider / balloon underperform~~ **Fixed** (stat buffs +
  bot win-con piloting fix); lab now scores them 50.0/50.0/50.8%. Remaining
  outliers: royal-giant 43% (weak), pekka 57% (strong).
- 🤖 ~~Bot never casts rage or freeze~~ **Fixed** (plus elixir-advantage
  cycling). Stalemate rate not yet re-measured after these changes.
- 🐛 ~~Self-play CI guard~~ **Done** — invariants test in
  `integration.test.ts` runs with the suite.

## Design pillars
1. **Feel great** — every hit, deploy, and tower fall has weight.
2. **Be fair** — balance backed by data, not vibes.
3. **Be replayable** — modes, progression, matches that resolve.
4. **Teach** — the audience is kids; lean into that edge.

## Tracks

### A — Game Feel & Juice (do first: low effort, highest felt impact) ✅
- [x] Crown-pop animation on the HUD when a tower falls (S)
- [x] Spell **radius telegraph** while dragging any spell (S–M)
- [x] Hit-stop / impact flash + screen-shake tuning on heavy hits & tower falls
      (S) — render-only (`render3d/hitstop.ts`); sim timestep untouched
- [x] Elixir-leak warning (bar flashes at 10) + deploy ghost preview (S)
- [x] Sandbox/practice mode (infinite elixir, sleeping bot, instant reset,
      no rewards) — see `notes/features/sandbox-mode.md`

### B — Balance & a reusable "Balance Lab"
- [x] Commit the controlled card-swap harness as a `npm run balance` tool
      (runs via vite-node; `npm run balance -- 64` for bigger samples)
- [x] Buff giant/hog/balloon to ~parity, verified by the lab. Post-fix
      (n=128): giant 50.0% · hog 50.0% · balloon 50.8% ✅
- [ ] Per-card stat audit vs CR reference numbers (M). Lab flags to start
      with: **royal-giant 43.0% (weak) · pekka 57.0% (strong)** as the
      deck's win-con slot

Method note: the swap test MUST score the mirror (a card swapped for itself) at
exactly 50% — that's the unbiased-harness check. Replace one card *in place*
(deck order changes the opening hand) and pair the same seed across both
orientations (cancels side/tempo bias). Swap candidates into the deck's
**win-con slot**, not a support slot — otherwise you measure a two-win-con
deck (and a duplicate card when the candidate is already in the base deck).

Finding (2026-07, via the lab): balloon's terrible win rate was partly a
**bot bug, not a card problem** — with two equal-cost win-cons in hand the
push logic always broke the tie the same way, so the second win-con rotted
in hand all match. Fixed: random tie-break + balloon escorts a leading tank.

### C — Bot AI & Sim Safety
- [x] Teach the bot **rage** (own push) & **freeze** (defending cluster)
- [x] Elixir-advantage awareness: cycle a cheap card in the back when ahead
      instead of leaking at 10 (stalemate rate not yet re-measured)
- [x] Win-con piloting fix: random tie-break between equal-cost win-cons +
      flying win-con escorts a leading tank (was: balloon rotted in hand)
- [ ] Make "Hard" genuinely hard: cycle tracking, predictive defense (M)
- [x] Self-play **invariants test in CI** (no NaN / hp>maxHp / elixir range /
      off-board / games finish within overtime; 3 seeds)

### D — Modes & Replayability (cheap thanks to determinism)
- [ ] **Replays** — store inputs, replay the deterministic sim (M)
- [x] Draft mode — 8 rounds of pick-1-of-3 from the full pool, the bot
      takes one of the rest (`game/draft.ts`, seeded/deterministic)
- [x] Challenge/puzzle mode — 3 scripted "defend this push" scenarios,
      survive-N-seconds win, first-clear gold (`game/challenges.ts`)
- [x] Daily seeded challenge — mirror deck of the day from a date hash,
      +100 gold once per day (`game/daily.ts`)

Special modes never move trophies/chests (only ladder does); "Play again"
replays the same mode. See `notes/features/draft-challenge-modes.md`.

### E — Progression & Meta ✅ (`src/meta/`, fully tested)
- [x] Chest/reward loop → gold/gems → upgrades (chest slots, timers,
      gem-skip)
- [x] Card collection + upgrade-cost economy screen
- [x] Arena unlocks tied to trophies (bot drafts only cards unlocked at
      the player's arena)

### F — Multiplayer & Social
- [ ] Hosted relay (beyond LAN) + rematch (L)
- [ ] Emote wheel + more emotes (S)
- [x] Share-a-deck code (S): shipped as decks-qol in the 2026-11 round (see below)

### G — Tech, Perf, Accessibility, Mobile
- [ ] InstancedMesh for crowds/troops (M)
- [ ] Settings: sound toggle, reduced-motion, colorblind HP palette (S)
- [ ] PWA/touch polish → Capacitor app (L)

### H — Educational (differentiator)
- [ ] Tinker mode — edit a card's stats in-game, then battle it (M)
- [ ] In-game guided tutorial ("how it works" as you play) (M)

### I — Modeling & Character Polish (better-looking troops)
Current characters are procedural toon/"vinyl figurine" rigs in
`render3d/characters3d.ts` (RoundedBox + spheres, shared grain map,
`MeshToonMaterial`, ~29 per-card builders). Make them read better and look
more premium. Uses the installed 3D skills (3d-modeling, 3d-rigging,
3d-texturing, 3d-animation, three-best-practices).
ART DIRECTION (decided): **CR chunky-cartoon** (big head, bold cel outline),
chosen via a 4-style prototype comparison. Shipped on PR #94:
- [x] **Material variety / rim light** — Fresnel rim baked into shared
      `toon()` (addRimLight via onBeforeCompile); +20% saturation; cleaner
      grain. All 29 + towers pop.
- [x] **Lighting** — softer battle shadows + cool back-rim in scene3d.
- [x] **Hero passes** — Knight (kite shield, plume, gold diamond emblem),
      Wizard (hat + glowing crystal staff), P.E.K.K.A (glowing sword edge);
      enhanced Valkyrie, Mini-P.E.K.K.A (glow cleaver), Giant.
- [ ] **Bloom post** in the BATTLE scene (glows: gems/eyes/visors/orbs/
      projectiles). Deferred — render-pipeline change (EffectComposer +
      UnrealBloomPass + OutputPass); couldn't verify a headless battle
      unattended. Next visual win.
- [ ] **Big-head proportion pass** — heads aren't grouped with hats/hair,
      so it's per-builder, not a safe global. Optional.
- [ ] **Further detail** for remaining units (most are already well-detailed;
      candidates: Prince, swarm units) (M)
- [ ] **Perf guard** — LOD/instancing if detail grows (M)

Note: most of the roster was already richly modeled; "still basic" was mainly
the Knight + flat lighting, both fixed.

## Enhancement round 2026-11: fair, clear and new for kids
Plans: wave 1 and wave 2 (rebuilt); each package has its own notes file.
Final branch: `claude/game-visuals-character-balance-w122wb`.

### Wave 1 (merged)
- [x] **sim-card-wave** (`sim-card-wave.md`, `card-wave-3.md`): sim v3
      (SIM_VERSION 3 / PROTOCOL_VERSION 3) with Stone Golem (+ Pebble Golem
      token), Digger and Comet; the death-loop fix; spawned units take the
      spawner's level; a rebalance; overtime pacing (60 s at 3x elixir, troop
      hits on crown towers x3).
- [x] **online-truth** (`online-truth.md`): a forfeit is the forfeiter's
      loss; your towers are always your colour; rematch offers reach the other
      player; a friend who leaves is named as such; codes with a dash join.
- [x] **first-hour** (`first-hour.md`): the tutorial without the KING/Skip
      trap, trophy floors, a practice tier, twelve challenges, hints after a
      loss, and joining from a link on the first visit.
- [x] **battle-clarity** (`battle-clarity.md`): refused drops say why, the
      KING charge, card info, goal and tiebreak text, the left-match settle
      and replay polish.

### Wave 2 (merged)
- [x] **card-wave-art** (`card-wave-art.md`): real Stone Golem, Pebble Golem
      and Digger rigs in both editions, a Comet portrait, the Digger's tunnel
      mound and emerge burst, the Comet's ring, fall and impact, the golem
      crumble, new sounds, three card trials (playable with locked cards),
      retuned challenge stars, the "New cards!" Home sheet and a soft tower
      hit flash.
- [x] **rewards-legendary** (`rewards-legendary.md`): a Legendary tier (Magic
      Archer, Electro Wizard, Princess, Mega Knight, Digger, Comet) with
      rarer odds and a Rare-chest guarantee, a legendary frame and reveal,
      coin-burst claims with a counting wallet, a 3-crown celebration, and
      Golden Age Crown Pass text that reads right.
- [x] **decks-qol** (`decks-qol.md`): three deck slots (the old deck migrates
      into slot 1), shareable deck codes (`K7Q2-M9XA` style, with a check
      character), swap mode on a full deck, and tab badges.
- [x] **Integration fixes** (final round check): the New cards sheet is
      switched on (`registerNewCards(ctx)` in main.ts); the Home Shop crafts
      legendary shards at the card-info price (200 gold) and its hint says
      so; the deck-code preview speaks of one locked card in the singular
      (EN/AR); the result screen's Crown Pass progress reads "٣ من ١٠" in
      Golden Age.

Checked at the end of the round: `npx tsc --noEmit`, `npx vitest run`,
`npm run build:all`, `tools/perf-budget.mjs` in both editions (inside the
220 / 450 budgets), `tools/relay-smoke.mjs` against the combined server,
a two-browser Play-a-friend match in both editions with decks holding Stone
Golem, Digger and Comet (deck slot plus deck code; sync checksums all agree;
forfeit gives DEFEAT / VICTORY), and both editions at 390x844 and 1280x800
(Home with the New cards sheet and badges, a bot battle with the new cards,
the 3-crown result, a forced legendary chest, a road claim burst, deck slots
and codes, swap mode, trials, the Shop).

### Deferred (not this round)
- [ ] New card wave B: Venom Cloud, Blaze Lantern, Ballista
- [ ] Online resume after a reload
- [ ] Per-side Champion online
- [ ] Tower level scaling
- [ ] Bot end-game "go for it" mode (ladder 0-0 rate is ~55% bot-vs-bot)
- [ ] Destroy-the-King challenges
- [ ] Card mastery, weekly events, Legend Path
- [ ] Battle log of 10 replays
- [ ] Save export / import
- [ ] 8 emotes online, plus a name / crest picker
- [ ] Wide-screen Home layout
- [ ] Sandbox enemy placement
- [ ] Draft deck reveal
- [ ] Desktop hover states
- [ ] Bigger emotes
- [ ] Home diorama reset after a battle
- [ ] Per-arena prop kits
- [ ] Spring secondary motion
- [ ] KayKit parity
- [ ] Balance edges: Mini P.E.K.K.A (~62.6%) and Giant / Royal Giant
      (~38-40%)

### Open problems after this round
- [ ] Particle sizes for the Digger emerge and Comet impact bursts were
      judged on SwiftShader (about 13 fps). Check them on a real GPU.
- [ ] A Comet that lands on a tower puts its crater and scorch under the
      tower body, so only the airborne part of the blast shows there.
- [ ] Bridge Spam (3 stars) clears 0/30 for the Easy bot and 9/30 for the
      Normal bot. It is the hardest challenge; watch kids' clear rates.
- [ ] The 2D painted fallbacks for the new cards (`render/characters.ts`) are
      Classic-only. The Golden Age looks come from the 3D portraits.
- [ ] Home quest claims and the Shop's upgrade offers have no coin burst yet.
      The legendary pity counter is not shown to the player.
- [ ] Battle tooltip / card-info trait lines still mix Latin digits into
      Arabic (e.g. "35٪").
- [ ] Toasts from switching slots or loading a code sit over the top bar
      (components.toast placement).
- [ ] In the Lilita One font a zero looks like an O in deck codes. It does
      no harm: O is read as 0 when a code is entered.
- [ ] Tab badge counts refresh through refreshTopBars or a Home redraw; a
      change that only calls ctx.persistProfile shows up on the next Home
      build.
- [ ] Golden Age Pebble Golems are small and sand-coloured, so they are hard
      to see on the sand bridges at 1280x800.

## Recommended sequence
1. **Feel & Safety** — Track A juice + the self-play CI guard (C).
2. **Fair & Complete** — Balance Lab + win-condition buff (B) + bot rage/freeze (C).
3. **Replayability** — Replays + Draft/Challenge (D).
4. **Retention** — Progression loop (E).
5. **Look & Teach** — Character polish (I) + Tinker mode (H) + mobile/online (F/G).

Effort key: S = hours · M = 1–2 days · L = 3+ days.
