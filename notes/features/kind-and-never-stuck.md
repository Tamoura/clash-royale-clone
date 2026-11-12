# Kind and never stuck (round 1, package "kind")

Round 1 of [enhancement-plan-2026-11.md](enhancement-plan-2026-11.md), items C02, C27 (tutorial slice), C18, C04 and C28 (no-taunts slice). Branch `r1/kind` from 2054fdb. No sim change: the only edit under `src/game` is tutorial step text in `src/game/tutorial.ts`.

## What changed, before and after

### C02. The wrong card gets a nudge (tutorial)

Before: in the Fireball lesson the coach said "Archers in a bunch! Throw a Fireball on them..." while the kid held an Archers card. Pressing any card other than the glowing one landed on the dim mask and was silently ignored: nothing deployed, nothing moved, the coach said nothing, the clock stayed frozen. The playtester dragged Archers 23 times.

After (`src/ui/tutorialOverlay.ts`):
- A press on the dimmed screen during a lesson nudges. The glowing target card wiggles (the KING button in the King lesson), the glove's drag replays from the start, and the coach line changes for 5 s (`NUDGE_MS`; it was 2.8 s until the final review) to "Not that one. Use the glowing Fireball card!" (or "Drag the glowing Fireball card onto the glowing spot!" for a press away from the cards), with a little shake of the bubble. The card names come from `cardDisplayName`, so Golden Age says "ليست هذه. استخدم بطاقة قذيفة نفط المضيئة!". Then the lesson's own line comes back. The clock stays held and nothing deploys.
- While a lesson holds the clock, the target card's name sits on an accent chip just above it ("Fireball" / "قذيفة نفط").
- The line is drawn as soon as the finger lands, not on the next frame.
- The finger that started a nudge says it again when it lifts. A slow wrong drag (longer than the 5 s line) gets the line, the wiggle and the glove's replay again at the drop. A quick tap's release only keeps the line up.
- On a touch screen the drop is a real pointerup: the active mask has `touch-action: none` (on the `<svg>` too, since Chrome reads it there and not on the shape inside), so the browser never takes the finger over with a pointercancel. If a browser cancels anyway, the cancel says nothing mid-drag and the nudge waits for the touch's own `touchend` (`cancelNudge`, `touchEndNudge`).

Step text (`src/game/tutorial.ts`, text strings only). No card lesson opens with another card's name:
- Musketeer lesson: "A Giant is coming for your tower!" becomes "Something big is coming for your tower! Drop the Musketeer here to shoot it down." The Giant card is in the hand at that point.
- Fireball lesson: "Archers in a bunch! Throw a Fireball on them..." becomes "Throw your Fireball on that bunch of enemies to hit them all at once!"
- The Arabic lines now use the Golden Age card names the kid sees on the cards: إنكشاري (Musketeer), قذيفة نفط (Fireball), فيل الحرب (Giant). Before, they used names no card has (الرامية, كرة النار, العملاق), and the Fireball lesson opened with رماة, the Archers card's own Golden Age name. The idle lines were fixed the same way.

Tests (`tutorialOverlay.test.ts`) cover:
- the card under the finger;
- the nudge copy in both languages, for a press away from the cards and for the King lesson;
- the press wiring: a lesson's press on the dim area is a nudge (`overlayPress`; reverting it to "ignored" fails a test). The real tutorial battle is run to the Fireball and King lessons, and pressing Archers names the Fireball while the step, the held clock, elixir and units stay as they were;
- bursts (one wiggle) and the release cases (a slow drop nudges again; another finger or a new step does not), including a touch that the browser cancels at the start of the drag and that lifts much later (the drop gets the nudge, once), and the mask's `touch-action: none` rule;
- the first card each lesson names is the card to play, in both editions. The Golden Age names are loaded with the Arabic edition stubbed in.

### C27 slice. Quiet tutorial waits

Before: the battle track kept playing in full while a lesson held the clock at 0.

After: `src/audio/wire.ts` checks `simHeld()` on every playing frame of a solo match. This is the hold the tutorial registers with `registerSimHold`. While it is held, `SoundEngine.setHushed(true)` plays only the track's quietest bed: the bass line, at 70%. (Tracks with a pad would keep the pad; the battle track has none.) Lead, counter-melody, hats and drums return on the next step after the kid plays. No new music was written.
- Hush never applies online, never during the countdown, and never to the menu theme.
- It is cleared on menus, at a new match, at a result and at matchEnd.
- The pause menu holds the same clock, so it hushes the music too.

