# Enhancement plan, November 2026 (after the Toy Tournament art round)

Made at 749b073 by six read-only scouts (gameplay and content, feel and audio, visuals, UX and kids, tech and online, a live playtest), a merge into 50 items, three blind judges (kid advocate, parent, engineer), a lead planner, a completeness critic and one revision. Evidence paths under /tmp are from the planning session and may be gone.

## Where Crown Rush stands

The battle is in great shape: toy-like characters, crumbling towers, a slow-motion knockout, a gentle tutorial, 42 cards, 11 arenas, challenges and friend games. The weak spots are around it: bots that jump from sleepy to unbeatable (Normal and Hard both crush a beginner; in bot tests Hard even loses to Normal), small traps that leave a young player stuck, a slow start, progress stuck on one device, and updates that go live untested and can end a match. Here are five rounds plus two optional ones, none changing the battle rules. Times are clock time with two or three helpers in parallel; the total work is about double.

## Next: "Fair, kind and never stuck" (about 4–6 hours)

- **Updates stop reaching the kids untested.** The live game waits for the automatic checks, or for your "release". Tiny. (C46 part)
- **The tutorial can't get stuck.** Drag the wrong card and the right one wiggles while the coach names it. The music softens while it waits. Small. (C02, C27 part)
- **Bots get harder one step at a time.** "Hard" is really hard, and a friendly line says when the bot gets smarter or friendlier. Medium. (C01)
- **A chest never swaps out their Giant.** "Keep my deck" is the safe choice, then they choose which card leaves. Small to medium. (C18)
- **The 1st of the month never takes an arena away.** Small. (C04)
- **The computer stops laughing at them**, and the laughing and angry faces leave the emote picker. Tiny. (C28 part)
- **Online gets safer today.** Matching with strangers is switched off and room codes get much harder to guess. Small. (C38 part)
- **The words are right.** "Win" is spelled correctly in Arabic, digits match on the season, card info and tower health, and the icon says "Crown Rush". Small. (C21, C19)

## Later rounds

**2. Opens every time, keeps every trophy** (4–6 hours): the icon opens at once, even offline or while the server sleeps (C41); "Oops, keep playing?" instead of a frozen battle, no blank loading screen, and a problem report you can copy (C43); a save code to back up progress and move it to a new tablet (C42); old tablets pick smoother graphics by themselves (C44).

**3. Play together, safely** (5–7 hours): a big "Play a friend" button on Home and a "waking up the server…" screen that connects by itself (C39, C40); a grown-ups corner with emote mute, an optional break reminder, a note on how online works, and a strangers switch only if you want one (C38); a browser check before each update, and updates wait for a sibling match to finish (C46).

**4. Clear and friendly in battle** (4–6 hours): cards fill up as elixir comes in instead of a confusing "+2", with a chime when the big card is ready (C14); eight original, friendly emotes (C28); proper sounds for spells and buildings (C23); their designed champion looks the same in battle (C50).

**5. New things to try** (4–6 hours): original names for the Classic cards, arenas and towers, with a "your cards got new names" page (C20); Sandbox and Challenges open right after the tutorial (C03); puzzles about knocking towers down (C05).

**Two optional rounds after that:** an Adventure Trail map with stars and a boss at each arena (C06, a round or two), then "Big moments": the king cheers after the knockout, crowns go "ding" and results music plays (C25).

## Decisions for you

