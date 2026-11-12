# Kind and never stuck (round 1, package "kind")

Round 1 of [enhancement-plan-2026-11.md](enhancement-plan-2026-11.md), items C02, C27 (tutorial slice), C18, C04 and C28 (no-taunts slice). Branch `r1/kind` from 2054fdb. No sim change: the only edit under `src/game` is tutorial step text in `src/game/tutorial.ts`.

## What changed, before and after

### C02. The wrong card gets a nudge (tutorial)

Before: in the Fireball lesson the coach said "Archers in a bunch! Throw a Fireball on them..." while the kid held an Archers card. Pressing any card other than the glowing one landed on the dim mask and was silently ignored: nothing deployed, nothing moved, the coach said nothing, the clock stayed frozen. The playtester dragged Archers 23 times.

After (`src/ui/tutorialOverlay.ts`):
- A press on the dimmed screen during a lesson nudges. The glowing target card wiggles (the KING button in the King lesson), the glove's drag replays from the start, and the coach line changes for about 3 s (`NUDGE_MS`) to "Not that one. Use the glowing Fireball card!" (or "Drag the glowing Fireball card onto the glowing spot!" for a press away from the cards), with a little shake of the bubble. The card names come from `cardDisplayName`, so Golden Age says "ليست هذه. استخدم بطاقة قذيفة نفط المضيئة!". Then the lesson's own line comes back. The clock stays held and nothing deploys.
- While a lesson holds the clock, the target card's name sits on an accent chip just above it ("Fireball" / "قذيفة نفط").
- The line is drawn as soon as the finger lands, not on the next frame.

Step text (`src/game/tutorial.ts`, text strings only). No card lesson opens with another card's name:
- Musketeer lesson: "A Giant is coming for your tower!" becomes "Something big is coming for your tower! Drop the Musketeer here to shoot it down." The Giant card is in the hand at that point.
- Fireball lesson: "Archers in a bunch! Throw a Fireball on them..." becomes "Throw your Fireball on that bunch of enemies to hit them all at once!"
- The Arabic lines now use the Golden Age card names the kid sees on the cards: إنكشاري (Musketeer), قذيفة نفط (Fireball), فيل الحرب (Giant). Before, they used names no card has (الرامية, كرة النار, العملاق), and the Fireball lesson opened with رماة, the Archers card's own Golden Age name. The idle lines were fixed the same way.

Tests (`tutorialOverlay.test.ts`) cover:
- the card under the finger;
- the nudge copy in both languages, for a press away from the cards and for the King lesson;
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
- Add opens a strip of the kid's 8 deck cards (two rows of four, names under each). They tap the card that goes out, and nothing changes until they do. "Keep my deck" is the big yellow, focused default (`confirmLook({ emphasis: "cancel" })`, the same look as the tutorial's skip question). Esc and a backdrop tap also keep the deck. The strip ignores taps for its first 450 ms, so a double tap on Add can't pick a card.
- A deck with a free slot simply takes the new card.
- `swapOutIndex` is gone. Nothing picks the outgoing card for the kid.

Tests: the swap changes exactly the tapped slot; Keep is the CTA and has the first focus; the reveal's card step has no button and the offer is in the summary below Collect; no auto-pick remains in the source.

### C04. The season reset keeps their arena

Before: `softReset = 1000 + floor((t - 1000) / 2)`. A kid at 1600 (Royal Arena) woke up at 1300 (Builder's Workshop), and a banner showed the drop.

After (`src/meta/achievements.ts`): `seasonResetTrophies(t) = max(floor of the arena t stands in, 1000 + floor((t - 1000) / 2))`.
- 1600 stays 1600, 1900 trims to 1600, 2500 to 2400 and 3400 to 3000. Values at or below 1000 are untouched.
- `checkSeason` also reports `rolled`, and every season rollover is celebrated with a short toast above the tab bar: "November 2026 season starts! You kept Royal Arena." / "بدأ موسم نوفمبر ٢٠٢٦! بقيت في قصر الحمراء." The season name brings the edition's digits.

Tests: every trophy count from 0 to 6000 (twice the road's end) keeps its arena index; the 1600 case; trims that stop at the arena floor; the toast text in both languages. The road test's reset expectation moves from 1200 to 1300.

### C28 slice. A kind bot and friendly emotes

Before: `EMOTES = ['😂','😭','👍','😡']`. Once a kid was past the polite window, the bot laughed when it took their tower and showed a party face when it beat them.

After: the emote table and the bot's manners live in the new `src/ui/emotes.ts`.
- The bot only reacts kindly (`botReaction`):
  - "wow" when the kid takes its tower;
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

## Known gaps and follow-ups

- On the summary, Collect sits at the centre of the screen, so a kid who keeps tapping there collects and skips the Add offer. Their deck is safe, and the card is in Cards. A NEW badge on the Cards tab (from the plan) was not built.
- The emotes are still device emoji drawn in the inked bubble. Original inked art for eight emotes is round 4 (C28 full).
- The pause menu also hushes the battle music, because it holds the same clock. This seemed right, but it is a side effect.
- `politeBot()` was removed from `main.ts` together with the `POLITE_MATCHES` and `ladderMatchesPlayed` imports there. `difficulty.ts` still exports and uses them. If the bot-difficulty package edits the same import block, expect a trivial merge.