Tests: the layer choice; far fewer notes while hushed and the full track afterwards; the menu theme unaffected; the wiring turning hush on and off with a held clock and clearing it on menus and at match end.

### C18. A chest never swaps out their cards

Before: the reveal said "Tap to continue · hold to skip", and each new card's "Add to deck" button sat where those taps land. Centre taps opened "Skeletons takes the place of Giant ... your most expensive card" with "Swap in" as the yellow default. `swapOutIndex` picked the card automatically.

After (`src/ui/screens/chestReveal.ts`, new `src/ui/screens/deckSwap.ts` and `styles/deckSwap.css`):
- The reveal sequence has no Add button. A new card shows its ribbon and the line "You can add it to your deck at the end."
- The summary shows "<card> is new! Want it in your deck?" with an Add button below Collect, away from the centre of the screen. The button ignores taps for 450 ms after the summary appears.
- Collect ignores taps for its first second (`COLLECT_ARM_MS` = 1000) and shows it: it starts at 60% opacity and lights up when ready. It sits under the tap-to-continue spot, so before this a fast tap-through collected about 120 ms after the summary appeared and the kid never saw the new-card offer.
- Add opens a strip of the kid's 8 deck cards (two rows of four, names under each). They tap the card that goes out, and nothing changes until they do. "Keep my deck" is the big yellow, focused default (`confirmLook({ emphasis: "cancel" })`, the same look as the tutorial's skip question). Esc and a backdrop tap also keep the deck. The strip ignores taps for its first 450 ms, so a double tap on Add can't pick a card.
- A deck with a free slot simply takes the new card.
- `swapOutIndex` is gone. Nothing picks the outgoing card for the kid.

Tests run the real screens on a small fake DOM (`src/ui/fakeDom.testkit.ts`, since vitest runs in node with no DOM library):
- `chestReveal.test.ts` plays the reveal under fake timers while a kid taps the middle every quarter second. No button or dialog appears in the chest, open, loot or card stages. On the summary Collect comes first and the offer below it. Tapping on through and Collect keeps the deck. Taps on Collect in its first second do nothing; then it collects. Add opens the strip; Keep, Esc and the backdrop keep the deck; tapping Archers swaps exactly that slot (not the most expensive card); a deck with room just takes the card.
- `deckSwap.test.ts` opens the strip on its own. Keep my deck is the focused CTA with no OK button. A card or backdrop tap in the first 450 ms is ignored, a tap inside the box does nothing, and Tab stays inside. Also the pure swap helpers.

### C04. The season reset keeps their arena

