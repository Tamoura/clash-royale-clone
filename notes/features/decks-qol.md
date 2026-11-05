# Feature: decks-qol

Branch `wip/decks-qol` (wave 2 of the enhancement round, from 6736388).
No sim change: `src/game/**` is untouched, so `golden.test.ts` and
`bot.test.ts` are byte-identical and pass; SIM_VERSION and PROTOCOL_VERSION
are unchanged.

For kids: three deck slots (try the new cards without losing the old
deck), a short code to share a deck with a sibling, a full deck that swaps
instead of silently ignoring taps, and badges on the bottom tabs so nobody
misses a reward or an upgrade.

## What changed

### 1. Deck slots (`src/meta/decks.ts`, new)
- Three slots `{ name, cards }` plus the `active` index, stored in
  `cr-clone-deck-slots` (`{ v: 1, active, slots }`). Pure functions,
  storage injected (`DeckSlotStore`), every read/write survives blocked
  storage.
- The old single deck key `cr-clone-deck` stays the live copy of the active
  slot: main.ts still boots from it, and every screen that edits
  `meta.playerDeck` (card info 'Use', chest reveal, Studio) keeps working.
  - `saveProfile` (progress.ts) calls `mirrorActiveDeck`, which writes the
    saved deck into the active slot (only full 8-card decks, only when it
    changed).
  - `loadDeckSlots(kv, liveDeck)` reconciles the other way: the live deck
    wins over a stale copy in the active slot.
- Migration: the first load (or the first save) copies the existing saved
  deck into slot 1, and into slots 2 and 3 as starting points (like a fresh
  Clash Royale account), slot 1 active. No deck is lost.
- `activateSlot` (deckPicker.ts) makes a slot active: clamps it to owned
  cards (`playableDeck`, e.g. a deleted Champion), saves the slots, sets
  `meta.playerDeck` and calls `persistProfile`. The next bot battle and the
  online lobby (`openLobby` passes `meta.playerDeck`) use it.
- Names: `cleanName` trims, drops control characters, collapses spaces and
  caps at 14 characters; an empty name shows the default ("Deck 2" /
  "مجموعة ٢").

### 2. Deck codes (`src/meta/deckCode.ts`, new)
- 12 characters of Crockford base32 shown as `XXXX-XXXX-XXXX` (for
  example `0024-2HGW-H0QV` is the starter deck).
  - 10 data characters = 50 bits: a 2-bit format version, then the 8 cards
    **in deck order** (the first 4 are the opening hand) as 6-bit indices
    into `CODE_CARDS`.
  - 2 check characters: Luhn mod 32 plus an odd-weighted sum mod 32. The
    test proves every single wrong character and every swapped neighbour
    pair is caught; a random typo passes about 1 time in 1000.