**Before round 1**
1. **How updates go live:** straight away, as today / after the automatic checks / only when you press "release" (our pick).
2. **Strangers online:** none at all (our pick) / a grown-up switch in round 3 (this reopens stranger matching on the server, guarded only by each tablet's switch) / as today.
3. **Youngest player:** reads comfortably / beginner reader (a read-aloud tutorial joins round 1, 1–2 hours more) / a non-reader plays too (an extra round with read-aloud and a helper bot).
4. **Monthly season:** trim trophies, never below their arena (our pick) / no trim, just a fresh Crown Pass.
5. **Is "Crown Rush" the final name?**

**Later**
6. **Names (before round 5):** we draft a toy-themed list and you choose / the kids pick from it / keep them (not advised on a public link). Includes "Princess" towers and the word "elixir".
7. **Which link is home (before round 3):** Render (a minute to wake) / GitHub Pages on the icon (instant). Wait for the save code before moving the icon or renaming the web address.
8. **Break reminder (before round 3):** off unless you turn it on / on at 30 minutes / don't build it.
9. **Daily reasons to come back (before round 5):** none beyond the Trail / something gentle (a party-mode event, a no-guilt sticker card) / a full daily-quest revamp.

## What we'd skip for now

- **Battle rule changes:** a Giant balance pass (C13) and 2v2 (C12). If done later, they ship together and both players need the new version online.
- **Big or rare:** arena makeovers (C34), rejoining after a reload (C47), a language switch (C22), a faster first load (C45). Crash reports from the kids' tablets are left out on purpose, for privacy.
- **Later:** card picture stats (C15), read-aloud (C16), helper bot (C10), 3D chest (C37), spell art (C33), menu restyle (C35), troops on Home (C49), arena pictures (C48), sandbox lab (C09), daily goals (C07), polish (C17, C24, C26, C27, C29–C32).
- **Probably never:** replay shelf (C11), mastery badges (C08), laptop layout (C36).

## How we'd check it

- **Round 1:** automatic tests; a failing update that never goes live; phone screenshots in both editions; 20 minutes watching the kids play.
- **Round 2:** the installed game offline; a forced glitch; a save moved between browsers; your oldest tablet.
- **Round 3:** a friend match while the server sleeps; an update mid-match; the grown-ups lock.
- **Round 4:** sound tests and a listen; emotes in a friend match.
- **Round 5:** a test bot wins every new puzzle; old saves and deck codes still load; the kids try it.

---

## Rounds in detail (for the build agents)

### Fair, kind and never stuck

- Theme: Remove the moments where a kid gets stuck, mocked, unfairly crushed or quietly loses something, and stop untested updates reaching the live game
- Size: 4-6 hours wall-clock (about 9-10 h summed agent work, 3 helpers in parallel)
- Changes the battle sim: no
- Items: C46:deploy-gate, C02, C27:tutorial-music-dip, C01, C18, C04, C28:no-bot-taunts, C38:quick-match-off, C38:guess-proof-codes, C21, C19

Holds all three unanimous do-first picks (C01, C02, C18, mean 8-8.7), the cheapest high scorers (C04, C21, C19) and the one-line kindness and safety slices every judge flagged. Re-checked at 749b073. ITEM 0 (C46 deploy gate, critic major 1): render.yaml:24 deploys the working branch and :32 sets autoDeployTrigger: commit, and deploy.yml:9 publishes Pages from the same branch. Set checksPass now. If decision 1 is 'release', point Render's branch and deploy.yml's Pages trigger at a release branch the owner moves on purpose, and make deploy.yml run on that branch so checksPass has checks. The owner may need to confirm the branch in the Render dashboard. Do this first, before the round's own commits land. C01: re-tune TIER_PROFILES (difficulty.ts:30-50) with the rookie knobs. Any smarter Hard must be an optional BotProfile knob that defaults off. Tapes store the full botProfile (main.ts:200, :669), so profile values are replay-safe. Hidden coupling found by the critic: challenges.test.ts:201 solves puzzles with DIFFICULTIES.normal, and with the proposed Normal, air-raid drops to 1/10 and sky-pirates rises to 10/10. Add a frozen SOLVER_PROFILE {thinkInterval 1.0, pushAt 8}, update the difficulty.test.ts:46 pin, re-set the novice.test bands, make the ladder a permanent curve test, and add banners for both stepping up and stepping down. C18: ship the 'Keep my deck' default (confirm emphasis 'cancel') and hold the Add buttons until the summary first; the card picker comes second (S-M). C28 slice: remove the taunts at main.ts:1291 and :1417-1418. The picker drops indexes 0 and 3 (laughing, angry) and adds two friendly glyphs at 4-5; showOnlineEmote (online.ts:264-266) silently drops unknown indexes, so there is no protocol bump. Update noEmoji.baseline.json. C38 slice (critic major 2, partly corrected): QUICK_MATCH=off in render.yaml envVars, and lobby readTab defaults to 'friend' (lobby.ts:47-53). Codes are word+2 digits, 2,000 in all (codewords.ts), and waiting rooms live 10 min (rooms.ts:32). The relay already limits create/join to 5 per IP per 10 s (relay.ts:61-62, :196), so one IP needs about 65 min to sweep the codes, not 'under a minute'. Several IPs make it feasible, and there is no miss counter. Add a per-IP failed-join counter (e.g. 10 misses in 10 min, then 'rate-limited' for 10 min) with a relay test. New rooms get word+3 digits (20,000). normalizeCode (codewords.ts:65) accepts any digit count and the code box allows 12 characters (lobby.ts:260), so old clients still join. C21 with the corrected scope (season key, trait numbers, HP plates, aria-labels). C19, if decision 5 confirms the name: title, apple title, boot-title and manifest, and decouple SHELL_MARK (sw.js:30) into a dedicated marker with sw.test; internal ids stay. If decision 3 is 'beginner reader', a tutorial-only C16 slice with recorded lines joins (+1-2 h). Summed agent work is about 9-10 h; C01 plus its harness is the long pole. Sets up the ladder the Trail needs.

### Opens every time, keeps every trophy

- Theme: Trust and reliability: the game opens instantly (even offline), never freezes or goes blank, runs smoothly on old tablets, and progress can be backed up and moved
- Size: 4-6 hours wall-clock (about 10-12 h summed agent work)
- Changes the battle sim: no
- Items: C41, C43, C42, C44
- Status: round 2 built and verified (all four items reviewed, merged together, tests and production builds passing, checked in headless Chromium; not yet on a real phone or tablet). Details: notes/features/offline-and-boot.md, crash-shield.md, save-backup.md and auto-graphics.md.

Four M items in separate files, so they parallelise well. C41: inject the emitted dist/assets list from the vite stamp plugin into a precache array, race navigations against a 2.5-3 s timer, and refresh the worker before the update-required reload. It builds on round 1's decoupled SHELL_MARK; if C19 waited for the name, it rides here. C43: try/finally around frame() (main.ts:1309-1432), global error and unhandledrejection handlers, a splash that waits for boot (index.html:53), and online matches abort as no-contest. Its local 'Problem report' with a copy button is deliberately the owner's only error view: there is no remote crash reporting, for privacy. C42: a save code or file, a central key-registry test and navigator.storage.persist(). It must ship before the parent moves the icon to Pages or renames the public address (decision 7), because new origins start with empty saves. C44: count a sustained slow window as a step-down signal (quality.ts:264) and remember the level per device. Must come before round 3 (C40 depends on C41) and before any bundle split (C45). Summed about 10-12 h.

### Play together, safely

- Theme: Siblings and friends play each other easily, a sleeping server never shows an error, a grown-up controls online play, and updates don't break live matches
- Size: 5-7 hours wall-clock (about 10-13 h summed agent work; less if no strangers)
- Changes the battle sim: no
- Items: C40, C39, C38, C46

The family use case. C40: a fire-and-forget /healthz pre-wake at boot and when the Battle menu opens; treat 'unreachable' within about 75 s as 'waking', retry with backoff, and add Try again to the join flow (roomClient.ts:50, lobby.ts:527-529). C39 (S) depends on C40. C38: parent gate, emote mute, break reminder per decision 8, and a 'how online works' note. If decision 2 is 'none', the strangers switch and nicknames drop and C38 shrinks to M. If it is 'grown-up switch', Quick match is turned back on at the relay for everyone, with only the device gate in front of it. Say that plainly in the note. C46: a puppeteer-core CI smoke test gating on pageerror and counters, not fps; a relay drain on SIGTERM (relay.ts:413) with maxShutdownDelaySeconds; relay.yml aligned to Node 22. Round 1 already did checksPass and the branch. No protocol or sim change. Summed 10-13 h, or 8-10 h with no strangers.

### Clear and friendly in battle

- Theme: Every battle teaches elixir by sight and sound, emotes are friendly and original, every spell and building sounds like itself, and the designed champion matches
- Size: 4-6 hours wall-clock (about 9-11 h summed agent work)
- Changes the battle sim: no
- Items: C14, C28, C23, C50

Next by value per effort: C14 (mean 7.3, kid do-first) and C28 (7.0, kid and parent do-first). C14 adds the wipe, a throttled ready chime and the full-elixir nudge. It reads the resource word from one string, so decision 6 ('elixir' kept or renamed) is a one-line edit. C28 draws original inked emotes at wire indexes 4-7 and retires 0-3 from the picker, but keeps their glyphs for display. Old clients drop unknown indexes (online.ts:264-266), so no PROTOCOL_VERSION bump and no reload. C23 gives each spell a named cue with no Arrows fallback, plus separate building, princess and king death cues and a coverage test. It also provides the king cue the optional Big moments round needs. C50 is S: build the Studio preview from championVariant (cast/champion.ts:105), falling back until castReady. Summed about 9-11 h.

### New things to try

- Theme: Original names that belong to this game, low-pressure modes open from day one, and puzzles about attacking instead of only defending
- Size: 4-6 hours wall-clock (about 9-11 h summed agent work)
- Changes the battle sim: no
- Items: C20, C03, C05

Week-one goals, and it lays the track for the optional Adventure Trail. C20 goes first because it needs decision 6 and because Trail bosses show arena names. It is display-only: cardDisplayName plus a per-arena display name, with every id and storage key untouched. The scope now also covers the Princess tower troop (towers.ts:29), the Princess card (cards.ts:589), Tower Princess (gallery.ts:58), the HUD lines (hudModel.ts:470-475), Cannoneer, Dagger Duchess and Trophy Road. Add a denylist test and the one-time rename sheet. C03: open Sandbox and Challenges after the tutorial and keep the 'Try it' trials reachable (kid judge); this settles the lock policy before any C07 event. C05: goal types as pre-battle setup, so golden.test is untouched. Solvability uses round 1's frozen SOLVER_PROFILE. Add one seeded checksum fixture per solo mode (challenge, sandbox, draft, mirror, crazy), because golden.test locks only a standard match (engineer note). If decision 9 is 'gentle', the C07 party-mode tile can join. Summed about 9-11 h.

**Recommended next:** Do 'Fair, kind and never stuck' next. It holds the three unanimous do-first picks (C01, C02, C18) and the cheapest high scorers, and it starts by stopping untested commits from going live on the branch every later round will push to. No battle rules change. It removes the moments where kids get stuck, mocked, bounced between a sleepy bot and an unbeatable one, or quietly lose their Giant, and it builds the bot-ladder test (with a frozen puzzle solver) that the puzzles and Trail rely on later.

## Decisions for the owner

- BEFORE ROUND 1. How updates go live (C46): (a) every change goes live immediately, as today (Render deploys the working branch on every commit); (b) live only after the automatic checks pass; (c) live only when you promote a release branch (recommended). Both the Render and Pages copies would follow that branch.
- BEFORE ROUND 1. Strangers online (C38): (a) none at all: Quick match stays off and round 3's grown-ups corner has no strangers switch (recommended; simplest and safest); (b) a grown-up switch in round 3, which turns Quick match back on at the server for everyone, with only the gate on each tablet in front of it; (c) keep Quick match on as today (not advised).
- BEFORE ROUND 1. Youngest player (C16, C10): (a) everyone reads comfortably, so no read-aloud for now; (b) a beginner reader, so read-aloud for the 7 tutorial steps joins round 1 (+1-2 h; Arabic voices need a check on a real phone); (c) a sibling who can't read yet also plays, so add a round with read-aloud plus the defend-only helper bot.
- BEFORE ROUND 1. Monthly season (C04): (a) still trim trophies but never below the kid's current arena (recommended); (b) no trophy trim; a season is just a fresh Crown Pass plus a 'season best' badge.
- BEFORE ROUND 1. Game name (C19): (a) confirm 'Crown Rush', and it goes on the icon, tab and loading screen in round 1; (b) pick another name first, and C19 moves to round 2.
- BEFORE ROUND 5. Original names (C20): (a) we draft a toy-themed sheet for the Classic cards, arenas, tower troops (including 'Princess') and labels, and you choose; (b) the kids name them in a family session from our list; (c) keep the current names (not advised on a public link). Also: keep the word 'elixir' or pick our own word for the resource.
- BEFORE ROUND 3. Which link is home (C41, C42, C40): (a) the Render link (one address, online works, about a 1-minute wake after 15 idle minutes); (b) the GitHub Pages link on the home-screen icon (opens instantly), with Render for online games only; (c) both. Don't move the icon until the save code ships in round 2; friend games from Pages become reliable in round 3. Renaming the public web address away from the copied name is possible too, but only after the save code exists, because a new address starts with empty saves.
- BEFORE ROUND 3. Break reminder default (C38): (a) off unless a grown-up turns it on; (b) on at 30 minutes; (c) don't build it.
- BEFORE ROUND 5. Daily reasons to come back (C07): (a) nothing beyond the Adventure Trail; (b) gentle: a rotating party-mode event tile and a weekly sticker card that never punishes missed days; (c) a full daily-quest revamp with varied missions and rerolls.

## Skipped for now

- C06: Not dropped: it is optional round 6. It depends on C01 (ladder, round 1), C05 (goal types) and C20 (arena names, round 5), and needs its own solvability harness on the frozen solver. Sized honestly at L to XL, it is a full round on its own, maybe two.
- C25: Not dropped: it is optional round 7 ('Big moments'). It is L on its own, needs C23's king cue from round 4, and must re-check online rematch and Play again timing. C29's crown-sync and chime slice rides along.
- remote-crash-reporting: Left out on purpose. Nothing is sent from kids' devices, for privacy. C43's local 'Problem report' with a copy button (round 2) is how the owner sees errors.
- C13: Changes battle rules: SIM_VERSION 4 and PROTOCOL 4, golden and bot re-capture, every saved tape invalidated, and both online players must update together. The evidence comes from a bot-piloted lab. Hold it until another rule change is due, after C01's harness exists.
- C12: An XL sim and protocol rewrite (two hands per side, new HUD, bot coordination). Two judges voted skip; the buddy bot (C10) gives much of the same-team feeling for far less.
- C34: XL art work, and the empty battle at 1440x900 is already over its 260k triangle target. More props are a perf risk on low-end devices. Two judges voted skip.
- C47: A rare case (tab discarded mid friend match) that needs a protocol bump, relay memory growth and a slow-phone fast-forward. All three judges voted skip.
- C22: L across 29 modules plus a bilingual test matrix, for a need nobody has asked for. C21 fixes the visible Arabic errors cheaply.
- C45: L with modest gains (three.js stays eager) that hard-depends on C41. Revisit after round 2 if the first load still feels slow on a real device.
- C15: Good clarity for young readers, but tile names should follow C20's rename (round 5). First candidate after the rounds.
- C16: Depends on decision 3: 'beginner reader' moves a tutorial-only slice into round 1. Arabic TTS can only be checked on a real phone.
- C10: Lovely for a 6-year-old, but the engineer flagged replay-tape and card-conflict costs (closer to M-L). Scheduled only if decision 3 says a non-reading sibling plays.
- C37: A delightful 3D chest, but L, and it adds another WebGL renderer on weak devices. Round 1's C18 fixes the harmful part of the reveal.
- C33: A visible consistency gain but mid-value. Bundle it with the next art round.
- C35: An L CSS pass over about 14k lines with RTL and layout risk. The cheap pieces (collapse the empty chest slots, keep the quest panel clear of the nav) can join a later polish sweep.
- C49: Charming, but it adds rigs and mixers to the screen low-end devices sit on longest.
- C48: Worth much more once arenas look distinct (C34), which is itself deferred.
- C09: A nice toy for 8-12 year olds but niche. Revisit after C03 opens Sandbox early and shows whether kids use it.
- C07: The parent judge voted skip (retention hooks not wanted by default). Decision 9; the party-mode tile alone can join round 5 if the answer is 'gentle'.
- C17: Only 6 labels are at 10px or below, and it helps only kids whose parent raises the text size. Later polish sweep.
- C24: L of per-card audio with mix-density risk. Do it after C23 (round 4) proves the cue structure.
- C26: Polish. The haptics half doesn't reach iPads, and a heartbeat can stress the youngest. The side-aware buzz bug fix is small and fits a later sweep.
- C27: Only the tutorial music dip is taken (round 1). The longer soundtrack and crowd bed are L and subjective, with mix-fatigue risk.
- C29: A subtle mis-sync most kids won't notice. Its sync-and-chime slice rides with C25 in optional round 7, after C23's chime exists.
- C30: Kids rarely read damage numbers in the chaos. Low value per effort.
- C31: A small clarity gain; the tutorial already teaches the KING button. Later polish sweep.
- C32: Cast-kit already added back features to the starter deck, so further gains are small within the triangle budget.
- C11: One 'Last battle' replay exists, young kids rarely rewatch, and every tape depends on bot.ts. Two judges voted skip.
- C08: An L of grind badges that reads as chores for 6-12 year olds. Two judges voted skip.
- C36: Laptop-only cosmetic work; a full-window diorama costs GPU on weak Chromebooks.

## All items with judge scores

Scores are kid / parent / engineer, 1-10.

| Id | Item | Effort | Mean | Kid | Parent | Eng | Sim |
|---|---|---|---|---|---|---|---|
| C01 | Smooth the bot difficulty ladder (fix the rookie-to-easy cliff and the out-of-order Hard tier) | M | 8.7 | 9 | 9 | 8 |  |
| C02 | Tutorial: respond when the kid plays the wrong card, and stop naming a card they're holding | S | 8.7 | 8 | 9 | 9 |  |
| C03 | A clean first Home after the tutorial: open Sandbox and Challenges, and hold back the locked 'New cards' sheet | M | 6.3 | 6 | 6 | 7 |  |
| C04 | The monthly season reset must never take an arena away | S | 7.3 | 7 | 8 | 7 |  |
| C05 | Attack puzzles: challenges about taking towers, not only surviving | M | 6.3 | 7 | 6 | 6 |  |
| C06 | Adventure Trail: a PvE map with star nodes and an original Gatekeeper boss at each arena | L | 7 | 8 | 7 | 6 |  |
| C07 | Daily reasons to come back: varied quests, a no-guilt weekly sticker card, and a rotating party-mode event on Home | L | 5.7 | 7 | 4 | 6 |  |
| C08 | Card mastery badges in the collection | L | 4.3 | 5 | 4 | 4 |  |
| C09 | Sandbox lab: drop enemy troops and test what beats what | M | 5.3 | 6 | 5 | 5 |  |
| C10 | Buddy mode: a helper bot defends your side for the youngest players | M | 6 | 6 | 7 | 5 |  |
| C11 | Replay shelf: the last 10 battles plus starred favourites | M | 4 | 4 | 4 | 4 |  |
| C12 | 2v2 Duo battles (kid plus parent, friend or buddy bot against two bots) | XL | 4.7 | 7 | 5 | 2 | yes |
| C13 | Win-condition balance pass: the starter Giant is the weakest card | L | 4.7 | 5 | 5 | 4 | yes |
| C14 | Teach elixir readiness: a filling wipe instead of '+N', a soft 'ready' chime, and an 'elixir full' nudge | M | 7.3 | 8 | 7 | 7 |  |
| C15 | Card clarity for young readers: names on collection tiles and picture-first card info | M | 6.3 | 7 | 6 | 6 |  |
| C16 | Read-aloud coach for kids who can't read yet (tutorial, coach tips, card info) | M | 6.3 | 6 | 7 | 6 |  |
| C17 | Text size setting reaches every label (no 7-10 px text) | S | 4.7 | 4 | 5 | 5 |  |
| C18 | Chest reveal: keep 'Add to deck' off the tap-to-continue path, and let the kid choose which card leaves | S | 8 | 8 | 8 | 8 |  |
| C19 | Show the game's own name, Crown Rush, instead of 'Clash Royale Clone' / 'CR Clone' | S | 6.3 | 5 | 7 | 7 |  |
| C20 | Give the Classic edition original card, arena, tower-troop and feature names | M | 5.7 | 4 | 6 | 7 |  |
| C21 | Golden Age language fixes: the 'win' verb, Latin digits, English aria-labels, plus a lint test | S | 6.7 | 6 | 7 | 7 |  |
| C22 | Separate the language from the edition (play the Golden Age look in English, or Classic in Arabic) | L | 4.7 | 5 | 5 | 4 |  |
| C23 | Fix mismatched sound cues: spells that play Arrows, and buildings that die like towers | M | 5.7 | 6 | 5 | 6 |  |
| C24 | Per-card sound identity: voices, attack sounds and death sounds from a data table | L | 4.7 | 6 | 4 | 4 |  |
| C25 | End-of-match sequence: an on-field celebration, then a result screen with sound and music | L | 6.3 | 7 | 6 | 6 |  |
| C26 | Make overtime feel like overtime, and make haptics tell your tower falling apart from winning one | M | 4.7 | 5 | 4 | 5 |  |
| C27 | A living soundtrack: longer battle music, a final-seconds layer, quiet tutorial waits, and a crowd you can hear | L | 4.3 | 5 | 5 | 3 |  |
| C28 | Replace the four raw-emoji emotes and the bot's laughing taunt with an original, friendly emote set | M | 7 | 8 | 7 | 6 |  |
| C29 | Tower-fall payoff: the crown lands on the chip in sync, with a '+1' stamp and team-coloured debris | M | 4.7 | 5 | 4 | 5 |  |
| C30 | Damage numbers: de-overlap across targets and give big hits a bigger stamp | M | 4.3 | 4 | 4 | 5 |  |
| C31 | The KING button shows your king, not a generic sword | S | 4.7 | 5 | 4 | 5 |  |
| C32 | Make your own troops readable from behind | M | 4.7 | 5 | 5 | 4 |  |
| C33 | 3D portraits for every spell card | M | 5 | 5 | 5 | 5 |  |
| C34 | Make each arena a recognisable place on a phone (Classic and Golden Age) | XL | 4.3 | 6 | 4 | 3 |  |
| C35 | Give the home screen and menus the Toy Tournament look | L | 5 | 5 | 5 | 5 |  |
| C36 | Fill the screen on laptops and Chromebooks | M | 3.7 | 3 | 4 | 4 |  |
| C37 | A 3D toy chest opening instead of the flat CSS box | L | 5.7 | 7 | 5 | 5 |  |
| C38 | Grown-ups corner: friend-only online by default, anonymous stranger names, emote mute, and an optional play-time reminder | L | 7.3 | 6 | 9 | 7 |  |
| C39 | Put 'Play a friend' on Home | S | 7 | 8 | 7 | 6 |  |
| C40 | No more 'Couldn't reach the game server': wake the relay early and show a friendly 'waking up' state with auto-retry | M | 7 | 7 | 7 | 7 |  |
| C41 | Installed game opens instantly and works offline: precache the build's bundles and stop waiting on a sleeping server | M | 7 | 8 | 6 | 7 |  |
| C42 | Save backup and 'move to another device' (save code or file, plus persistent storage) | M | 7.3 | 7 | 8 | 7 |  |
| C43 | Never a frozen battle or a blank boot: a crash shield, a local problem log, and a splash that waits | M | 7 | 5 | 7 | 9 |  |
| C44 | Auto graphics: step down on very slow devices, and remember each device's level | M | 6.7 | 6 | 6 | 8 |  |
| C45 | Faster first load: split the 945 KB main bundle and get the troop pack in before the first battle | L | 4.7 | 4 | 5 | 5 |  |
| C46 | Deploy safety: a CI browser smoke test, Render waits for CI, and restarts let live matches finish | M | 5.3 | 3 | 6 | 7 |  |
| C47 | Rejoin a friend match after the browser reloads the tab, with a longer grace when a kid steps away | L | 3.3 | 3 | 3 | 4 |  |
| C48 | Show each arena as a picture on Trophy Road, Home and unlocks | M | 5 | 6 | 5 | 4 |  |
| C49 | Your deck's troops hang out on the home diorama | M | 5.3 | 7 | 5 | 4 |  |
| C50 | Champion Studio preview should match the battle champion | S | 5.7 | 6 | 5 | 6 |  |

## Item details

### C01. Smooth the bot difficulty ladder (fix the rookie-to-easy cliff and the out-of-order Hard tier)

- Area: bot difficulty / auto difficulty. Effort: M. Sim: no. Sources: gameplay-content
- Kids notice: Once they get good, the next bot is a little harder instead of suddenly unbeatable, and 'Hard' really is hard.
- Problem: The bot tiers don't rise in order. A random-tapping 'kid proxy' pilot (DEFAULT_DECK mirror, level 1) beat practice 36/40 and rookie 26/40, then won 0/40 against easy, normal and hard. Bot against bot over 24 seeds: rookie lost 0-24 to easy, easy beat hard 17-7, normal beat hard 22-2 and easy beat normal 18-6. Hard (0.55 s think, pushAt 6) plays worse because it pushes with too little elixir. Auto moves up after +3 crowns over 3 matches and drops after 2 straight losses, so a kid who is improving bounces between a bot that falls asleep and one that crushes them.
- Proposal: Re-tune TIER_PROFILES so each tier is a step up. Easy and normal get the knobs rookie already has (easy about 4 s think, mistakeRate 0.3, reactionDelay 1.2, spellIQ 2; normal about 2.5 s, 0.15, 0.8). Hard goes back to pushAt 8-9 with no mistakes plus one smart behaviour, such as holding a counter or punishing a lone tank in the other lane. A 'trainee' tier in between is optional. Make the scratch ladder harness a permanent curve test: each tier beats the one below in at least 60% of games, and the random pilot's win rate falls in steps (about 0.9 / 0.65 / 0.35 / 0.15 / under 0.05). Auto steps up only after two decisive windows in a row, with a friendly 'The bot is getting smarter!' banner.
- Evidence: src/match/difficulty.ts:30-50, verified at 749b073: rookie {6.5 s, mistake 0.45}, then easy {thinkInterval 1.8, pushAt 9}, normal {1.0, 8}, hard {0.55, 6} with no mistake or reaction knobs. autoTier at difficulty.ts:138-160 (ROOKIE_MATCHES 5, STEP_DOWN_LOSSES 2). Measurements from /tmp/claude-0/plan/gameplay/tiers.ts and ladder.ts. notes/features/enhancement-plan.md:72 '[ ] Make Hard genuinely hard'. novice.test.ts covers only practice, rookie and hard.
- Risk: Bots are not kids, so the bands are only a proxy. novice.test bands must be re-set. Profile changes in src/match don't touch the sim or the protocol, but smarter Hard logic in src/game/bot.ts needs bot.test re-captured. Check that replay tapes record bot deploys as inputs rather than re-running the bot, or old 'Last battle' tapes will play back wrong.

### C02. Tutorial: respond when the kid plays the wrong card, and stop naming a card they're holding

- Area: onboarding / tutorial. Effort: S. Sim: no. Sources: playtest
- Kids notice: If they pick the wrong card, the right one wiggles and the coach tells them which one to use, so they never get stuck.
- Problem: In the Fireball lesson the coach says 'Archers in a bunch! Throw a Fireball on them...' while the kid holds an Archers card. Dragging any card other than the target is silently ignored: nothing deploys, nothing wiggles, the coach says nothing and the clock stays frozen. The playtester dragged Archers onto the glowing tile 23 times with elixir stuck at 6.0. A 6-year-old who reads 'Archers' and drags the Archers card is stuck on a dead screen.
- Proposal: When a non-target card is pressed or dragged during a lesson, wiggle the glowing target card, replay the glove's path, and briefly swap the coach line to 'Not that one. Use the glowing Fireball card!' (with Arabic). Reword the step so it doesn't open with the name of another card in hand (e.g. 'Their bowmen are bunched up! Throw your Fireball on them.') and show the target card's name on a tinted chip.
- Evidence: src/game/tutorial.ts:149 (step text); src/ui/tutorialOverlay.ts:766 ('anything else is ignored'); /tmp/claude-0/plan/playtest/14-tut-wrongcard.png; run log: 23 Archers drags, hand [archers, mini-pekka, fireball, giant], elixir 6.0, clock 2:38 throughout.
- Risk: Low. Overlay only. Add a case to tutorialOverlay.test.ts.

### C03. A clean first Home after the tutorial: open Sandbox and Challenges, and hold back the locked 'New cards' sheet

- Area: first hour / progression gating. Effort: M. Sim: no. Sources: playtest, ux-kids
- Kids notice: After the tutorial they land on a tidy Home with their chest and the Battle button, and can go straight into the toy-box Sandbox or a puzzle instead of a screen full of locks.
- Problem: After the tutorial a new player sees mostly locks and things they can't have. shouldShowNewCards needs only the tutorial flag, so on an early Home visit a sheet of about 60 words says 'Three new cards have arrived' and shows three 'Unlocks in Bone Pit (200 trophies)' padlocks. At 30 trophies, Battle setup locks 5 of 6 modes, including Sandbox at 100, plus tower troop (200) and King's ability (400). Events locks Challenges at 100 and Draft at 1000. Meanwhile Play a friend offers Normal, Triple, Mega and Crazy with no lock. Sandbox and puzzle Challenges are exactly the low-pressure modes young kids enjoy, and they don't touch the ladder.
- Proposal: (1) Show the new-cards sheet only to saves that predate the card wave, or after 5 ladder matches; otherwise mark it seen silently and let the cards arrive as normal unlocks with their 'Try it' trials. (2) Unlock Sandbox and Challenges as soon as the tutorial ends. (3) Replace the padlocked rows with one 'More modes on the road' strip showing the next unlock and its trophy goal. Optionally allow one 'try it once' bot match of a locked mode. Make bot-mode locks consistent with what Play a friend already allows. Keep ladder-affecting unlocks (tower troop, abilities, Draft) on the road.
- Evidence: src/ui/newCards.ts:75-77 'return tutored && !guiding && !newCardsSeen(store)' (verified); /tmp/claude-0/plan/ux-scout/en390-home.png; src/ui/screens/battleSetup.ts:137 SETUP_FEATURES (verified); /tmp/claude-0/plan/playtest/34-battle-setup.png (locks), 81-friend.png (friend lobby with modes unlocked); Events text 'Challenges · Goblin Stadium · 100'.
- Risk: Fewer early unlock goals on the Trophy Road. Unlock tests (battleSetup.test, enforceUnlocks) and newCards tests change.

### C04. The monthly season reset must never take an arena away

- Area: progression / trophies / seasons. Effort: S. Sim: no. Sources: gameplay-content
- Kids notice: On the 1st of the month they no longer wake up to find their arena gone.
- Problem: On the first boot of each month, trophies above 1000 are halved toward 1000. A kid at 1600 (Royal Arena) drops to 1300 (Builder's Workshop), and one at 2400 drops to 1700, losing the arena's look and the cards it adds to chests. This breaks the first-hour promise that kids never drop out of an arena they reached. Trophy floors keep that promise for every other kind of loss.
- Proposal: Clamp the reset at the current arena's floor: new = max(arenaFloor(t), 1000 + (t-1000)/2). Or drop the trophy cut and make a season just a fresh Crown Pass plus a 'season best' badge. Rewrite the reset banner as a celebration ('Season 4 starts! You kept Royal Arena'). Add a test that checkSeason never lowers arenaIndexAt().
- Evidence: src/meta/achievements.ts:155 SEASON_FLOOR = 1000 and :222-224 softReset = SEASON_FLOOR + floor((trophies - SEASON_FLOOR)/2) (verified); src/meta/arenas.ts thresholds 1300/1600/2000/2400/3000; notes/features/first-hour.md:9; src/meta/economy.ts trophyLossAt floors.
- Risk: Low. Without a cut, top kids reach the 3000 cap sooner and need goals beyond it (C06, C08).

### C05. Attack puzzles: challenges about taking towers, not only surviving

- Area: game modes / challenges. Effort: M. Sim: no. Sources: gameplay-content
- Kids notice: Puzzles where they break in and knock towers down, which most kids find more fun than only defending.
- Problem: All 15 challenges (12 puzzles and 3 trials) share one goal: 'Keep all 3 towers standing for 0:NN'. Waves can only contain troops (spawnUnits throws for buildings and spells), so no puzzle teaches attacking, getting past a building or finishing with a spell. 'Destroy-the-King challenges' were deferred.
- Proposal: Add goal types to Challenge and a branch in challengeStatus: 'Take a tower in 0:45', 'Win with 3 crowns', 'Knock the King down from 600 HP', 'Win using exactly 15 elixir' (fixed starting elixir with player regen off, or a cap the UI enforces). Allow enemy buildings and troops placed before the battle starts (extend applyWaves to place buildings the way a deploy does). Ship 8-10 attack puzzles from 1 to 3 stars ('Get past the cannon', 'Arrows finish', 'Split push'), each with a goal chip.
- Evidence: src/game/challenges.ts:14-40 (Challenge with surviveFor and troop-only waves; 18 surviveFor uses, verified); first-hour.md:124-160 challenge table, all survive goals; enhancement-plan.md:194 '[ ] Destroy-the-King challenges'.
- Risk: Placing buildings and setting starting elixir must stay pre-battle setup so golden.test is untouched. A player-only elixir rate inside the tick would be a sim rule (touches_sim). Solvability tests need extending for each goal type.

### C06. Adventure Trail: a PvE map with star nodes and an original Gatekeeper boss at each arena

- Area: game modes / week-one goals. Effort: L. Sim: no. Sources: gameplay-content
- Kids notice: A map of levels with stars to collect and a named boss guarding each arena, so they always know what to try next.
- Problem: Apart from the ladder there is no long goal a kid can see. The only 'boss' is a hidden win-streak Champion bot. Home's event tiles are Challenges, Daily battle, Draft and Last battle. A 6-12 year old has no map to fill in and no named opponent to beat at each arena gate.
- Proposal: A scrolling trail of about 30 nodes across the 11 arena looks. Each node is a bot battle with one twist, built only from existing knobs: a themed bot deck, tier and level, elixirRate, tower troop, King ability, a stronger or weaker enemy King (like Challenge.enemyKingHp), or scripted waves. Nodes give 1-3 stars (win / keep a tower / 3 crowns). Each arena ends in an original Gatekeeper boss with a name, a portrait from an existing rig in its own colours, a big King and a signature deck. Beating it pays a rare chest and a crest. Nodes unlock by trophies or by stars on the previous node. Data lives in a new src/meta/adventure.ts with tests and reuses the challenge runner and battle-setup flow.
- Evidence: grep for boss/campaign/adventure finds only the champion gauntlet at src/match/rewards.ts:231-236; Home event tiles at src/ui/screens/home.ts:624-672; createBattle knobs at src/game/battle.ts:410-417; Challenge.enemyKingHp in src/game/challenges.ts; arena looks in src/render3d/arenaLooks.ts (lookForArena :543).
- Risk: Star thresholds need a bot-proxy solvability harness like the challenge test. Stay within existing createBattle parameters so the sim and golden tests are untouched. Boss names and art must be original.

### C07. Daily reasons to come back: varied quests, a no-guilt weekly sticker card, and a rotating party-mode event on Home

- Area: meta / retention. Effort: L. Sim: no. Sources: gameplay-content
- Kids notice: Each day brings three different little missions and a silly new mode with a prize ladder, and a sticker card fills up over the week toward a big chest.
- Problem: Daily quests come from a pool of 6 with three measures (wins, cards played, damage). They pay only gold (30-80) and repeat within days. src/meta has no weekly or streak system. Triple Elixir, Mega Elixir, Mirror and Crazy sit inside Battle setup with no goal or reward, so most kids never find the most chaotic, fun modes, and the only thing that changes day to day is the Daily battle's deck.
- Proposal: (1) Grow QUEST_POOL to about 25 quests using new measures from match facts and events: play N spells, flyers or buildings; win with a given card; win a Draft; clear any challenge; play the Daily battle; use the King ability; win without losing a tower; 3-crown once; win a friend match. Allow one free reroll a day. Some rewards become shards, chests or an emote instead of gold. (2) A weekly sticker card: one stamp for each day with any battle. Any 5 of 7 opens a rare chest, and missed days never punish. (3) A date-seeded 'Party event' tile on Home (same hashing as daily.ts) that rotates Mega, Triple, Mirror, Crazy and Draft, with a 3-win mini track (gold, shards, chest), a countdown chip and no cost for losing. The event lets a kid play the mode even before its trophy unlock.
- Evidence: src/meta/quests.ts:6 QuestMeasure = 'wins'|'plays'|'damage' and :20-25 six gold-only quests (verified); recordMatch at src/match/rewards.ts:203-210 passes only won/cardsPlayed/damage; no streak or weekly code in src/meta; src/match/modes.ts:17-22; rewards.ts:224-244 (only the ladder pays trophies and chests); enhancement-plan.md:195 'weekly events' deferred.
- Risk: New measures need more match facts passed into recordMatch. Old saves must still load (loadQuests checks active.length === 3). Watch reward inflation against the chest and pass economy. Merged from two candidates (an M and an S), so effort is L.
- Depends on: C03 (locked-mode policy decides how the event bypasses mode unlocks)

### C08. Card mastery badges in the collection

- Area: collection / long-term goals. Effort: L. Sim: no. Sources: gameplay-content
- Kids notice: Each card has its own medals to earn, and filling in the card book feels like collecting stickers.
- Problem: The collection shows ownership and levels, and Profile shows 'Cards found 22/42', but nothing rewards learning a card. Once a kid owns most cards, the only goals left are trophies and gold. Card mastery is deferred.
- Proposal: Give each card three badges (bronze, silver, gold): play it 10 times; win 5 battles with it in the deck; one signature feat tied to the card (Fireball or Arrows hits 3+ troops, a building pulls a tank, a Digger lands on a tower). Show badges on collection tiles and in card info, with small gold or shard rewards and a 'Mastered!' frame. Count feats from the sim's existing event stream on the shell side. Start with the 8 starter cards.
- Evidence: enhancement-plan.md:195 '[ ] Card mastery, weekly events, Legend Path'; src/ui/screens/profile.ts:110 'Cards found'; src/meta/collection.ts (96 lines, ownership and levels only); SideState.stats.damageByCard at src/game/battle.ts:424. Locked cards already show as silhouettes (src/ui/screens/collection.ts:66 cardSilhouette), so that part of the scout's proposal is done.
- Risk: Feat detection must use events only, with no sim change. Too many badges can feel like chores.

### C09. Sandbox lab: drop enemy troops and test what beats what

- Area: game modes / sandbox. Effort: M. Sim: no. Sources: gameplay-content
- Kids notice: They can drop a big enemy troop and try different cards to see which one stops it.
- Problem: Sandbox gives infinite elixir against a sleeping bot. A kid can hit still towers but can't put an enemy Giant or Balloon on the other side to see which card stops it, which is the most useful thing a practice mode can teach. 'Sandbox enemy placement' is deferred.
- Proposal: Add a 'Your side / Red side' chip in sandbox. With Red on, a card dropped on the enemy half spawns for the enemy (spawnUnits for troops, as challenge waves do; a deploy-for-side helper for buildings and spells). Add pause and half-speed buttons and a 'Replay this fight' button that resets to the same placement. Solo only, no rewards.
- Evidence: notes/features/sandbox-mode.md (dummy opponent, no enemy deploys); enhancement-plan.md:201 '[ ] Sandbox enemy placement'; spawnUnits used by src/game/challenges.ts applyWaves (:401).
- Risk: Sandbox is in SOLO_ONLY_MODE_IDS, so no protocol impact. Enemy spells and buildings need a helper outside the tick that stays off the golden path.

### C10. Buddy mode: a helper bot defends your side for the youngest players

- Area: game modes / accessibility for ~6-year-olds. Effort: M. Sim: no. Sources: gameplay-content
- Kids notice: A friendly helper stops enemy troops on their side while they focus on attacking.
- Problem: Even the practice tier asks a kid to manage elixir, two lanes and defence at once. A 6-year-old, or a younger sibling beside an older one, can't just attack while something else covers defence. The bot can already play the player side (createBot with side 'player' was used in the measurements), but nothing in the game uses that.
- Proposal: A 'Buddy' toggle in Battle setup (solo only, no or half trophies). A helper bot on the player side shares the hand and elixir with a defend-only rule: it plays only when an enemy troop is on the kid's half and the kid hasn't played for 2 s, and it never spends the last 3 elixir. Its casts show a small 'Buddy!' tag and the card it will use next is highlighted. A later version could only glow a hint card instead of playing it.
- Evidence: src/game/bot.ts:42-43 (BotProfile.side defaults to 'enemy'); /tmp/claude-0/plan/gameplay/ladder.ts uses createBot(seed, {...profile, side: 'player'}); src/ui/screens/battleSetup.ts offers tiers but no assist.
- Risk: The helper may 'steal' the card the kid wanted, so show its next card and keep it off by default. No sim change: the bot issues normal deploys.

### C11. Replay shelf: the last 10 battles plus starred favourites

- Area: replays. Effort: M. Sim: no. Sources: gameplay-content
- Kids notice: They can keep and rewatch their best wins and show them to a parent.
- Problem: Only one replay is kept ('Last battle' on Home), and only for ladder matches. A kid's great 3-crown win is overwritten by the next match, and a parent can't watch back what happened in a loss. 'Battle log of 10 replays' is deferred.
- Proposal: Keep the last 10 tapes (any solo mode plus friend matches) with opponent, result, crowns and arena. Let the kid star up to 3 that are never overwritten. Show them in a 'Replays' sheet with a 1x/2x toggle and an 'Older version' label when a tape's sim version doesn't match. Optionally add a share code for a starred replay.
- Evidence: src/ui/screens/home.ts:671-672 ('Last battle', 'Watch your last ladder match'); enhancement-plan.md:196 '[ ] Battle log of 10 replays'; replay tape v3 (notes/features/card-wave-3.md:3-4); main.ts frame stores a single REPLAY_KEY.
- Risk: localStorage size (tapes are input logs, so small; cap the total). After any sim bump (C13), old tapes must be labelled rather than played wrong.

### C12. 2v2 Duo battles (kid plus parent, friend or buddy bot against two bots)

- Area: game modes / social. Effort: XL. Sim: yes. Sources: gameplay-content
- Kids notice: They can team up with a parent or friend against two bots and win together.
- Problem: The genre's usual co-op mode is missing. A family can only play against each other (online 1v1), never on the same team, which for 6-8 year olds is often more fun and less upsetting.
- Proposal: A 2v2 mode: two hands and two elixir bars per side, each player deploying in their own half-lane strip, with shared towers. Start locally (kid plus buddy bot against two bots), then kid plus friend over the relay against two bots. Needs sim support for two hands per side, a protocol bump, new golden and bot tests, and a HUD for two hands.
- Evidence: Sim sides are fixed to player/enemy with one hand each (src/game/battle.ts:418-439); online is 1v1 lockstep (notes/features/online-1v1.md, src/net/lockstep.ts); no 2v2 anywhere in src.
- Risk: Large sim and protocol change (SIM_VERSION and PROTOCOL_VERSION bump, golden re-capture), bot coordination and online sync. Do it only after the cheaper goals ship; C10 is the first step.
- Depends on: C10

### C13. Win-condition balance pass: the starter Giant is the weakest card

- Area: card balance. Effort: L. Sim: yes. Sources: gameplay-content
- Kids notice: When their Giant reaches the tower it does real damage, so 'protect the big guy and push' works.
- Problem: In the 12,000-match random-deck lab, building-targeting win conditions sit at the bottom (Giant 39.3%, Princess 40.5%, Hog Rider 40.8%, Skeleton Barrel 41.2%, Royal Giant 42.3%) and defensive heavies at the top (P.E.K.K.A 61.1%, Witch 59.8%, Skeleton Army 59.8%, Baby Dragon 59.7%, Mini P.E.K.K.A 59.5%). The Giant is the only win condition in the starter deck and was deliberately not buffed, because a buff also made the rookie and practice bots harder. So the genre's core plan, protecting your tank and pushing, is the weakest way to play.
- Proposal: Decouple the two. Buff building-targeters slightly (e.g. Giant +200 HP, or a small extra building damage for tanks) and trim the top three defenders by 3-5%. Then restore the novice bands by retuning only rookie and practice in src/match/difficulty.ts, or by giving level-1 bots a deck without the Giant. Ship it as one sim v4 release with a golden re-capture, PROTOCOL_VERSION 4 and replay tape v4, measured with npm run lab against the 42-58% band.
- Evidence: notes/features/card-wave-3.md:197-253 per-card table (giant 39.3% at :253, royal-giant 42.3% at :247, verified); :258-280 (why the Giant stays at 3600 HP); enhancement-plan.md:208-209 deferred 'Balance edges'.
- Risk: Sim change: version bump, golden and bot test updates, and both online players must update together. Old replays become 'older version' (C11). The lab is bot-piloted, so real kids may differ. Novice bands can break.
- Depends on: C01 (novice-band retune uses the same harness)

### C14. Teach elixir readiness: a filling wipe instead of '+N', a soft 'ready' chime, and an 'elixir full' nudge

- Area: battle HUD clarity / elixir feedback. Effort: M. Sim: no. Sources: feel-audio, playtest
- Kids notice: Each card visibly fills up until it's ready, a little 'bling' says the big card can be played, and the game reminds them when their elixir is full.
- Problem: Cards a kid can't afford show a pink '+2' or '+3' pill. To a 6-8 year old that reads as a bonus, not 'wait for 2 more elixir'. On desktop all four cards showed '+3'/'+4' at once. A card becoming affordable gets only a CSS 'ready-pop', and dealing a new card is silent. Kids watch the board, not the tray. Nothing in-battle says elixir is full and being wasted: in the tutorial finale elixir sat at 9.1-10 for about two minutes of game clock with no prompt. The only elixir sound is the leak drip, and a leak coach tip exists only after a loss.
- Proposal: (1) Replace the '+N' pill with a darkening wipe on each card that drains as elixir comes in, plus a droplet icon with the missing amount and no '+' sign. (2) A soft two-note 'ready' chime, at most once a second and only for the most expensive affordable or selected card, plus a paper swish when a card is dealt (edition scales, sfx bus). (3) When elixir has been at 10 for about 3 s in early battles or the tutorial, pulse the cheapest playable card and show 'Elixir full! Play a card!' (EN/AR), fading out after a few matches.
- Evidence: '+N' pills in /tmp/claude-0/plan/playtest/50-p-classic-b-mid.png and 70-d-golden-b-mid.png; notes/features/compact-hand.md:31; src/render3d/hud.ts:940-948 (dealCard, ready-pop, no sound), :958-963; src/audio/sound.ts elixirLeak only; src/match/coachTips.ts:90 leak tip; playtest tutorial log (elixir 9.1-10 from 2:01 to 0:00); no 'elixir full' nudge found in src.
- Risk: The chime can get naggy at 2x/3x elixir, so throttle hard and test in overtime. layoutCss and hudModel tests need updating. Two S candidates merged into M.

### C15. Card clarity for young readers: names on collection tiles and picture-first card info

- Area: collection / card info. Effort: M. Sim: no. Sources: ux-kids, playtest
- Kids notice: They can find 'the Baby Dragon' in their collection, see at a glance that the Giant has a huge heart bar and only hits towers, and tap the little faces to see what beats him.
- Problem: Cards-tab tiles show only a cost bubble and 'Lv 1'. The name is only in the aria-label, and several portraits are unreadable at that size (Baby Dragon is a green blob on green, Fireball an orange blob). Card info is an adult stats table ('Hitpoints', 'Damage per second', 'Hit speed', 'Range'). The battle tooltip is dotted text ('Medium speed · range 5 · splash', 'radius 2.5'). 'Good vs:' and 'Watch out:' are lists of plain card names. A 6-8 year old can't compare 'range 5' with 'radius 2.5' or picture which card a name means.
- Proposal: (1) A short name ribbon under each collection tile (edition display name, auto-shrink), more contrast behind green and orange subjects, and 'Unlocks at <arena>' on locked silhouettes instead of a bare 'Arena 3'. (2) Card info and tooltip with one icon per stat (heart HP, sword damage, boot with 1-3 pips for speed, bow arc for range, a target glyph for ground/air/buildings), each with a 5-segment strength bar against cards of the same kind and the exact number small underneath. (3) 'Good vs / Watch out' as tappable mini portraits (cardFrame minis). (4) Traits (flies, splash, jumps the river) as icon chips with a one-word label.
- Evidence: src/ui/screens/collection.ts:66-95 (name only in aria-label; unowned tiles already use cardSilhouette; verified); /tmp/claude-0/plan/playtest/35-cards.png; src/ui/screens/cardInfo.ts:80-108 statRows, :262-266 'Good vs'/'Watch out' names; src/render/cardinfo.ts:77-130 trait text lines; src/ui/icons.ts.
- Risk: Strength bars need stable normalisation per card kind. Show the icon legend once. Tile ribbons must fit at 280-320 px widths and at 130% text size (C17).

### C16. Read-aloud coach for kids who can't read yet (tutorial, coach tips, card info)

- Area: onboarding / accessibility. Effort: M. Sim: no. Sources: ux-kids
- Kids notice: The game says out loud what to do next, in English or Arabic, so they don't need a grown-up to read it.
- Problem: Every teaching moment is a sentence a 6-year-old must read. The tutorial has 7 steps of 12-20 words each, and coach tips, card blurbs, the New cards sheet and challenge goals are all text. The glove shows where to drop a card but not why. Nothing in the game speaks. Measured visible words at 390x844: Home 123, Events 122, Settings 156.
- Proposal: A speaker button on the coach bubble, coach tips, card-info blurbs and the new-cards sheet, using the Web Speech API with an en or ar voice chosen by edition or language. Hide it when the device has no voice for that language. A Settings switch 'Read aloud: Auto / Off', where Auto reads the first lesson's tutorial steps automatically. Duck the music under speech and stop on step change. Optionally ship recorded lines for the 7 tutorial steps in both languages as a guaranteed fallback.
- Evidence: src/game/tutorial.ts:106-187 (7 text steps plus idleText); no speechSynthesis anywhere in src (verified grep); src/match/coachTips.ts text-only; word counts from /tmp/claude-0/plan/ux-scout screenshots.
- Risk: Arabic TTS voices are missing on some Android and desktop browsers, hence the recorded fallback. Speech can't be checked in the SwiftShader container, so the owner needs to test on a real phone.

### C17. Text size setting reaches every label (no 7-10 px text)

- Area: accessibility / readability. Effort: S. Sim: no. Sources: ux-kids
- Kids notice: When a parent sets text to 'big', card names, the Next label and chest timers get bigger too.
- Problem: Text size (100/115/130%) scales the --fs-* tokens, but 100 font-size declarations in the UI CSS are fixed px and ignore it, against 224 that scale. Some are tiny: chest badge 7px, rewards 8.5px and 9px, deck-slot tile names 9px and costs 10px, and the battle HUD 'Next' label measured 10 px at 390x844. A kid who needs bigger text gets bigger headings while the small labels stay small.
- Proposal: Move fixed-px font sizes onto tokens, adding a --fs-2xs floor of calc(11px * var(--text-scale)). No real text under 11px; purely decorative chest badges can stay. Add a layoutCss test that fails on new raw px font sizes under src/ui/styles, with an allowlist. Check 390x844 and 360x740 at 130% in both editions.
- Evidence: grep finds 100 'font-size: Npx' declarations in src/ui (verified count); src/ui/styles/rewards.css:184 (7px), :1083 (8.5px), :1444 (9px); src/ui/styles/decks.css:174, :177, :265; src/ui/tokens.css:147-155; HUD text audit '10:Next'.
- Risk: Bigger labels can overflow the compact deck grid and card tray at 130%, so they need truncation or wrap rules checked by eye on small phones.

### C18. Chest reveal: keep 'Add to deck' off the tap-to-continue path, and let the kid choose which card leaves

- Area: rewards / deck safety. Effort: S. Sim: no. Sources: playtest
- Kids notice: Opening a chest never swaps out their favourite Giant by accident.
- Problem: The reveal says 'Tap to continue · hold to skip', and the new card's 'Add to deck' button sits mid-screen where those taps land. Six centre taps opened 'Skeletons takes the place of Giant (5 elixir), your most expensive card' with 'Swap in' as the yellow call to action. The Giant is the win condition the tutorial just taught. A kid who taps through every chest slowly loses every expensive card and ends up with a deck that can't push.
- Proposal: Hold the Add to deck buttons until the reveal sequence ends and show them on the final summary, not under the flip spot. Make 'Keep my deck' the emphasised default (the confirm({emphasis:'cancel'}) option the tutorial's skip dialog already uses). Swap by role (troop for troop, nearest cost), or better, open a mini deck strip where the kid taps which card goes out. Put a NEW badge on the Cards tab instead of asking at the peak moment.
- Evidence: src/ui/screens/chestReveal.ts:333 addToDeckButton on each new-card row; :366-390 swapOutIndex picks the most expensive card, okLabel 'Swap in' (verified); /tmp/claude-0/plan/playtest/30-chest.png and 31-chest-after.png (swap dialog after centre taps at 195,500).
- Risk: Low. UI only; chestReveal.test expectations change.

### C19. Show the game's own name, Crown Rush, instead of 'Clash Royale Clone' / 'CR Clone'

- Area: branding / originality. Effort: S. Sim: no. Sources: tech-online, ux-kids, playtest
- Kids notice: The icon on the tablet and the loading screen say 'Crown Rush', the name of their own game.
- Problem: The art bible and THIRD_PARTY_NOTICES call the game Crown Rush, but the browser tab, the boot splash, the installed home-screen label and the web-app manifest all say 'Clash Royale Clone' or 'CR Clone', naming a commercial game. The Render service and URL (clash-royale-clone.onrender.com) and the Pages path echo it too.
- Proposal: Change the visible strings to 'Crown Rush': <title>, apple-mobile-web-app-title, the boot-title div, manifest name and short_name, and an Arabic title set at runtime in the Golden Age edition. Update sw.js SHELL_MARK and src/app/sw.test.ts in the same commit. Leave internal ids (data-edition 'clash', cr-clone-* storage keys) alone so no saves are lost. Renaming the Render service, repo or Pages path is a separate owner decision, because it changes origins and splits localStorage saves.
- Evidence: index.html:12 'CR Clone', :17 <title>Clash Royale Clone</title>, :131 boot-title (verified); public/manifest.webmanifest:2-3 (verified); public/sw.js:30-31 SHELL_MARK; render.yaml name clash-royale-clone; notes/features/art-direction-2026-11.md:323 'Crown Rush'; THIRD_PARTY_NOTICES.md:3.
- Risk: SHELL_MARK must change with the title or the offline shell stops caching; sw.test covers it. Installed home-screen apps may keep the old label until reinstalled. URL renames are optional and would split saves.

### C20. Give the Classic edition original card, arena, tower-troop and feature names

- Area: originality / content naming. Effort: M. Sim: no. Sources: gameplay-content, feel-audio, visuals, ux-kids, playtest
- Kids notice: Cards and arenas get their own playful names that match the toy look, which makes it feel like its own game.
- Problem: The Classic edition copies another commercial game's names word for word. Cards: Mini P.E.K.K.A, P.E.K.K.A, Hog Rider, Mega Knight, Electro Wizard, Royal Giant, Skeleton Army, Skeleton Barrel, Elixir Collector, Magic Archer, Executioner, Baby Dragon, Musketeer and others. Arenas: Training Camp, Goblin Stadium, Bone Pit, Barbarian Bowl, P.E.K.K.A's Playhouse, Spell Valley, Builder's Workshop, Royal Arena, Frozen Peak, Jungle Arena, Legendary Peak. Tower troops 'Cannoneer' and 'Dagger Duchess', and the 'Trophy Road' label. Kids see these on Home ('Next: Goblin Stadium'), Battle setup, Events, unlock lines ('Unlocks in Bone Pit') and cards. Golden Age already has original names through the display layer in src/render/cardNames.ts.
- Proposal: Write an original Classic naming sheet that fits the Toy Tournament art bible and the renderer's look ids (meadow, swamp, bone, snow, forge, mystic, workshop, royal, ice, jungle, neon). Keep generic genre words (Knight, Archers, Giant, Fireball, Arrows). Route it through cardDisplayName plus a per-arena display name, and change only display strings: arena names, tower troops, abilities, blurbs, coach tips, challenge text and road/pass labels. Keep every CardId, arena id and storage key so saves, deck codes, bot scripts and the online protocol are untouched. Show a one-time 'Your cards got new names!' sheet mapping old names to new. Add a denylist test so copied names don't creep back.
- Evidence: src/game/cards.ts:331 'Mini P.E.K.K.A', :400 'Hog Rider', :550 'Electro Wizard', :608 'Mega Knight', :629 'Royal Giant', :680 'P.E.K.K.A', :733 'Elixir Collector', :780 'Skeleton Barrel'; src/meta/arenas.ts:30-101; src/game/towers.ts:43, :58; src/game/abilities.ts:34; src/ui/newCards.ts:96; notes/features/card-rarities.md; src/ui/i18n.ts comment 'Clash edition'; /tmp/claude-0/plan/playtest/34-battle-setup.png and 23-after-tut.png; /tmp/claude-0/plan/ux-scout/en390-events.png.
- Risk: Many tests and blurbs match on names (challenges.test, coachTips, cardBlurbs, docs.test, battleSetup.test:7). Kids who know the old names need the one-time sheet. The change must stay display-only so golden.test stays green. The owner picks the final names.
- Depends on: C19 (ship together if convenient)

### C21. Golden Age language fixes: the 'win' verb, Latin digits, English aria-labels, plus a lint test

- Area: i18n / Arabic. Effort: S. Sim: no. Sources: ux-kids, playtest
- Kids notice: In the Golden Age edition the achievements say 'win' correctly and every number uses the same digits.
- Problem: The Arabic is good overall, but some mistakes show on screen. Every win achievement and two daily quests use 'افز', which isn't a word (the imperative is 'فُز'): 'افز بأول معركة', 'افز في معركتين'. The Profile season reads 'موسم 2026-11' in Latin digits, and the season-reset banner prints Latin numbers. Card trait and tooltip lines put raw numbers into Arabic ('${u.maxHp} صحة', 'نصف قطر ${card.radius}'), a known open problem. The 3D tower HP plates show Western digits while the clock and costs use Arabic-Indic digits. A few aria-labels and the boot splash are English-only.
- Proposal: Change 'افز' to 'فُز' in achievements.ts and quests.ts. Format the season key, trait numbers and HP plates with fmtNum (or pick one digit style per language consistently). Wrap the remaining aria-labels in tr(). Add an i18n test that fails on an Arabic template with a raw numeric interpolation not wrapped in fmtNum, and on English-only aria-label literals. Ask a native reader to check the wording.
- Evidence: src/meta/achievements.ts:34-36 and src/meta/quests.ts:20-21 'افز' (verified); /tmp/claude-0/plan/ux-scout/ar390-profile.png; src/ui/screens/profile.ts:97; src/main.ts:306; src/render/cardinfo.ts:61-130; HP plates /tmp/claude-0/plan/playtest/60-p-golden-b-mid.png; English aria-labels at src/main.ts:1010 ('Emotes'), src/ui/screens/home.ts:236, index.html:122.
- Risk: Low. The scout's '<html lang> stays en' point is wrong and was dropped: src/render3d/theme.ts:35 already sets document.documentElement.lang = 'ar'. Do not set dir=rtl on <html>, because the battle HUD is meant to stay LTR.

### C22. Separate the language from the edition (play the Golden Age look in English, or Classic in Arabic)

- Area: i18n / editions. Effort: L. Sim: no. Sources: playtest
- Kids notice: They can play the Golden Age world in English or the Classic world in Arabic.
- Problem: tr() returns Arabic whenever the Golden Age edition is active, and Settings has no language row. A child who reads English but loves the Golden Age look gets a fully Arabic UI, including results and coach tips. An Arabic-reading sibling can't play Classic in Arabic.
- Proposal: Split the single ARABIC flag into a look flag and a text flag. Add Settings > Language (English / العربية), defaulting from the edition the first time. Base text direction on the language. Use the language's digits everywhere, HP plates included. Keep the bilingual edition picker.
- Evidence: src/ui/i18n.ts:7 'export const tr = (en, ar) => (ARABIC ? ar : en)'; src/render3d/theme.ts:82 ARABIC = ARENA_THEME === 'arabic'; 29 non-test modules read ARABIC; Settings sections Sound / Feel / Display / Edition / Help / Credits (/tmp/claude-0/plan/playtest/42-settings.png); /tmp/claude-0/plan/playtest/60-p-golden-d-result.png.
- Risk: Wide change across 29 modules and RTL CSS. Bilingual tests need a look x language matrix. Classic card names in Arabic need translations (C20).
- Depends on: C21

### C23. Fix mismatched sound cues: spells that play Arrows, and buildings that die like towers

- Area: audio / sfx coverage. Effort: M. Sim: no. Sources: feel-audio
- Kids notice: The healing spell sounds like healing, the big knight lands with a real BOOM, a cannon breaking goes 'crunch', and knocking down the king's castle sounds like the end of a movie.
- Problem: The spell case in SoundEngine.dispatch knows only fireball, zap, rage and freeze. Everything else falls to this.arrows(): Heal, Tornado, Skeleton Barrel and the Mega Knight's landing slam (which emits a 'spell' event, with 0.85 visual shake) all sound like a tiny arrow volley. Any non-troop death plays towerDown(), so a Cannon, Tombstone or Elixir Collector breaking plays the same 0.9 s collapse rumble as a princess tower, which waters down the real tower fall. Princess and king falls share one sound; only the crown cheer differs.
- Proposal: Add synth patches: Heal (warm rising arpeggio in the edition scale), Tornado (swirling band-pass wind panned to x), Skeleton Barrel (wooden thunk, bounce, bony rattle), Mega slam (heavy low thud and crunch, about 70% of towerDown). Switch on cardId with no arrows default. Split deaths into three cues by ev.kind: building (short wood-and-metal crunch), princess tower (today's collapse plus a bright crown chime), king tower (two-stage crack and rumble with a bell toll, or frame drum and brass gong in Golden Age, under a low-pass sweep that follows the 1.6 s slow motion). Add a sound.test case that every spell id maps to a named cue.
- Evidence: src/audio/sound.ts:1084-1090 spell switch with else this.arrows(), :1096-1099 death dispatch kind !== 'troop' => towerDown (verified); src/game/battle.ts:943, :1003 (Mega Knight 'spell' event); src/render3d/scene/fx/spells.ts:510, :541-549; src/render3d/scene/views/towers.ts:776-806; src/render3d/hud.ts:525-528 SLOW_MO.
- Risk: Low: audio-only and unit-testable. Keep the Mega slam under the limiter, and make sure the king cue doesn't double up with the jingle on the same frame (C25). Two S candidates merged into M.

### C24. Per-card sound identity: voices, attack sounds and death sounds from a data table

- Area: audio / sfx coverage. Effort: L. Sim: no. Sources: feel-audio
- Kids notice: You can hear who is fighting with your eyes closed: arrows twang, the musketeer pops, skeletons rattle when they fall.
- Problem: Only 9 troops have a deploy voice. The other ~28 just thump. Every ranged attack is the same square-wave bleep (bow, musket, fire staff, ice bolt and dragon breath alike), every melee hit is one click, every troop death is one blip apart from balloon and golems, and all three King abilities share one swoosh. In a busy fight one global throttle turns it all into a single clicking stream.
- Proposal: Add src/audio/cardSounds.ts, a table per CardId: {voice, attack family, death family}. Attack families: bow-twang, gun-pop, fire-magic, ice-magic, zap-magic, breath, blade-swing, heavy-smash, bite, cannon. Death families: poof, bone-rattle, metal-clang, roar-fade, pop. Optional per-edition overrides. dispatch reads ev.cardId (attack events already carry it). Throttle per family and cap voices (about 6 sfx per 100 ms). Give each King ability its own cue. A coverage test fails when a new card has no entry.
- Evidence: src/audio/sound.ts:691-728 (9 barks), :738-756 (one melee, ranged and towerShot sound), :803-806 (one troop death), :902-906 (one ability sound), :1091-1095 attack dispatch ignores cardId (verified); src/game/battle.ts:256-265 attack events carry cardId.
- Risk: Mix density: with ~10 units fighting, per-family throttles and a voice cap are needed so the limiter doesn't pump. Tune by ear in both editions.
- Depends on: C23

### C25. End-of-match sequence: an on-field celebration, then a result screen with sound and music

- Area: victory/defeat flow (visual + audio). Effort: L. Sim: no. Sources: visuals, feel-audio
- Kids notice: Their king jumps and cheers on the field, they see which troop was the star, and every crown goes 'ding! ding! DING!' with coins clinking and happy music instead of a silent screen.
- Problem: At the KO the win/lose jingle fires, wire.ts stops the music and holds it ducked, and 1.6 s later a DOM result card covers about 85% of a 390x844 screen and plays its whole timeline silently: ribbon, each crown filling, trophy and gold count-up, chest landing. The only sound is the legendary sting on the last crown of a 3-crown win, so the most common outcome, a 1- or 2-crown win, ends on a quiet screen. Nothing on the field celebrates: no king or troop reacts, and Defeat uses the same card. There is no results music (TrackId is 'menu' | 'battle').
- Proposal: (1) A 2-3 s skippable beat before the card (skipped under reduced motion). On a win the camera eases toward your king tower, your king and crew hop with arms raised (a procedural cheer pose on the cast rig), team-coloured confetti pops and the crowd jumps. On a loss your king shrugs kindly and the enemy king does a small dance, nothing mocking. (2) The result card slides up and leaves the top of the arena visible, with a 'Star of the match' tile showing the 3D portrait of the top-damage troop (ResultStats already has per-card stats). (3) Audio: a near-silence beat after the KO; the fanfare moved from the 'finish' event to the ribbon drop; one rising chime per crown with a heavier slam for the 3rd; soft coin ticks during countUp (throttled to about 12/s); a thunk and sparkle when the chest lands; and a short per-edition results loop (upbeat for a win, warm and encouraging for a loss) as a new 'results' TrackId that stops on Play again.
- Evidence: src/audio/sound.ts:1023-1043 jingle, :1101-1103 finish -> jingle; src/audio/wire.ts:123-131 (matchEnd stops music, duck); src/render3d/hud.ts:97 REVEAL_MS 1600; src/render3d/result.ts:251-296 timeline, :267 only sound, :363-379 fill/countUp; src/audio/music.ts:24 TrackId; scene3d.ts:200 crowd cheer timer; arena/crowd.ts:170; /tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad/fv2/shots/d/classic-training-camp-ko-390x844@2-3.png; art-direction-2026-11.md:376, :903 (victory flow kept as is).
- Risk: Online: each client plays its own sequence locally after the result, so the protocol is unaffected, but rematch and Play again timing must still work. Cast rigs need a simple cheer pose (no authored clips). Two M candidates (visual and audio) merged into L because they share the same timing.
- Depends on: C23 (king-fall cue)

### C26. Make overtime feel like overtime, and make haptics tell your tower falling apart from winning one

- Area: overtime drama / haptics. Effort: M. Sim: no. Sources: feel-audio
- Kids notice: Overtime starts with a drumroll and a glow, the last ten seconds have a heartbeat, and on a phone knocking down a tower feels like a happy 'brrr-brrr-BRRR!' while losing one is a single thud.
- Problem: 'Last minute! 2x elixir' and 'OVERTIME! 3x elixir' both call the same argument-less 3-note sting, with no haptics. The last 10 seconds get only a woodblock tick. Separately, wire.ts buzzes 'towerDown' for any princess or king tower death, the kid's own or the enemy's, so taking a tower and losing one feel identical on Android. There is no buzz for 'FIGHT!', a crown won, overtime or a big cast.
- Proposal: (1) A distinct overtime sting (drum roll into a low horn, per edition), a 1 s team-neutral glow pulse around the board edge, and a soft heartbeat under the tick in the last 10 s of overtime with a pulsing clock box. Make 'last minute' a lighter, brighter cue. (2) New BuzzKinds chosen by ev.side vs mySide: 'crownWon' (rising triple pulse), 'towerLost' (one heavy pulse), 'fight', 'overtime', 'bigCast' (own Fireball, Comet or Mega slam). Keep per-kind throttles, the haptics pref and reduced motion, and nothing during replays. Unit tests in feel.test.ts.
- Evidence: src/ui/banner.ts:283 and :294 both call audio.sting() (verified); src/audio/sound.ts:925-931 sting, clockTick; src/ui/feel.ts:12-38 BuzzKinds; src/audio/wire.ts:117 buzz('towerDown') for either side, :130 victory/defeat only (verified); src/ui/banner.ts:270-275 countdown has no buzz.
- Risk: Low. Keep the heartbeat gentle for younger kids. navigator.vibrate is absent on iOS, so the haptics half only reaches Android. Two S candidates merged into M.

### C27. A living soundtrack: longer battle music, a final-seconds layer, quiet tutorial waits, and a crowd you can hear

- Area: music / arena atmosphere. Effort: L. Sim: no. Sources: feel-audio
- Kids notice: The battle music changes and gets exciting at the end instead of repeating the same tune, and the audience 'oooohs' when a tower is almost broken.
- Problem: The battle track is one 16-bar loop (128 steps x 0.22 s, about 28 s), so a match plus overtime hears it 7-9 times. The battle music also keeps playing while the tutorial holds the clock at 0: 349 battle-track steps were scheduled while battle.time stayed 0. The stands animate and 'go wild' on a tower fall, but the crowd is heard only as a 1.5 s cheer or groan on crowns. There's no ambience under the music and no build-up for close calls (a tower at 10%, a big push over the bridge, the king waking).
- Proposal: (1) Original material in music.ts's degree format: a B-section and bridge so the battle track runs A-A-B-A (about 90 s), plus a 'final 10 seconds' ostinato layer at top intensity, keeping each edition's modes and instruments. (2) Dip to the pad layer only while a tutorial step pauses the clock. (3) A quiet looping crowd bed on the sfx bus (filtered noise with slow swells, plus frame drum and handclap texture in Golden Age, about -24 dB), with rate-limited reactions: an 'oooh' when any tower drops below 25%, a gasp on king-wake, rising chatter when 4+ troops are near a tower, and applause after a 3-unit spell hit. Drive these from the events and tower HP wire.ts already reads, and sync the cheer animation to the same signal.
- Evidence: src/audio/music.ts:24 (two TrackIds), :79-163 (16-bar battle def), :289 stepSeconds; tutorial capture /tmp/claude-0/plan/feel-audio/02-battle.png and run log (playStep 349 while battle.time 0); src/audio/sound.ts:865-895 crowd() only from crown/jingle; src/render3d/scene/views/towers.ts:782 b.cheer visual only; src/audio/wire.ts:107-113.
- Risk: Music taste is subjective, so give the owner an A/B. Music step-table tests need extending. The crowd bed can muddy the mix or tire parents' ears: keep it quiet, under the sfx slider, with at most one reaction per ~4 s. Two M candidates merged into L.
- Depends on: C25 (results track lives there)

### C28. Replace the four raw-emoji emotes and the bot's laughing taunt with an original, friendly emote set

- Area: emotes. Effort: M. Sim: no. Sources: feel-audio
- Kids notice: The opponent waves hello and says 'wow!' when you knock its tower down, instead of laughing at you when you lose one.
- Problem: The emote set is four raw OS emoji (laughing-crying, crying, thumbs-up, angry), drawn in whatever emoji font the device has, unlike the inked art everywhere else. Once a kid is past the polite window, the bot sends the laughing emoji whenever it takes one of their towers and a party emoji when it beats them. For 6-12 year olds, being laughed at by the computer right after losing a tower is pure frustration. Online, laughing and angry are half of the only options. '8 emotes online' and 'Bigger emotes' are deferred.
- Proposal: Draw eight original emotes in the art bible's inked style, all friendly: hello wave, thumbs up, 'wow!', 'oops', 'good game', heart, thinking, cheer. Each gets a tiny synth blip, with Golden Age tints where they fit. The bot only reacts kindly: 'wow' when you take its tower, 'good game' at the end, never laughing. Online uses the same set. The protocol already carries emote indexes 0..7, so map the new set onto them with a fallback for old clients. Remove the emoji strings from noEmoji.baseline.json.
- Evidence: src/main.ts:1006 EMOTES = ['😂','😭','👍','😡'] (verified); :1045-1050 botEmote; :1291 '🎉' on the kid's loss when !politeBot(); :1417-1418 '😂' when the bot takes the kid's tower (verified); src/net/session.ts:440 'Send an emote (0..7)'; src/match/online.ts:268; src/ui/noEmoji.baseline.json; enhancement-plan.md:198, :202 deferred.
- Risk: An old client receiving indexes 4-7 has no entry for them, so add a fallback (or a protocol minor check). The art must be original.
- Depends on: C38 (online emote mute lives in the grown-ups item)

### C29. Tower-fall payoff: the crown lands on the chip in sync, with a '+1' stamp and team-coloured debris

- Area: battle FX / crowns. Effort: M. Sim: no. Sources: feel-audio, visuals
- Kids notice: The crown flies up from the broken tower, lands on their score with a 'ding' and a sparkle, and the enemy's flags flutter down in the rubble.
- Problem: A DOM crown already flies from the fallen tower to the scoreboard (so art-ship gap 4's 'no flying crown' line is out of date). But the chip's pop fires on the HUD model change in the same frame the crown count changes, so the chip bumps about 0.9 s before the flying crown arrives, and the crown then just fades. It makes no sound on landing, there's no '+1' stamp, and the collapse debris is neutral grey-brown with no team colour. Under reduced motion flyCrown returns immediately, so those players get only the chip bump.
- Proposal: Delay popCrowns for the earning side until the flight's Animation.finished. Add a short 'crown in' chime and a gold glow on the chip when it lands, and a big '+1' crown stamp near it. Mix team-colour roof chunks and two or three cloth banners in the fallen side's colour into the collapse (teamColors.ts). Optionally a short 3D gold crown pop from the ruin hands off to the DOM flight. Reduced motion gets a static stamp plus the chime.
- Evidence: src/main.ts:1110-1136 flyCrown (900 ms; returns under reduceMotion; verified), fired at :1403; src/render3d/hud.ts:538-548 popCrowns and :890-898 pop on model change (verified); src/render3d/scene/views/towers.ts:776-806 collapseDust; notes/features/art-ship.md:160 gap 4; /tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad/fv2/shots/d/classic-pekka-playhouse-destroy-390x844@2-2.png.
- Risk: The online guest view is mirrored, so check the crown lands on the correct chip (flyCrown already uses localSide()). The gold crown must stay under the bloom threshold.
- Depends on: C23 (crown chime)

### C30. Damage numbers: de-overlap across targets and give big hits a bigger stamp

- Area: battle FX / damage popups. Effort: M. Sim: no. Sources: feel-audio, visuals
- Kids notice: The numbers stop piling on top of each other, and a huge fireball hit pops out a big bouncy number.
- Problem: Damage numbers merge and stack per target only, so in a Skeleton Army or tower brawl numbers from different targets overlap within about 40 px and become an unreadable gold smear on a phone (now 0.75 size under 500 px). A tower-ending blow or big spell hit uses the same style as a skeleton's poke.
- Proposal: A screen-space declutter pass in popups.ts: each frame, sort live numbers by spawn time and nudge later ones up or sideways out of a 40 px overlap, cap the nudge, and fade the oldest past N visible. Add a size and colour tier for big hits (over about 25% of a princess tower's HP, or spell damage): a larger cream-and-gold number with a squash-and-stretch. Tower-finishing blows get a short drawn, localized word burst.
- Evidence: notes/features/art-ship.md:159 gap 3, :74 phone-size numbers; notes/features/gfx-damage-popups.md:7; src/render3d/popups.ts (61 lines, per-target merge); commit ae001fa.
- Risk: Keep the pass O(n log n) on a capped n. Check readability in both editions with edition digits.

### C31. The KING button shows your king, not a generic sword

- Area: battle HUD. Effort: S. Sim: no. Sources: visuals
- Kids notice: The button shows their own king's face and lights up when he's ready to help.
- Problem: The King-ability button is a dark ring holding the same generic sword icon as the Battle button and the word KING. Nothing tells a young player what it does or that it belongs to their king tower, and it looks the same in both editions.
- Proposal: Put the edition's tower-king face (a cast portrait rendered like card portraits) in the charge ring with a team-colour rim. Add a gentle pulse and small crown badge when charged, and preview the ability's area on the field while held. Keep the Q key chip and the 'Charging… 20s' bubble.
- Evidence: src/render3d/hud.ts:296-316; src/ui/icons.ts:66; /tmp/claude-0/art/final/publish/classic-phone-battle.png and golden-phone-battle.png (bottom-right KING / الملك).
- Risk: Low. hud tests and the tutorial step that points at data-tut=ability.

### C32. Make your own troops readable from behind

- Area: battle readability (cast). Effort: M. Sim: no. Sources: visuals
- Kids notice: Even walking away, their archers look like archers and their knight looks like a knight.
- Problem: The camera sees the player's own troops from behind for most of a match. Archers read as pink hair over a sliver of team cape, and the Giant is a bald head over a blue tunic. Once troops cross the river, kids can't tell which of theirs is which. Cast-kit added back features for some of the starter deck, but this gap is still open.
- Proposal: One back feature per troop within the cloth-only team rule: a team-colour hooded capelet or tabard back carrying the card's simple emblem (bow, sword, hammer), a cloth-wrapped quiver for archers, a team sash knot for the Giant. Optionally a small idle and attack head-turn to three-quarter. Check on cast contact sheets from behind.
- Evidence: notes/features/art-ship.md:162 gap 6; /tmp/claude-0/art/final/publish/classic-phone-battle.png; /tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad/fv2/shots/a/classic-barbarian-bowl-390x844@2.png.
- Risk: Per-troop triangle budget and the cast-kit variant tables; Golden Age headgear rules (gap 8); the team rule (gap 6 notes a quiver strap would break it, so use cloth).

### C33. 3D portraits for every spell card

- Area: card portraits. Effort: M. Sim: no. Sources: visuals
- Kids notice: Spell cards look as shiny as the character cards, and Arrows clearly shows arrows.
- Problem: Troop and building cards show 3D cast portraits, but SPELL_PORTRAITS contains only 'comet', so Fireball, Arrows, Zap, Rage, Freeze, Heal, Tornado, Mirror and the Skeleton Barrel are 2D canvas doodles. Arrows is three thin strokes that read as grey scratches in the Next slot, and Fireball is an orange blur on an orange square next to glossy 3D faces.
- Proposal: Extend SPELL_PORTRAITS to every spell and build each subject from the creatures-fx models with the same portrait light, ink and backdrop: a fireball with its ribbon, three meshed fletched arrows, a blue zap bolt, a freeze crystal, a heal flask or leaf, a rage bottle, a tornado swirl, a mirror, and a barrel with a skull peeking out. Add Golden Age variants where effects differ. Update cardportraits tests and invalidate the cache.
- Evidence: src/render3d/cardportraits.ts:62 SPELL_PORTRAITS = new Set(['comet']) and :130 'spells keep painted art' (verified); src/render/characters.ts:926-951, :1159-1181; src/ui/cardFrame.ts:168-178; /tmp/claude-0/art/final/publish/classic-phone-battle.png; art-creatures-fx.md known gaps.
- Risk: Low. About 10 more small portrait renders, staggered and cached like troop portraits.

### C34. Make each arena a recognisable place on a phone (Classic and Golden Age)

- Area: arena variety. Effort: XL. Sim: no. Sources: visuals
- Kids notice: Reaching a new arena feels like arriving somewhere new, not the same field in a different colour.
- Problem: On a portrait phone the outer ring is culled, so the per-arena village, chalets, spires, basalt and city themes never show where kids play most. In Classic, Training Camp, Goblin Stadium and Jungle are all bright green, Barbarian Bowl and Frozen Peak are both white, three looks share the identical 'castle' far band, and there's no centre-court emblem. In Golden Age, 7 of 11 looks (Courtyard, Oasis, Dunes, Andalus, Artisans, Alhambra, Ghouta) render as the same cream court, zellige border and town. 'Per-arena prop kits' are deferred, and art-ship lists 'one town layout' and 'no per-look house kits'.
- Proposal: Give every look one or two render-only 'hero' elements inside the 390x844 frame: a per-arena centre-court emblem; a per-arena river treatment (swamp lilies and reeds, a workshop canal with cog wheels, a fountain basin, ice floes, an oasis pool); a far-band centrepiece instead of the shared gatehouse (windmill gate, stilt hut, ice palace, workshop crane; Alhambra fountain court, Dunes tents, Ghouta blossoming orchard, Artisans kilns); per-arena stand awning colours and crowd hats; and Golden Age court surfaces per look (Andalusian green-and-white tile, red-ochre plaster, rippled sand). Ship Classic and Golden Age as two rounds.
- Evidence: /tmp/claude-0/art/ship/looks-sheet-classic.png and looks-sheet-golden.png; src/render3d/arenaLooks.ts:163, :208, :268 (shared 'castle' far band), :362-463, :514-541; src/render3d/scene/arena/scenery.ts:399-455; notes/features/art-stage.md and art-ship.md:157-158 known gaps; enhancement-plan.md:203 '[ ] Per-arena prop kits'.
- Risk: Triangle budget: the empty battle at 1440x900 is already over the 260k target (gate 300k), so props must fit perf:budget. Floor luma tests, colour-blind palette checks for Golden floors near orange, and props must not hide troops or deploy zones. Two L candidates (one per edition) merged into XL.

### C35. Give the home screen and menus the Toy Tournament look

- Area: UI / menus. Effort: L. Sim: no. Sources: visuals
- Kids notice: The menus look like part of the same toy world as the battle instead of a plain app.
- Problem: The art round froze src/ui/**, and compact-hand.md says the home screen and menus are untouched. They are flat navy rounded rectangles with no ink or material, next to an inked, lit 3D battle. On the Classic phone Home, a row of four identical 'Empty' chest slots takes about 180 px, and the 'Daily quests' header is cut off by the bottom nav. Trophy Road, Shop and Cards are stacks of dark rows.
- Proposal: One style pass through tokens.css, components.css and home.css, keeping layouts and DOM. Panels and buttons get the 3D ink colour (#1F1A2E from look/material.ts) as a 2 px outline with a top highlight and bottom bevel, so they read as toy plastic. Classic: warm enamel blue with gold trim. Golden Age: zellige teal with brass. Chunky press-down buttons. Collapse empty chest slots into one slim 'Win a battle to fill' row of greyed silhouettes, keep the quest panel clear of the nav, and turn section headers into ribbon banners like the Victory ribbon.
- Evidence: /tmp/claude-0/art/final/publish/classic-phone-home.png and golden-phone-home.png; src/ui/screens/home.ts:303 ('Empty'); notes/features/compact-hand.md:207; notes/features/art-direction-2026-11.md:1186; older shots in /tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad/shots/.
- Risk: Broad CSS change across about 14k lines of UI styles. layoutCss tests, the noEmoji baseline and RTL need re-checking on phone and laptop. Contrast must stay legible for young readers.

### C36. Fill the screen on laptops and Chromebooks

- Area: UI layout (wide screens). Effort: M. Sim: no. Sources: visuals
- Kids notice: On the family laptop the game fills the screen instead of being a thin strip in the middle.
- Problem: At 1440x900 the menus are a 468 px phone column, and about two-thirds of the screen is flat navy. The battle at the same size fills the window, so going from battle back to Home feels like dropping into a letterboxed mobile app. 'Wide-screen Home layout' is deferred (the recent wide-screen framing work was battle-only).
- Proposal: Above about 900 px wide, let the live home diorama (or a per-edition painted backdrop, or a blurred static snapshot on weak GPUs) fill the window behind a floating menu column with a soft drop shadow. On Cards and the deck builder, use two columns (deck left, collection right). The phone layout stays unchanged.
- Evidence: /tmp/claude-0/art/final/publish/classic-desk-home.png and golden-desk-home.png vs golden-desk-battle.png; src/ui/style.css:32-41 (width: min(100vw, max(52vh, 420px))); enhancement-plan.md:199 '[ ] Wide-screen Home layout'.
- Risk: A full-width diorama costs GPU time on SwiftShader-class machines (lifecycle.ts already halves its frame rate), hence the snapshot fallback.
- Depends on: C35

### C37. A 3D toy chest opening instead of the flat CSS box

- Area: rewards / chest reveal. Effort: L. Sim: no. Sources: visuals, playtest
- Kids notice: The chest bounces, the lid flies open and their new troop pops out as a little 3D toy.
- Problem: Opening a chest is a kid's biggest delight moment, and the chest is built from divs with gradient wood stripes: a flat purple rectangle on 2D rays with small text and a lot of empty dark screen. Next to it, the home diorama, towers and cast are glossy 3D toys.
- Proposal: Render a 3D toy chest per kind (wood for free, purple with gold bands for rare, gold for legendary; brass and zellige skins in Golden Age) with the shared toon ramp and ink from look/material.ts, through the portrait renderer (cardportraits acquireRenderer) or a canvas in the reveal overlay. It wobbles when idle, squashes and glows on each tap, and on the last tap the lid flips with a sparkle burst. Each card pops out as its turning 3D mini and then flips to its card, with a rarity-coloured light burst and gold rays for a legendary. Keep the CSS chest on Low quality and under reduced motion.
- Evidence: src/ui/screens/chestReveal.ts:103-114 (div chest), :1-10, :168-175 choreography; src/ui/styles/rewards.css:194-265; /tmp/claude-0/plan/playtest/30-chest.png vs 23-after-tut.png; /tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad/shots/t-normal-390x844-chest-reveal-03.png.
- Risk: Another WebGL context on low-end Chromebooks, so reuse the portrait renderer and release it after. The chestReveal tests and tap/hold-to-skip timing must keep working. Sources disagreed (L vs M); L taken because of per-edition chest models plus 3D card pop-outs.
- Depends on: C18

### C38. Grown-ups corner: friend-only online by default, anonymous stranger names, emote mute, and an optional play-time reminder

- Area: parental / online safety. Effort: L. Sim: no. Sources: ux-kids
- Kids notice: Online shows 'Play a friend' with a code; strangers never see their name or spam faces at them; and after a while the king suggests a break at the end of a match instead of a grown-up taking the tablet mid-fight.
- Problem: The relay pairs anyone on the public server (QUICK_MATCH defaults on), and the lobby opens on the 'Quick match' tab unless the kid last used 'Play a friend'. In a quick match the stranger sees the kid's typed name and vice versa, and names are only cleaned of symbols. The battle menu has Resume, Sound, Leave and Forfeit but no way to mute an opponent's emotes (one every 2 s). Nothing tracks play time or offers a break reminder, and nothing in the game tells a parent any of this.
- Proposal: Add a 'Grown-ups' section in Settings behind a simple parent gate (type a number shown in words, or hold for 3 s). (1) A 'Play strangers (Quick match)' switch, OFF by default; when off, the lobby shows only Play a friend. (2) In quick matches, label both players with a generated friendly name (adjective + edition-themed noun + number from fixed EN/AR word lists) and their crest; typed names stay for code games. This is client-side only. (3) A 'Mute emotes' toggle in the battle menu, on by default for strangers. (4) One lobby line: 'Only play codes with people you know.' (5) 'Break reminder: Off / 20 / 30 / 45 min', counting active play time per day locally and showing a friendly 'Great battling! Time to rest your eyes' card at the next match end, never mid-battle, plus a 'Today: 34 min, 6 battles' line.
- Evidence: server/relay.ts:55 'const QUICK_MATCH = env.QUICK_MATCH !== "off"' (verified); src/ui/screens/lobby.ts:47-53 readTab() returns 'quick' unless stored 'friend' (verified); src/match/online.ts:172 s.opponent?.name; src/net/protocol.ts Loadout.name; src/net/session.ts:57 EMOTE_GAP_MS = 2000; src/ui/battleMenu.ts mute is sound-only (verified); docs/deploy-multiplayer.md:451; no playtime/break/parent code in src; src/ui/screens/settings.ts groups.
- Risk: Hiding Quick match lowers online liquidity, which is fine for a family game. A parent gate is a speed bump, not security. Anonymised names can be local labels so both screens don't need to agree. The reminder must never interrupt an online match. An M and an S candidate merged into L because they share the gate and section.

### C39. Put 'Play a friend' on Home

- Area: online / navigation. Effort: S. Sim: no. Sources: playtest
- Kids notice: One big button on Home starts a game with their brother or sister.
- Problem: The family use case, siblings playing each other, is buried: Home > the small 'Auto · Classic' chip > scroll to the bottom of Battle setup > 'Play online' > 'Play a friend' tab > 'Create a game', 4 taps plus a scroll. Neither Home nor Events has an entry point, and the playtester's scripted visit couldn't find it from Events.
- Proposal: Add a secondary 'Play a friend' button under the big Battle button that opens the lobby on the friend tab. After 'Create a game', show the room code very large with a share-link button and a QR code. Offer 'Play your friend next' on the Victory screen after a friend match.
- Evidence: src/ui/screens/home.ts has no 'friend' entry (grep, verified); /tmp/claude-0/plan/playtest/23-after-tut.png (Home buttons), 34-battle-setup.png, 80-online.png, 81-friend.png; ?join=CODE invite links already exist (src/main.ts handleJoinLink).
- Risk: Low. UI wiring only; the relay and protocol are untouched.
- Depends on: C40 (a sleeping relay makes the first tap fail), C38

### C40. No more 'Couldn't reach the game server': wake the relay early and show a friendly 'waking up' state with auto-retry

- Area: online / Render free-tier sleep. Effort: M. Sim: no. Sources: tech-online
- Kids notice: Instead of an error and an OK button, they see a friendly 'waking up' animation and the game connects by itself a minute later, or instantly during normal play time.
- Problem: The socket connect gives up after 8 s, but a sleeping Render relay needs about 50-60 s, so the first 'Play a friend' after idle fails with 'Couldn't reach the game server.' The join flow has only an OK button, no Try again. The Pages copy hits this every time Render is asleep, and nothing wakes the relay before the kid reaches the lobby. The free service sleeps after 15 idle minutes, so the first visit of every afternoon pays the cold start.
- Proposal: (a) At boot and when the Battle menu opens, fire a fire-and-forget fetch to the relay's /healthz (deriving the https origin from the wss URL on Pages). (b) In the lobby, treat 'unreachable' in the first ~75 s as 'waking': show 'Waking up the game server… this can take a minute' with a shimmer, retry with backoff, keep the typed code, and add Try again to the join flow. Offer 'Play the bot while you wait' and come back to the friend lobby once the relay answers. (c) Optional and opt-in through a repository variable: a scheduled GitHub Actions ping to /healthz every 10-14 minutes during family play hours only, documented in deploy-multiplayer.md.
- Evidence: src/net/roomClient.ts:50 CONNECT_TIMEOUT_MS = 8000; src/ui/screens/lobby.ts:102-103 error text, :527-529 Try again only when flow !== 'join'; docs/deploy-multiplayer.md:77-78, :471-475; render.yaml:21-23 (free, sleeps after 15 idle minutes), healthCheckPath /healthz; no healthz or wake call anywhere in src.
- Risk: Retry loops must stop on Cancel and lobby close (the disposeOpen pattern). GitHub cron can run 5-20 min late and is disabled after 60 days without repo activity, and it uses free instance hours, so check Render's terms on keep-alive pings. Two S candidates merged into M.
- Depends on: C41

### C41. Installed game opens instantly and works offline: precache the build's bundles and stop waiting on a sleeping server

- Area: PWA / service worker. Effort: M. Sim: no. Sources: ux-kids, tech-online
- Kids notice: Tapping the game icon opens the game straight away, even on a plane or while the server sleeps, instead of a grey 'waking up' page or a blank screen.
- Problem: sw.js says an installed game 'launches and plays solo with no connection', but install precaches only './' and the 7 cast GLBs. The worker registers on window 'load', after index-*.js, three-*.js, the CSS and fonts were fetched without it, so they're cached only on a second online launch. After every deploy the old worker caches the new hashed assets under the old cache name, and the new worker's activate deletes every older cache, so the bundles go uncached again. A kid opening the icon in the car gets the cached shell, a 10 s splash, then a blank page. Separately, navigations are network-first with no timeout, so when Render is asleep an installed, fully cached game waits behind Render's ~1-minute wake-up page.
- Proposal: (1) Extend the vite.config.ts stamp plugin (which already writes __BUILD_ID__ into dist/sw.js) to inject the list of emitted dist/assets/* files (13 files, about 2 MB) as a PRECACHE array, installed best effort per file like the cast. Add an sw.test assertion that every emitted asset is listed. (2) Race fetch(req) for navigations against a 2.5-3 s timer. If the timer wins, or the response isn't the game shell (no SHELL_MARK, not ok, not text/html), serve the cached './' and refresh in the background. (3) When the lobby gets update-required, update or unregister the worker before location.reload() so the reload can't land on a stale shell. (4) Optionally show a 'Ready to play offline' toast once install finishes.
- Evidence: public/sw.js:49-63 install caches ['./'] plus CAST only, :65-72 activate deletes all other caches (verified), :80-106 network-first navigations and fetch-time asset caching; src/main.ts:16-22 register on 'load'; dist/assets list (index-CgoAUPGQ.js, three-CKLeDCq5.js, index-N9DsaCSx.css, fonts, none precached); src/app/sw.test.ts has no asset-precache or slow-network case.
- Risk: About 2 MB more on first install over mobile data. Serving the cached shell can be one launch stale after a deploy, which can trigger update-required online, so the reload path must bypass it. First-ever visits still wait. Two S candidates merged into M.

### C42. Save backup and 'move to another device' (save code or file, plus persistent storage)

- Area: save data. Effort: M. Sim: no. Sources: ux-kids, tech-online
- Kids notice: Their trophies and cards are still there after a holiday, on the new tablet, or after a grown-up clears the browser.
- Problem: All progress is about 46-54 separate cr-clone-* localStorage keys (trophies, gold, gems, owned cards, levels, decks, pass, road, quests, achievements, champion, tutorial) in one browser on one origin. Nothing calls navigator.storage.persist() and there's no export or import. Clearing site data, Safari's 7-day storage eviction for sites not on the home screen, iOS Safari vs installed-PWA storage, a new tablet, or opening the other live URL (Render and GitHub Pages are different origins) all show a kid an empty profile. 'Save export / import' was deferred.
- Proposal: A 'Backup & move' row in Settings or Profile. (1) 'Save code': gather every registered cr-clone-* key except per-device ones (quality, relay URL, replay, lobby tab), version it, deflate it (CompressionStream deflate-raw), base64url it, add a check character and optionally a QR. (2) 'Save to file' / 'Load from file' / 'Enter save code', always with a confirm screen listing trophies, cards and gold and an automatic pre-import backup. (3) Call navigator.storage.persist() after the first win. (4) On iOS Safari outside standalone mode, a one-time 'Add Crown Rush to your Home Screen so your progress stays safe' tip. Keep the key list in one module; a test fails on an unregistered cr-clone- key literal. Mention the code in the deploy guide as the way to move between the two links.
- Evidence: No navigator.storage, export or import anywhere in src (verified grep); src/meta/kv.ts:24-36 plain localStorage, failures swallowed; src/meta/progress.ts:56 cr-clone-meta-v1; enhancement-plan.md:197 '[ ] Save export / import'; render.yaml ALLOWED_ORIGINS https://tamoura.github.io (second origin).
- Risk: Imports from older or newer versions must be sanitised key by key (reuse sanitizePrefs-style coercion and progress migrations). A full code may be too long to type, so offer the file path too. Copying a friend's progress is harmless here.

### C43. Never a frozen battle or a blank boot: a crash shield, a local problem log, and a splash that waits

- Area: error handling / first impression. Effort: M. Sim: no. Sources: tech-online
- Kids notice: If something goes wrong they get a friendly 'Oops, keep playing?' button instead of a frozen battle, and on the old tablet the loading crest keeps bouncing until the game appears instead of going blank.
- Problem: frame() reschedules requestAnimationFrame only as its last statement, and its ~120-line body (sim ticks, bot, waves, event fan-out, scene.render) has no try around it, so any exception freezes the battle for good with no message. There's no window 'error' or 'unhandledrejection' handler anywhere in src. On boot, the splash has a blind 'bootOut 0.3s 10s' fade, so on a slow device it vanishes at 10.3 s and the kid stares at an empty navy page. Boot measured at 21.1 s with 4x CPU throttle and Fast 3G (7.9 s unthrottled, SwiftShader). The no-WebGL message is English-only and technical (chrome://settings), even in the Golden Age edition.
- Proposal: (1) Wrap the frame body in try/finally so the next frame is always scheduled. Log one error and carry on; after N in a short span, pause and show a bilingual 'Oops! Something went wrong.' overlay with Keep playing / Back to menu. In online matches, end the match as no contest rather than stepping on (silent desync). (2) Global error and unhandledrejection listeners keep the last ~20 errors (message, stack head, build id, screen, quality level) locally, with Settings > 'Problem report' and a copy button. (3) Keep the splash until 'booted', add 'Still loading… nearly there!' at ~12 s, and switch to 'Tap to try again' (reload) on a boot-time error or after ~45 s. (4) Rewrite the no-WebGL screen for kids and parents in both languages.
- Evidence: src/main.ts:1309 function frame, reschedules at :1324 (early return) and :1432 (end); the only try in the body wraps the replay localStorage write (verified); no error/unhandledrejection listeners in src (verified grep); index.html:53 'animation: bootOut 0.3s 10s forwards' (verified), :134-136; /tmp/claude-0/plan/tech-online/measure.out (bootedMs 7932 vs 21125); src/main.ts:452-458 English WebGL message.
- Risk: Swallowing errors can hide bugs, so keep throwing under import.meta.env.DEV and in vitest. A boot that hangs without throwing needs the late fallback. Two S candidates merged into M.

### C44. Auto graphics: step down on very slow devices, and remember each device's level

- Area: performance / quality governor. Effort: M. Sim: no. Sources: playtest, tech-online
- Kids notice: On an old tablet or school Chromebook the game smooths itself out from the first second instead of staying a slideshow or hiccuping while they place their first troops.
- Problem: QualityGovernor.sample() discards every frame slower than 0.25 s as a hitch. On a device under 4 fps it never gets a sample and stays on High forever: a fresh profile stayed at level 0 at 2.41 / 2.34 / 2.32 fps through a 45 s battle, while ?quality=low gave 5.67 fps (2.4x), and the tutorial ran at about 1.5 fps. Even on devices it does handle, the governor starts every session at L0 (DPR 2, full bloom, 2048 shadows) and doesn't sample on Home, so each session's first battle has a 3 s warmup, stepped windows and an L4 shader recompile mid-fight. The ladder itself works (L0 511k triangles / 158 calls vs L4 174k / 115).
- Proposal: (1) Treat a sustained run of slow frames as steady state: if most frames in a visible 2 s window exceed 0.25 s, count it as slow and jump to the bottom level. Keep the single-hitch filter for isolated spikes and document.hidden. (2) Persist the settled or locked level in localStorage, keyed by the WebGL renderer string (where available), screen size and build. Start the next session there and re-probe one level up once per session. (3) A first-guess table for first launches (SwiftShader / llvmpipe / software → L4; known low-end GPU families → L3). (4) Compile L4 material variants during the VS/countdown when the start level is L3 or below. (5) Show 'Auto (now: Medium)' in Settings, and optionally a one-time 'Graphics set to Low so the game runs smoother' toast.
- Evidence: src/render3d/quality.ts:264 'if (!(frameSeconds > 0) || frameSeconds > 0.25) return false;' (verified); quality.ts:145-152 WARMUP/WINDOW/SETTLE, :243-253 applyPin resets to 0, :27-37 L4 recompile; src/render3d/scene/post.ts:495-498 diorama not sampled; src/render3d/scene3d.ts:213; /tmp/claude-0/plan/playtest/driver.cjs and battles.partial.json; /tmp/claude-0/plan/tech-online/measure.out.
- Risk: Long stalls (thermal throttling, GC) could step down unnecessarily, so require a visible, sustained window. A stored level can be stale after an OS update, which the upward re-probe handles. The renderer string is unavailable on some browsers. Add quality.test cases for a steady 0.4 s frame time. Two S candidates merged into M.

### C45. Faster first load: split the 945 KB main bundle and get the troop pack in before the first battle

- Area: load time. Effort: L. Sim: no. Sources: tech-online
- Kids notice: The home screen appears sooner on the old tablet, and the very first battle has the same chunky toy soldiers as every other battle.
- Problem: All app code ships in one index chunk (945 KB raw / 324 KB gzip) plus three.js (616 / 157 KB) and a 211 KB stylesheet. A low-end phone must parse all of it before the first frame, including screens a kid may not open (deck builder, Studio with its own WebGLRenderer, pass, road, chest reveal, trials, gallery). The battle then waits at most 3 s for the modelled cast and latches the older procedural roster for the whole battle; online matches don't wait at all. On a slow device the first battle has different-looking troops from the rest, and two siblings online can see different rosters. On the dev server under SwiftShader the pack took ~10 s.
- Proposal: (1) Lazy-import non-Home screens and Golden Age-only modules with dynamic import(), keeping the battle path eager, prune unused CSS, and track index gzip size in CI. (2) Start the cast pack earlier: modulepreload the roster chunk and preload the 7 GLBs (with fetchpriority=low after the main script), or call castReady() before main.ts builds the scene. (3) Show 'Gathering your troops…' on the VS screen while the gate waits. (4) Online: have both peers report castReady during the lobby's existing 'Opponent found' to 'Get ready!' window. All lazy chunks go into the precache manifest from C41.
- Evidence: dist/assets sizes from HEAD (index-CgoAUPGQ.js 944,916 B raw / 324,006 B gz; three-CKLeDCq5.js 616,481 / 156,926; index-N9DsaCSx.css 210,653 / 42,249); src/main.ts:482-519 CAST_WAIT_MS = 3000 and the online latch; src/render3d/cast/loader.ts:128-138; /tmp/claude-0/plan/tech-online/measure.out ('cast: pack ready in 9953 ms').
- Risk: Lazy chunks add a small delay the first time each screen opens and break offline unless precached (C41 is a must). Preloading 0.8 MB competes with the main bundle on slow links. Readiness coordination adds a lobby step but no sim change. SwiftShader dominates timings here, so validate on a real low-end device. An M and an S candidate merged into L.
- Depends on: C41

### C46. Deploy safety: a CI browser smoke test, Render waits for CI, and restarts let live matches finish

- Area: CI / deploy pipeline. Effort: M. Sim: no. Sources: tech-online
- Kids notice: Fewer days when an update turns the game into a blank or frozen screen, and an update in the afternoon no longer kicks two siblings out of a friend match.
- Problem: CI runs tsc and vitest (142 files / 1,815 tests, no flakes) but never loads the built game in a browser, so a broken import, lazy-chunk path, service worker error, shader compile failure or page error at battle start passes and deploys. tools/perf-budget.mjs and tools/relay-smoke.mjs run only locally. Render, which serves the main URL kids use, rebuilds on every commit (autoDeployTrigger: commit) without waiting for CI, and every deploy restarts the in-memory relay, ending any live match ('The game server is restarting'). relay.yml runs the suite again on Node 20 while everything else uses 22, and deploys to Fly, which the live setup doesn't use.
- Proposal: (1) A CI job after build: build:all, start dist-server/relay.mjs, and use puppeteer-core with the runner's Chrome to load the page and fail on any pageerror, skip the tutorial with seeded storage, run a bot battle for 10 s, run relay-smoke, and run perf-budget gates on counters (not fps) at high and low quality. (2) Set autoDeployTrigger: checksPass in render.yaml. (3) Drain the relay on SIGTERM: refuse new rooms and queue entries, let running matches finish, set maxShutdownDelaySeconds near Render's maximum (300 s), then send server-restart only to rooms still left. (4) Align relay.yml on Node 22 and drop its duplicate test run or clearly skip the Fly step.
- Evidence: render.yaml:32 'autoDeployTrigger: commit' (verified) with the 'ends any match in progress' comment; .github/workflows/deploy.yml:21-36 verify job gates only the Pages build (verified); .github/workflows/relay.yml:29-35 node 20 and a second vitest run; tools/perf-budget.mjs, tools/relay-smoke.mjs; src/net/protocol.ts ErrorReason 'server-restart'; /tmp/claude-0/plan/tech-online/vitest1.log and vitest2.json.
- Risk: SwiftShader runners make fps meaningless, so gate on errors and counters. Adds 3-5 min to CI. Pin the Chrome version. checksPass needs checks reported on the deployed branch, which deploy.yml does. Confirm the Render plan honours maxShutdownDelaySeconds. An S and an M candidate merged into M.

### C47. Rejoin a friend match after the browser reloads the tab, with a longer grace when a kid steps away

- Area: online robustness. Effort: L. Sim: no. Sources: tech-online
- Kids notice: If the tablet reloads the game while they're away for a moment, they tap 'Jump back in' and keep playing the same match.
- Problem: Socket drops are handled well (resume with backoff, 20 s seat grace, pause on hidden), but the resume token lives only in memory. If a low-memory phone or tablet discards the backgrounded 3D tab, the kid comes back to a fresh page with no way back into the match. The relay keeps only (20+10) s of frames, so even a stored token couldn't catch a fresh page up from tick 0. Stepping away for more than 20-25 s ends the match as a win for the friend. 'Online resume after a reload' is deferred.
- Proposal: Store {code, token, role, start payload} in sessionStorage at match start and clear it at the end. On load, if one exists and is younger than a match length, show 'Jump back into your match!'. Add a 'rejoin' handshake: the relay keeps the full, bounded input log for each live match, and the client fast-forwards from tick 0 in CATCH_UP_TICKS chunks behind a 'catching up…' veil. When the dropped seat had sent pause first, extend the grace to ~60 s and show the waiting friend a countdown with a 'Take the win' button.
- Evidence: src/match/online.ts only localStorage use is FRIENDLY_WINS_KEY (:378-379); token only in memory (src/net/roomClient.ts:44); src/net/rooms.ts:31 GRACE_SEC = 20, :48 LOG_TICKS = (GRACE_SEC + 10) * 30; src/net/session.ts:37 STALL_LIMIT_MS, :45-47 resume backoff; enhancement-plan.md:191 '[ ] Online resume after a reload'; notes/features/online-1v1.md:74-77.
- Risk: Protocol change: PROTOCOL_VERSION bumps (SIM_VERSION does not) and the relay must ship first. Fast-forwarding ~5,000 ticks on a slow phone may take seconds, so measure and cap it. Relay memory per room grows (bound it). Who wins when the grace runs out needs new forfeit tests.

### C48. Show each arena as a picture on Trophy Road, Home and unlocks

- Area: progression UI / arena previews. Effort: M. Sim: no. Sources: visuals
- Kids notice: They can see what the next arena looks like and want to get there.
- Problem: Outside battle, arenas exist only as text: Trophy Road milestones are navy banners ('ARENA 2 / Bone Pit / 200'), Home says 'Next: Goblin Stadium', and the battle-setup lock caption is text. A kid can't see what they're working toward, even though 11 distinct 3D looks per edition exist.
- Proposal: A small cached snapshot per arena look (an offscreen diorama render at about 320x180 when first needed, or PNGs baked at build time). Show it in Trophy Road's arena banners (locked ones greyed with a padlock), on Home's 'Next' line (tap to peek), in the battle-setup arena picker, and as a big 'New arena unlocked!' reveal that zooms into the new diorama.
- Evidence: /tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad/shots/t-normal-390x844-claim-road.png; /tmp/claude-0/art/final/publish/classic-phone-home.png; src/ui/screens/road.ts; src/ui/screens/battleSetup.ts:9, :65-80.
- Risk: Build size if 22 PNGs are baked; runtime snapshots need the cast and stage loaded. Trophy Road must stay scrollable. Pictures are worth more once arenas look distinct (C34).
- Depends on: C34 (soft)

### C49. Your deck's troops hang out on the home diorama

- Area: home diorama. Effort: M. Sim: no. Sources: visuals
- Kids notice: Their favourite troops are hanging out on the home screen, and tapping one makes it do something.
- Problem: The home screen's 3D arena shows empty towers and an empty court. The modelled cast that kids collect never appears outside battle except as framed portraits.
- Proposal: Place 3-5 troops from the current deck on the blue half of the diorama, idling, wandering a little and sparring with a training dummy, using cast rigs at the quality level's mixer rate. Tapping one plays its idle personality and voice line, and the set updates when the deck changes. Wait for castReady, and show no troops on the Low quality level.
- Evidence: /tmp/claude-0/art/final/publish/classic-phone-home.png and golden-phone-home.png (empty diorama); src/ui/screens/home.ts:108, :170; src/app/lifecycle.ts:5-30 (diorama pacing); commit 4186f6c (cast heavy half is a lazy chunk).
- Risk: Home frame time and memory on low-end devices, and a first-load hitch while the cast chunk downloads.

### C50. Champion Studio preview should match the battle champion

- Area: Champion Studio. Effort: S. Sim: no. Sources: visuals
- Kids notice: The champion they design looks exactly the same when it walks onto the battlefield.
- Problem: The Studio's 3D preview still builds the old procedural champion (buildChampionRig from characters3d), while the champion's card portrait and its battle unit use the new cast. A kid designs a hero in one style and then sees a different-looking figure in battle.
- Proposal: Build the Studio preview with the cast's champion builder (the one portraits and battle use) on the same turntable, mapping each Studio option (colours, hat, weapon) onto cast variant slots so preview, card and battle unit are identical. Dispose the rig as before.
- Evidence: src/ui/screens/studio.ts:22 imports buildChampionRig from render3d/characters3d, :142 rig = buildChampionRig(cur) (verified); notes/features/art-ship.md:165 gap 9 'the procedural Studio champion'; art-cast-kit.md known gaps.
- Risk: Studio options with no cast equivalent need a mapping or a new variant. The cast pack must be loaded before the Studio opens.

## Completeness critic

The plan is sound overall. It covers every area (gameplay, feel and audio, visuals, young-kid UX, safety, devices, online, content, originality). Every item scoring 7 or more is scheduled. Sim and protocol changes are flagged and grouped under skip. Round 1 is the right next step. Three problems would change round 1 or mislead the parent. (1) The live game redeploys on every commit to the very branch that rounds 1 to 3 will be built on, and the plan only fixes that in round 3. (2) "Friends-only" is weaker than the plan says: there are only 2,000 room codes and nothing limits wrong guesses. (3) Every round holds roughly twice the work its hour figure claims under the stated effort scale. Round 4 is the worst, since the Adventure Trail alone was sized L to XL. One hidden cost in C01 was also checked by running it. Re-tuning the Normal bot breaks challenges.test, because the challenge solver uses Normal. With the proposed profile, air-raid drops to 1/10 (the test needs at least 2) and sky-pirates (3 stars) rises to 10/10 (the test caps 3-star puzzles at 7). Scratch script: /tmp/claude-0/plan/completeness-critic/chsolve.ts. Nothing in the plan copies a commercial game. It does leave some copied labels out of the rename's scope (Princess, elixir, the public URL).

- **major**: The plan leaves the live game deploying on every commit until round 3. render.yaml:24 points Render at the working branch claude/game-visuals-character-balance-w122wb, and render.yaml:32 sets autoDeployTrigger: commit. The file's own comment says every push 'restarts the server, which ends any match in progress'. Render does not wait for CI: deploy.yml's verify job gates only the Pages build, and deploy.yml:9 also publishes Pages from this branch. 135 commits landed on 2026-11-11 alone. Rounds 1 and 2 will push dozens more commits to this exact branch, and each one restarts the kids' server mid-match and can ship code that has not been checked. The plan ties the fix to C46 and decision 3 in round 3.
  - Fix: Add an 'item 0' to round 1, under an hour of work, and ask decision 3 before round 1 starts. Set autoDeployTrigger: checksPass in render.yaml now: it is one line, and deploy.yml already reports checks on this branch. If the parent picks the release-branch option, also point `branch:` at a release branch the owner moves forward on purpose, and drop the working branch from deploy.yml's Pages trigger. Keep C46's browser smoke test and the SIGTERM drain in round 3. Put decision 3 at the top of the decisions list.
- **major**: The 'friends-only' safety step is weaker than the plan tells the parent. A room code is one of 20 animal words plus two digits (src/net/codewords.ts:2-31), so there are only 2,000 codes. A waiting room lives for 10 minutes (src/net/rooms.ts:32). join() starts the match for any matching code with no confirm step (rooms.ts:152-160). The relay's only limits are 60 messages per second per connection and 8 connections per IP (server/relay.ts:29, :59), with no cap on failed 'no-such-room' joins. Browser origin checks do not stop a script, which can fake that header. So a script could try every code in under a minute, land in a kid's waiting friend room and see their typed name. QUICK_MATCH=off removes the random queue but does not make online play friends-only. The plan's 'Online is friends-only by default' and C38's 'Only play codes with people you know' overstate the protection. The wording is also off. Round 1's QUICK_MATCH=off is friends-only for everyone, with no switch. Round 3's grown-up 'Play strangers' switch only works if QUICK_MATCH is turned back on at the relay. After that the only gate is on the kid's own device.
  - Fix: Add a small relay item next to round 1's C38 slice. Count failed joins per IP and connection, and after about 5 misses a minute answer with the existing 'rate-limited' ErrorReason. Add a relay test for it. Optionally use two words plus two digits for new codes (normalizeCode must still accept old codes). Reword the plan: 'Quick match is switched off for everyone and room codes can't be guessed. A grown-up switch for strangers comes in round 3.' Note in round 3 that option (b) means turning QUICK_MATCH back on, with only the gate on the kid's device in front of it.
- **major**: The round sizes are understated against the plan's own effort scale (S under 1 h, M a few hours, L a full round of about half a day). Round 1 is 2 M + 4 S + 3 tiny items, roughly 7 to 11 h, but is labelled 4 to 6 h. Round 2 is 4 M + 1 S, roughly 9 to 13 h, labelled 4 to 6 h. Rounds 3 (C38 at L + 2 M + 1 S), 4 (C06 at L, or L to XL per the engineer judge, + 3 M) and 5 (C25 at L + 2 M + 1 S) each contain a full round's L plus two or three Ms, so each is really about two rounds. The parent is told 'five rounds'. Realistically it is seven or eight, unless the hours mean wall-clock time with parallel agents, which the markdown never says. Round 4's 'if it runs long, ship the trail second' admits this, but only for one round.
  - Fix: Either state that the hours assume several agents working in parallel, or re-size the rounds. Round 1 becomes about 8 to 10 h, or C14 moves to the start of round 2. Split round 4 into 4a (C20, C03, C05) and 4b (C06 Adventure Trail on its own, with its solvability harness). Split round 5 into C23, C28 and C50 first, then C25. Tell the parent plainly how many rounds that makes.
- **minor**: C01 has an unflagged coupling. challenges.test.ts:19 and :201 solve every puzzle with DIFFICULTIES.normal. I ran the 15 challenges with the profile C01 proposes for Normal ({thinkInterval 2.5, mistakeRate 0.15, reactionDelay 0.8}). air-raid falls to 1/10 (the test needs at least 2/10), and sky-pirates (3 stars) rises to 10/10 (the test caps 3-star puzzles at 7/10). So re-tuning the tiers fails challenges.test and quietly changes how hard the puzzles are rated. This did not show up in the plan. Old replay tapes are fine: tapes store the full botProfile (main.ts:200, :669), and bot.test pins its profiles as literals (bot.test.ts:397-399).
  - Fix: In C01, give challenges.test a frozen SOLVER_PROFILE ({thinkInterval: 1.0, pushAt: 8}) that does not follow tier tuning. Use the same frozen solver for the C05 and C06 solvability harnesses in round 4. Add this to C01's risk line.
- **minor**: Decisions are not marked by when they are needed, and decision 4 can cost progress if acted on early. Round 1 cannot start until decisions 1 (strangers), 5 (youngest reader), 6 (season) and, with the fix above, 3 (deploys) are answered. Decision 4 ('GitHub Pages behind the icon') reads like something the parent could switch today. But saves stay on the Render address until C42's save code ships in round 2. And until round 3's C40, Play a friend from Pages shows 'Couldn't reach the game server' every time Render is asleep (src/net/roomClient.ts:50 gives up after 8 s; lobby.ts:102-103).
  - Fix: Group the decisions as 'needed before round 1' (1, 3, 5, 6) and 'needed later' (2 before round 4; 4, 7 and 8 before round 3). Add to decision 4: 'Don't move the icon until the save code exists in round 2. Friend games from the Pages link get reliable in round 3.'
- **minor**: The originality fix leaves some visible copied labels out. C20's scope names Cannoneer and Dagger Duchess but not the default 'Princess' tower troop (src/game/towers.ts:29), the 'Princess' card (src/game/cards.ts:589), 'Tower Princess' (src/render3d/gallery.ts:58) or the HUD lines 'Your Princess tower fell' (src/render3d/hudModel.ts:470-475). Nobody decides whether 'elixir', the commercial game's own name for the resource, is kept, and C14 adds new copy ('Elixir full! Play a card!'). The public address clash-royale-clone.onrender.com (render.yaml name) is not part of any decision. C19 is an S task that is independent of C41: sw.js:30 is a single SHELL_MARK string covered by sw.test. Yet it waits until round 2 while the home-screen label says 'CR Clone' (index.html:12).
  - Fix: Add Princess (troop, card and HUD lines) and a decision on 'elixir' to C20's naming sheet and denylist test. Have C14 read the resource word from one string so a rename is one edit. Under decisions 2 and 4, add 'rename the public address' (only after the save code exists, because a new address starts with empty saves). If the parent confirms 'Crown Rush', move C19 into round 1.
- **minor**: C28's online cost is overstated, and the cheap emote slice is too narrow. showOnlineEmote (src/match/online.ts:264-266) silently drops an emote index it has no picture for. So new emotes on indexes 4 to 7 work with old clients and need no PROTOCOL_VERSION bump or reload. The plan says 'Both players may need to reload once'. Also, until round 5, siblings can still only send laughing, crying, thumbs-up and angry (main.ts:1006).
  - Fix: Put the new set on indexes 4 to 7 and take 0 to 3 out of the picker. Drop the reload or protocol-bump wording. Optionally extend round 1's tiny slice to swap the 😂 and 😡 glyphs for friendly ones (update noEmoji.baseline.json).
- **minor**: Two engineer-judge notes are dropped without a reason. The owner has no crash or error visibility from real devices. golden.test locks only one standard match, so challenge, sandbox, draft, mirror and crazy logic has no determinism guard, and C05 and C06 are about to grow that logic.
  - Fix: In the skip list, say that no remote crash reporting is sent from kids' devices on purpose, for privacy, and that C43's 'Problem report' with its copy button is how the owner sees errors (mention it in the round 2 bullets too). Add one seeded checksum fixture per solo mode to C05 in round 4.
- **minor**: A few lines in the parent-facing text go beyond the evidence. "'Hard' is actually easier than 'Normal'" is a bot-against-bot result (Normal beat Hard 22-2). For the kid proxy, both tiers won 0/40, so for a beginner they are equally unbeatable. 'Digits match everywhere' overclaims C21, which fixes the season key, card trait numbers, HP plates and a few labels. 'They pick which card leaves' (C18) needs a new deck-strip picker on top of the confirm({emphasis:'cancel'}) change, so 'Small' is closer to S to M.
  - Fix: Reword to: 'Normal and Hard both crush a beginner, and in bot-against-bot tests Hard even loses to Normal.' Change 'digits match everywhere' to 'digits match on the season, card info and tower health'. Size C18 at S to M, or ship 'Keep my deck' as the default first and the picker second.

Merge notes: 73 raw candidates from 6 scouts became 50 items. Verified at 749b073 by grep and reads; the evidence fields mark what was checked.

MERGES
- Originality rename: 6 candidates (gameplay-content, feel-audio, visuals, ux-kids, tech-online, playtest) split into two items.
  - C19 is the visible product name ('Clash Royale Clone' / 'CR Clone' in the title, manifest, splash and SW SHELL_MARK). It is an S, ships alone, and carries its own SW coupling.
  - C20 is the Classic card, arena, tower-troop and label naming pass (M). It is display-only and keeps every id.
- Save backup: ux-kids and tech-online merged into C42.
- Service worker: ux-kids' offline precache, tech-online's network-timeout launch and the precache half of tech-online's bundle split became C41, all one file (sw.js) and one goal. The bundle split plus the cast preload became C45.
- Quality governor: playtest's 0.25 s hitch filter and tech-online's 'remember level / GPU guess' became C44 (same file, quality.ts).
- Render sleep: the lobby waking state and the keep-alive workflow became C40.
- Crash shield and boot splash became C43. CI smoke and the Render deploy gate / relay drain became C46.
- Grown-ups corner: the family-safe online item and the play-time reminder became C38. They share the parent gate and the Settings section.
- Elixir clarity: feel-audio's ready chime and playtest's '+N' badge / full-elixir nudge became C14.
- Card clarity: ux-kids' picture-first card info and playtest's tile names became C15.
- First Home: playtest's padlock wall and ux-kids' new-cards sheet became C03.
- Daily goals: richer quests / sticker card and the featured party event became C07.
- Audio:
  - Spell fallback and building/tower death sounds became C23.
  - Overtime cue and side-aware haptics became C26 (both proposed an overtime buzz).
  - Battle music and crowd ambience became C27.
  - The result-screen audio, feel-audio's results track and visuals' on-field victory celebration became C25, because they share the KO-to-result timing.
- Arena variety: the Classic and Golden Age candidates became one XL item, C34, to ship as two rounds.
- 3D chest: visuals (L) and playtest (M) became C37, taking L.

SPLITS
- visuals' 'Better payoff when a tower falls, and damage numbers' bundled unrelated work. The tower-fall part joined feel-audio's crown-sync candidate as C29. The damage-number part joined feel-audio's de-overlap candidate as C30.
- feel-audio's 'More music' results track moved into C25. The rest stayed in C27.

CORRECTIONS AND DROPPED SUB-POINTS (already done or wrong)
- ux-kids' claim that '<html lang> stays en' in Golden Age is wrong. src/render3d/theme.ts:35 sets document.documentElement.lang = 'ar' at runtime, so it was dropped from C21. Also added to C21: the bad 'افز' verb appears in quests.ts:20-21 as well as achievements.ts.
- art-ship gap 4 says there is 'no flying crown to the scoreboard'. That is stale: flyCrown exists at main.ts:1111. C29 was re-scoped to arrival timing, the '+1' stamp, the landing sound and team debris.
- gameplay-content's mastery proposal wanted locked cards shown as silhouettes in the book. That already exists (collection.ts:66 cardSilhouette), so the sub-point was dropped from C08.
- ux-kids called the emote set '8 fixed emotes are safe'. The client actually has 4 raw emoji (main.ts:1006). The protocol already carries indexes 0..7 (session.ts:440), which C28 uses.
- tech-online said the governor 'works' and playtest said it never steps down. Both are true: it works when frames stay under 0.25 s and fails below about 4 fps. C44 covers both.

EFFORT AND RISK FLAGS
- No candidate was dropped as fully done. Every 'missing' claim I checked held:
  - no save export or storage.persist
  - no global error handler or try around the frame body
  - no speechSynthesis
  - no 'friend' entry on Home
  - SPELL_PORTRAITS = {comet}
  - sw.js install caches only './' plus the cast
  - autoDeployTrigger: commit
  - the 0.25 s governor filter
  - bot tier profiles as stated
  - season soft reset as stated
- Merged pairs took the summed effort. Where sources disagreed (C37: L vs M) the larger was taken and the reason is noted in risk.
- Only C12 (2v2) and C13 (balance pass) touch the sim.
- C47 (rejoin) bumps PROTOCOL_VERSION but not SIM_VERSION.
- C01's smarter Hard logic in src/game/bot.ts needs a bot.test re-capture. It is marked touches_sim=false because bots never run online, with a replay-tape check noted in its risk.