Before: `softReset = 1000 + floor((t - 1000) / 2)`. A kid at 1600 (Royal Arena) woke up at 1300 (Builder's Workshop), and a banner showed the drop.

After (`src/meta/achievements.ts`): `seasonResetTrophies(t) = max(floor of the arena t stands in, 1000 + floor((t - 1000) / 2))`.
- 1600 stays 1600, 1900 trims to 1600, 2500 to 2400 and 3400 to 3000. Values at or below 1000 are untouched.
- `checkSeason` also reports `rolled`, and every season rollover is celebrated with a toast above the tab bar: "November 2026 season starts! You kept Royal Arena." / "بدأ موسم نوفمبر ٢٠٢٦! بقيت في قصر الحمراء." The season name brings the edition's digits, and the line goes through `tr()`.
- The toast stays up 6 s (`SEASON_TOAST_MS`; `toast()` takes an optional lifetime, the default is still 2.4 s), long enough for a young reader.

Tests: every trophy count from 0 to 6000 (twice the road's end) keeps its arena index; the 1600 case; trims that stop at the arena floor; the toast text in both languages; `toast()`'s default and longer lifetimes. The road test's reset expectation moves from 1200 to 1300.

### C28 slice. A kind bot and friendly emotes

Before: `EMOTES = ['😂','😭','👍','😡']`. Once a kid was past the polite window, the bot laughed when it took their tower and showed a party face when it beat them.

After: the emote table and the bot's manners live in the new `src/ui/emotes.ts`.
- The bot only reacts kindly (`botReaction`):
  - "wow" when the kid takes its tower (but not when that tower ends the match: then only the end's emote shows, instead of wow and a thumbs up on the same frame);
  - nothing when the bot takes the kid's tower;
  - a thumbs up when the kid wins;
  - a friendly wave at the end otherwise.
  The polite-window check is gone because nothing is a taunt any more.
- The picker offers four friendly emotes, each with a spoken name in English and Arabic: hello wave (wire id 4), thumbs up (2), wow (5) and heart (6). Laughing (0) and angry (3) are gone, and crying (1) is no longer offered.
- Wire compatibility needs no protocol bump: the protocol carries ids 0..7 and `showOnlineEmote` skips any id without a glyph.
  - An old client shows only ids 1 and 2 and ignores 4..7.
  - Ids 0 and 3 are now empty slots, so a new client shows nothing when an old one sends them.
  - Id 1 (crying) still shows when an old friend sends it.
- The glyphs still draw on the inked, off-white canvas bubble.
- The emote button's aria-label goes through `tr()` ("Emotes" / "التعابير").
- `main.ts` drops three emoji literals, so its noEmoji baseline goes from 18 to 15.
- The glyphs in `emotes.ts` are written as `\u` escapes, as `meta/pass.ts` writes its own, so they stay out of the noEmoji ratchet's count. Emotes are emoji on purpose and the ratchet exempts the emote list, so there is no baseline entry for them.

Tests: four friendly picks, none of them retired or unkind; retired and unknown ids show nothing; the bot never laughs, gloats or celebrates the kid's loss; `main.ts` has no unkind glyph and no emote list of its own.

## Browser checks (390x844 phone, both editions; dev server)

Drivers are in /tmp/claude-0/r1/kind (`tut.cjs`, `nudge.cjs`, `chest.cjs`, `misc.cjs`, `music.cjs`). Screenshots are in /tmp/claude-0/r1/kind/shots.

- **Fresh profile, full tutorial, both editions.** The tutorial finished with Victory and Home with the chest: Classic in 214 s, Golden Age in 261 s. Every lesson showed its chip (Knight/فارس, Musketeer/إنكشاري, Fireball/قذيفة نفط, Giant/فيل الحرب).
- **Wrong card in the Fireball lesson.** The coach showed "Not that one. Use the glowing Fireball card!" (and the Arabic line). The Fireball card's wiggle animation ran, and the glove restarted from the card. No troop was deployed, the clock stayed held (battle time unchanged) and elixir was untouched. The lesson's line returned after about 3 s, and the right card then played. Shots: `normal-nudge.png`, `arabic-nudge.png`.
- **The tutorial's own chest, tapped through at the screen centre** (the playtester's move). The new card was Skeletons (ميليشيا in Golden Age).
  - No Add button and no dialog appeared during the sequence. A MutationObserver watched every stage.
  - On the summary, the centre of the screen is Collect. Tapping through there just collects, with the deck unchanged.
  - Add opened the strip with Keep focused and yellow. Keep left the deck unchanged. Tapping Archers swapped exactly that slot ("Added to your deck! Archers is still in your cards.").
  - The same flow worked at 1440x900 in both editions.
  - Shots: `normal-chest-newcard.png`, `normal-forced-chest-summary.png`, `normal-forced-chest-strip.png`, `normal-forced-chest-added.png`, `arabic-chest-summary.png`, `arabic-chest-strip.png`, `arabic-forced-desktop-chest-strip.png`.
- **Season.** A profile at 1600 trophies with last month's season booted to the toast "November 2026 season starts! You kept Royal Arena." (Arabic: "بدأ موسم نوفمبر ٢٠٢٦! بقيت في قصر الحمراء."), still at 1600 trophies. Shots: `normal-season-banner.png`, `arabic-season-banner.png`.
- **Emotes.** The tray shows wave, thumbs up, wow and heart with English and Arabic labels, and a sent wave pops in the inked bubble beside the king. Shots: `normal-emote-tray.png`, `normal-emote-bubble.png`.
- **Music.** Measured in the Classic edition only:
  - While the Fireball lesson held the clock: `hushed` true, 15 notes in 4 s.
  - In free play after the Giant lesson: `hushed` false, 24 notes in 4 s.

- **Production build.** `npm run build:all` served by the relay on port 3262: a fresh Golden Age profile opens the tutorial with the chip on فارس and no page errors. Shot: `prod-arabic-tutorial.png`.

Notes on the checks:
- This machine has no GPU (SwiftShader), so a frame can take hundreds of ms. For the nudge screenshot the driver stops repainting the arena while the finger is down, so the capture lands inside the 3 s nudge. Nothing in the game was changed for this.
- The "forced" chest runs play the real reveal module with a chest that has a new card, using a stand-in ctx. The non-forced runs open the tutorial's real chest.
- The bot's kind reactions are covered by unit tests. A ladder match where the bot takes a tower was not played in the browser.

## Review fixes (after the first review)

The review passed with minor findings only. All of them were fixed:
- The season toast lasted about 2.3 s, so it now stays up 6 s. Its line now goes through `tr()` instead of a boolean.
- The nudge wiring and the chest/strip DOM behaviour had no real tests, and the chest tests were regexes over the source. These are replaced by the press-wiring tests and the fake-DOM screen tests described above. Each was checked by breaking the code on purpose: the tests fail when the press is reverted to "ignored", when an Add button is put back on the card, when Add auto-picks a slot, and when the strip's arm delay or Keep's focus is removed.
- A slow wrong drag got no answer at the drop. The nudge now repeats on release.
- The bot sent wow and a thumbs up on the frame its King fell. It now sends only the thumbs up.
- The emote escapes are now documented in `emotes.ts`; no baseline change was needed.

Browser checks for these fixes are on the dev server at 390x844. Drivers are in /tmp/claude-0/r1/kind-fix and shots in /tmp/claude-0/r1/kind-fix/shots.
- **Slow wrong drag in the Fireball lesson, both editions.** Knight was pressed and dragged for about 8 s onto the glowing tile. The nudge showed at the press and went back to the lesson's line after about 3 s. At the drop it came back ("Not that one. Use the glowing Fireball card!" / "ليست هذه. استخدم بطاقة قذيفة نفط المضيئة!"), and the Fireball card wiggled again. Battle time (22.03), elixir (10) and units (0) were unchanged. Shots: `normal-drop-nudge.png`, `arabic-drop-nudge.png`.
- **Season toast.** At 1600 trophies in Classic it showed for about 5.9 s and the trophies stayed 1600. At 1900 in Golden Age it showed for about 5.6 s, in Arabic digits, and trimmed to 1600. Before the fix it showed for about 2.3 s. Shot: `arabic-season-1900.png`.
- **Bot.** In a Classic ladder match the bot showed wow when the kid took a princess tower. When the King fell, it showed only a thumbs up (no wow on the same tick).

## Final review fixes (merged round, branch r1/ship)

The blind final verifier passed the round with three minor findings. All three are fixed:
- **A slow wrong drag on a touch screen got no second nudge at the drop.** The mask kept the default touch-action, so about 1 s into a touch drag the browser sent pointercancel; the old code treated the cancel as the release (a second nudge mid-drag) and the real drop got nothing. Now the active mask has `touch-action: none`, and a cancelled touch waits for its `touchend` (see C02 above).
- **The nudge line went back after 2.8 s**, short for a young reader. It now stays 5 s, like the season toast's measure (about eight words for a 6-8 year old). `NUDGE_BURST_MS` is unchanged.
- **A fast tap-through collected the chest at once.** Collect now ignores taps for its first second and shows it (see C18 above). The NEW badge on the Cards tab was not built.

Browser checks, dev server, 390x844 phone with real CDP touch. Drivers are in /tmp/claude-0/r1/fix-1 (`nudgeprobe.cjs`, `chestfast.cjs`), shots in /tmp/claude-0/r1/fix-1/shots.
- **Slow wrong drag, both editions.** Knight was pressed in the Fireball lesson, dragged half way, held still for 6.5 s, then dropped on the tile. No pointercancel fired; pointerup and touchend arrived at the drop. Classic: the nudge showed at the press, went back after 5.1 s, came back at the drop and went back 5.0 s later. Golden Age: the same, 5.1 s and 5.1 s, in Arabic. The battle clock stayed at 22.0 s and no page errors.
- **Fast chest tap-through, both editions.** Centre taps about every 150-200 ms through the tutorial's chest and on into the summary. The summary stayed up for 1.07 s (Classic) and 1.18 s (Golden Age) while 5 taps landed on Collect and were ignored; Collect was at 0.6 opacity, and the "Skeletons is new! Want it in your deck?" / "بطاقة ميليشيا جديدة! أتريدها في مجموعتك؟" offer was on screen. Then a tap collected. The deck was unchanged. Shots: `chestfast-normal-phone-summary-early.png`, `chestfast-arabic-phone-summary-early.png`.

## Known gaps and follow-ups

- On the summary, Collect still sits at the centre of the screen. After its first second a kid who keeps tapping there collects and skips the Add offer. Their deck is safe, and the card is in Cards. A NEW badge on the Cards tab (from the plan) was not built.
- The emotes are still device emoji drawn in the inked bubble. Original inked art for eight emotes is round 4 (C28 full).
- The pause menu also hushes the battle music, because it holds the same clock. This seemed right, but it is a side effect.
- `politeBot()` was removed from `main.ts` together with the `POLITE_MATCHES` and `ladderMatchesPlayed` imports there. `difficulty.ts` still exports and uses them. If the bot-difficulty package edits the same import block, expect a trivial merge.
