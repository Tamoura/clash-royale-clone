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

**Known issues (data-backed via self-play, 2026-06):**
- ⚖️ Win-conditions **giant / hog-rider / balloon underperform** — confirmed
  three independent ways (random-deck, single-deck controlled swap, multi-deck
  controlled swap). Giant ranked lowest in every context.
- 🤖 Bot **never casts rage or freeze** (two dead cards), and **~38% of games
  stalemate** to overtime even after the piloting/closing improvements.
- 🐛 A whole bug class (no arena bounds — Firecracker recoil walked units off
  the field) slipped through until self-play found it. → make self-play a
  permanent CI guard.

## Design pillars
1. **Feel great** — every hit, deploy, and tower fall has weight.
2. **Be fair** — balance backed by data, not vibes.
3. **Be replayable** — modes, progression, matches that resolve.
4. **Teach** — the audience is kids; lean into that edge.

## Tracks

### A — Game Feel & Juice (do first: low effort, highest felt impact)
- [ ] Crown-pop animation on the HUD when a tower falls (S)
- [ ] Spell **radius telegraph** while dragging any spell (S–M)
- [ ] Hit-stop / impact flash + screen-shake tuning on heavy hits & tower falls
      (S) — render-only; never touch the sim timestep (would break lockstep)
- [ ] Elixir-leak warning (bar flashes at 10) + deploy ghost preview (S)
- [ ] Sandbox/practice mode (infinite elixir, reset) (S)

### B — Balance & a reusable "Balance Lab"
- [ ] Commit the controlled card-swap harness as a `npm run balance` tool (M)
- [ ] Buff giant/hog/balloon to ~parity, verified by the lab (M)
- [ ] Per-card stat audit vs CR reference numbers (M)

Method note: the swap test MUST score the mirror (a card swapped for itself) at
exactly 50% — that's the unbiased-harness check. Replace one card *in place*
(deck order changes the opening hand) and pair the same seed across both
orientations (cancels side/tempo bias).

### C — Bot AI & Sim Safety
- [ ] Teach the bot **rage** (own push) & **freeze** (defending cluster) (S–M)
- [ ] Cut stalemates: elixir-advantage awareness + counter-push timing (M)
- [ ] Make "Hard" genuinely hard: cycle tracking, predictive defense (M)
- [ ] Self-play **invariants test in CI** (the harness that found the recoil
      bug): no NaN / hp>maxHp / elixir-range / off-board / infinite game (S–M)

### D — Modes & Replayability (cheap thanks to determinism)
- [ ] **Replays** — store inputs, replay the deterministic sim (M)
- [ ] Draft mode (pick from offered cards) (M)
- [ ] Challenge/puzzle mode (scripted "defend this push") (M)
- [ ] Daily seeded challenge (M)

### E — Progression & Meta
- [ ] Chest/reward loop → card shards → upgrades (M)
- [ ] Card collection + upgrade-cost economy screen (M)
- [ ] Arena/theme unlocks tied to trophies (M)

### F — Multiplayer & Social
- [ ] Hosted relay (beyond LAN) + rematch (L)
- [ ] Emote wheel + more emotes (S)
- [ ] Share-a-deck code (S)

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
- [ ] **Silhouette & proportion pass** — chibi head-scale + distinct
      per-class silhouettes so every card reads at a glance (M)
- [ ] **Faces & expressions** — cleaner eyes/brows, idle blink, attack
      grimace (M)
- [ ] **Material variety** — two-tone trims; cloth vs metal vs skin; rim
      light / Fresnel so shapes pop (M)
- [ ] **Animation polish** — secondary motion (capes, hair, tails jiggle),
      better anticipation/follow-through on attacks (M)
- [ ] **Lighting & post** — rim light, softer shadows, subtle bloom on
      glowing bits, light color grade (S–M)
- [ ] **Hero passes** for marquee cards (Knight, Wizard, P.E.K.K.A, Prince,
      dragons) — extra love where it's most seen (M)
- [ ] **Perf guard** — LOD/instancing if detail grows (3d-asset-optimization) (M)

Open art-direction decision (drives everything): keep & refine the vinyl/toy
look, go CR-accurate chunky-cartoon, push toward semi-realistic/PBR, or lean
cute-chibi. Then choose scope (a few hero cards first vs all 29).

## Recommended sequence
1. **Feel & Safety** — Track A juice + the self-play CI guard (C).
2. **Fair & Complete** — Balance Lab + win-condition buff (B) + bot rage/freeze (C).
3. **Replayability** — Replays + Draft/Challenge (D).
4. **Retention** — Progression loop (E).
5. **Look & Teach** — Character polish (I) + Tinker mode (H) + mobile/online (F/G).

Effort key: S = hours · M = 1–2 days · L = 3+ days.