- `CODE_CARDS` is an append-only index table (today's deckable DECK order).
  Tests pin two codes and fail if it is reordered, and fail if a deckable
  card is missing from it (so a new card must be appended to be shareable).
  6 bits leave room for 64 cards; the version bits leave room for a new
  layout after that.
- Only shareable cards: `isDeckable` and not in `TOKEN_IDS` (no Pebble
  Golem), never the per-device Studio Champion, no duplicates, exactly 8.
- Reading is forgiving: case, spaces and dashes are ignored; O reads as 0,
  I and L as 1 (the alphabet has none of them, so they can never clash);
  Arabic-Indic and Persian digits typed on an Arabic keyboard read as 0-9;
  NFKC folds full-width characters.
- Errors (`DeckCodeError`) map to kid-readable EN/AR messages in
  `codeErrorText` (deckPicker.ts): empty, a character codes never use
  ("Deck codes never use "U". Check that letter."), wrong length ("A deck
  code has 12 letters and numbers. This one has 11."), typo (check
  characters), newer version, not a real deck (unknown index / duplicate),
  and for sharing: not 8 cards, or the Champion.

### 3. Deck builder (`src/ui/screens/deckPicker.ts`, `styles/decks.css`)
- **Slot switcher**: a 1/2/3 radio group above the deck (arrow keys move,
  mirrored in RTL). Unnamed slots read "Deck" beside their number circle so
  three fit at 360 px in both editions. Switching saves the deck being
  edited first (or says it can't: see below), then loads the slot and makes
  it the battle deck. A **Name** button in the "Your deck" head renames the
  active slot (a sheet with one input; empty = the number).
- **Swap mode**: `editDeck` (pure, tested) is the whole tap logic. With 8
  cards, a tap on a collection card picks it up: it lifts with an accent
  ring, the deck cards wiggle, and a bar says "Now tap a card in your deck
  to swap" with the card's picture and Cancel (a screen-reader live line
  names both cards). The next tap on a deck card swaps the two in place
  (hand order kept) with a small pop; tapping a deck card in the collection
  grid swaps too. Tap the picked card again, Cancel or Esc to drop it.
  `swapScroll` (pure, tested) brings the bar and the deck into view,
  scrolling no further than the whole deck needs and never past the bar;
  if the screen is too short for both, the first deck row wins. The Esc
  listener on `document` is removed on every way out (Back, tabs, Save,
  Battle, Collection, the next editor) through an AbortController.
- **Phone landscape** (`max-height: 520px`): the switcher sits inline in
  the deck head with a pencil-only Name button ("Your deck" stays for
  screen readers), and the deck is one row of eight small tiles (smaller
  elixir drops). At 844x390 the whole deck shows on open, and the swap bar
  and the deck row fit together.
  The hint under "Your cards" says "Your deck is full: tap a card to swap
  it in."
- **Share deck**: a sheet with the 8 cards, the code big in Lilita One
  (`dir=ltr`, isolated, selectable), a hint and **Copy code**
  (`navigator.clipboard`, then `execCommand('copy')`; if both fail the code
  is selected and a toast says to press and hold). The button turns green:
  "Copied!".
- **Enter code**: a sheet with the input (no autocorrect, upper-case,
  `enterkeyhint=done`), **Paste** where the browser can read the clipboard,
  a live message line (`role=status`) and a preview of the 8 cards. Cards
  the player has not found yet show as locked silhouettes with a lock, and
  the message names them ("2 cards are still locked: Digger, Comet. You'll
  pick others for those spots."). Errors wait until the code is 12
  characters long or Enter is pressed (then the input shakes).
  **Use in Deck N** loads it into the current slot: a fully owned deck is
  saved at once ("New deck in Deck 1!"); otherwise the owned cards fill the
  deck and the locked ones stay as greyed, locked "ghosts" named under
  their silhouette, each in the spot it held in the code (`loadCode`,
  `deckSpots`, pure and tested), so the code's hand order survives: new
  cards fill the ghost spots first, in order. The toast names them too
  ("Deck loaded! Digger, Comet are still locked: pick other cards for
  their spots.").
- Leaving (Back, a tab, Collection, another slot) with an unfinished deck
  used to drop the edit silently; now a toast says "Deck 1 was not
  changed: a deck needs 8 cards."
- `collection.ts`: `silhouette()` is exported as `cardSilhouette()` for the
  locked previews.

### 4. Home Cards tab (`src/ui/screens/home.ts`)
- The same slot switcher sits between the "Battle deck" head and the grid;
  a tap makes that slot the battle deck at once ("Deck 2 is ready for
  battle").

### 5. Tab badges (`src/ui/screens/frame.ts`, helpers in `src/meta/progress.ts`)
- Pure helpers: `affordableUpgrades(profile, levels)` (shards and gold for
  the next level), `badgeCounts(sources)` (upgrades, road, pass,
  achievements, today's quests) and `tabBadges(counts)`:
  - **Battle**: claimable Trophy Road nodes + Crown Pass tiers + finished
    daily quests (the road button, pass pill and quest board all live there);
  - **Cards**: upgrades the player can pay for;
  - **Profile**: earned, unclaimed achievements.
- `buildTabBar` gives every tab a red count pill (`9+` above nine, Arabic
  digits in the Golden Age edition) and an aria-label like "Cards: 1
  upgrade ready". Every tab bar (Home and sub-screens) shows them.
- Live updates: `refreshTopBars` (called after quest/achievement claims,
  upgrades, settings) now also recounts, and Home's `drawTab` recounts on
  every redraw (claims, crafting, upgrades from the card sheet). Road and
  pass claims return through `openHome`, which builds a fresh tab bar.

## Verification
- `npx tsc --noEmit`, `npx vitest run` (123 files, 1436 tests), `npm run
  build` pass. New tests: `decks.test.ts` (migration, mirror, reconcile,
  edits, sanitizing, blocked storage), `deckCode.test.ts` (index table,
  pinned codes, 300 random round trips, forgiving input, every error,
  every single typo and neighbour swap), `progress.test.ts` (saveProfile
  mirror, first-boot migration, badge counts), `deckPicker.test.ts`
  (`editDeck` swap rules, ghosts keeping their spots, `swapScroll`, every
  error message in both editions).
- `tools/perf-budget.mjs`: empty 154 / fight 380 draw calls (budgets 220 /
  450); nothing here touches rendering.
- Puppeteer, fresh profiles (scripts in `/tmp/claude-0/enh/decks-qol/`):
  - an old single-deck save migrates into slot 1; slot 2 edited and renamed
    "Hog cycle" persists across a reload and is the deck the next bot
    battle deals (`__cr.battle().player.hand`); switching back to slot 1
    from the Cards tab deals the starter deck; with a local relay, the
    online "create" message carries the active slot's deck;
  - profile A copies its code (clipboard), profile B (another browser
    context, without Digger and Comet) pastes it: Digger and Comet are
    flagged, the other six load, two locked ghosts wait in their own spots
    with their names; after filling (the fillers take the ghosts' spots),
    B's code loads into A as "A real deck!"; short / typo / "U" codes and
    Arabic-Indic digits give the messages above;
  - full deck + collection tap enters swap mode, a deck tap swaps in place,
    Esc cancels; at 844x390 the deck is in view on open (grid 182-226 in a
    120-240 body) and with the swap bar (bar 128-184, deck 192-236);
  - opening and leaving the editor six times by Back, Save, a tab and
    Collection (and the battle editor by Battle) leaves no keydown
    listener on `document` (CDP `getEventListeners`);
  - badges: Cards 1 (affordable Knight upgrade), Battle 2 (two road nodes),
    Profile 1 (first win); each clears after the claim / upgrade; a
    completed quest and a Crown Pass tier also count and clear;
  - no horizontal scroll and no console or page errors at 390x844, 360x740,
    844x390 and 1280x800 in both editions (Cards tab, editor, swap mode,
    share and enter-code sheets).

## Notes for the merge
- Owned files only (see the plan); `home.css` is untouched: the new styles
  are in `styles/decks.css` (prefix `dq-`), imported by frame.ts and
  deckPicker.ts.
- rewards-legendary adds the `legendary` rarity: `upgradeCost` needs its
  row for `affordableUpgrades`, and tiles keep using `rarity-${rarity}`.
- Toasts from slot switching and code loading use `components.toast`, so
  rewards-legendary's toast placement applies to them.
- The Comet still has the placeholder spell art until card-wave-art's
  portrait lands, so its locked silhouette is a plain grey tile for now.
