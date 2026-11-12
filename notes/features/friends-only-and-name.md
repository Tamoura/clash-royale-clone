# Friends only, the Crown Rush name, and Golden Age language fixes

Round 1 of `notes/features/enhancement-plan-2026-11.md` ("Fair, kind and never
stuck"), package "online": the C38 slice (no strangers, guess-proof codes),
C19 (the name) and C21 (Arabic fixes). Built on `r1/online` from 2054fdb.
Owner decisions this follows: no strangers online, ever; the name is Crown Rush.

## What a kid and a parent see

- **Play online is "Play a friend".** One screen: the mode, *Create a game*,
  a code box with *Join*, and the line "Online games are only with friends
  who have your code. Share it with people you know." There is no Quick match
  tab, no "Find a match", no queue and no "play the bot instead" offer (that
  was quick-only). Battle setup's "Play online" row says "Play a friend with a
  code".
- **Codes are a word and three digits** (`BEAR088`, 20,000 codes; they were
  `LION42`, 2,000). Typing `bear-088` or `Bear 088` still works.
- **Ten wrong codes in ten minutes** pause joins from that home for ten
  minutes. The eleventh try says "Too many wrong codes. Wait a little while,
  then check the code with your friend." (Arabic: "رموز خاطئة كثيرة. انتظر
  قليلًا، ثم تأكّد من الرمز مع صديقك.") "A little while" is true for both
  limits a join can meet: the wrong-code pause (ten minutes) and the old
  pairing limit (5 tries in 10 s, seconds). A page cached from before this
  update still shows its old line, "Too many tries. Wait a few seconds.",
  for the new ten-minute pause: rare, and it goes once the page updates.
- **The name is Crown Rush** on the tab, the loading splash, the home-screen
  label and the installed app. In the Golden Age edition the tab and splash say
  **هجمة التاج** ("the crown's charge").
- **Golden Age words and digits:** "win" is فُز (it was افز, not a word) in
  every achievement and quest; the Profile shows "الموسم: نوفمبر ٢٠٢٦" (it was
  the raw key 2026-11); card tooltips and the card sheet, the tower HP plates
  and a dozen labels and banners use Arabic-Indic digits; English-only screen
  reader labels are translated.

## How it works

### The relay (server/relay.ts, server/joinGuard.ts)

- `QUICK_MATCH` is off unless it is exactly `on` (developers testing the
  queue). render.yaml also pins it `"off"`. A page that still asks gets the
  existing `quick-disabled` reply, which now reads "Online games are with
  friends only…".
- `JoinGuard` counts joins answered `no-such-room`, per address and per
  connection. An IPv4 address counts alone; an IPv6 address counts by its /64,
  because one home or phone is handed a whole /64 and could otherwise rotate
  addresses. An IPv6 address also counts toward its /56 (a home's usual
  allocation, 256 /64s; limit 30) and its /48 (a site, or a free tunnel-broker
  allocation; limit 60), so rotating /64s does not multiply the guesses (added
  after review). At 10 misses inside 10 minutes the key is blocked for 10 minutes:
  every join from it gets `rate-limited`, the right code included, so a
  blocked guesser learns nothing. Successful joins never reset the count (a
  guesser could otherwise reset it by joining their own room). The miss
  counts are capped at 50,000 keys and swept with the rooms every 5 s. `room-full` and
  `resume-failed` don't count: a full room can't be joined, and resumes need a
  128-bit token.
- What it buys: at most 10 guesses per 10 minutes per address, the life of a
  waiting room, so one address finds a given waiting room with a chance of
  about 1 in 2,000; an IPv6 home rotating its /64s gets at most 30 (1 in
  about 670), a /48 at most 60. Before: about 65 minutes to sweep all 2,000
  codes from one address. It does not stop someone with many separate
  networks: a code is a hard-to-guess key, not a password.
- No relay-wide miss budget, on purpose: one guesser could then pause every
  family's joins for ten minutes.
- No protocol or sim change: `rate-limited` already existed and every page
  shows it. `PROTOCOL_VERSION` and `SIM_VERSION` are unchanged.

### Old pages and new codes

`normalizeCode`, `cleanCode` (`^[A-Z0-9]{3,12}$`), the relay's `CODE_PATTERN`
and the 12-character code box already took any number of digits.
`src/ui/lobbyCode.test.ts` freezes a copy of the 2054fdb rules (what a cached
page runs) and proves new codes pass through them unchanged, and that old
two-digit codes still join.

### The client (src/ui/screens/lobby.ts)

The tabs, the quick panel and the bot offer are gone; `LobbyOpts.quick` is
gone from `src/app/ctx.ts`. The old stored tab (`cr-clone-lobby-tab`) is
never read and is removed when the lobby opens. `src/net` still speaks the
`quick` message (`OnlineSession.quick`, `RoomClient.quick`) because the relay's
developer-only queue and its tests use it; `src/ui/friendsOnly.test.ts` scans
everything outside `src/net` and fails if anything calls `.quick(` or any
screen offers "Quick match" / "Find a match" in either language.

### The name (index.html, manifest, src/app/brand.ts, public/sw.js)

- `index.html`: `<title>`, `apple-mobile-web-app-title` and the boot title
  say Crown Rush; so do the manifest's `name` and `short_name`.
- `src/app/brand.ts` holds `GAME_NAME` / `GAME_NAME_AR` and, at boot,
  `localizeStaticMarkup` sets the tab title, the splash title and the static
  emote bar's aria-label in the edition's language. `<html>` keeps `lang`
  from theme.ts and gets no `dir`, so the battle HUD stays left to right.
- The service worker kept a page as the offline shell only if it held
  `<title>Clash Royale Clone</title>`, so the rename would have quietly
  stopped offline play. It now looks for `<meta name="cr-app-shell"
  content="game" />`, which is not the title. sw.test checks the real
  index.html carries it once, that a renamed page with it is kept and that a
  page with the game's name but no marker is not. Devices with the old worker
  are fine: the new worker installs on the next visit (its install caches "./"
  without the marker check), activates and drops the old cache.
- Internal ids stay: `cr-clone-*` storage keys and cache names,
  `data-edition`, the repo, the Render service and its address. No save or
  link is lost. README title and the two stylesheet headers say Crown Rush.

### Golden Age language (C21)

- افز → فُز in `src/meta/achievements.ts` (lines 34-36 and 42-43, the
  definitions only) and `src/meta/quests.ts` (20-21). No other افز exists.
- Digits: `render/cardinfo.ts` formats every number in the Arabic lines
  (English lines keep plain digits); HP plates use `formatInt` (new in
  `src/ui/i18n.ts`, Arabic-Indic and no grouping: ٢٥٣٤) through
  `hpPlateLabel`, and so does the level shield capping the bar
  (`levelBadgeLabel`: ٩; added after review, it was a Latin 9); the floating
  damage numbers' glyph atlas paints its digit cells as ٠-٩ (`glyphFace` in
  `render3d/scene/fx/glyphs.ts`; popup text stays "160" inside, so merging
  is unchanged; added after review). The shield and the atlas are painted
  once, so both repaint when the Arabic face (Baloo Bhaijaan 2, which
  supplies the digits; Lilita One has none) has loaded. Profile uses the
  season's name (`seasonLine` → `seasonName`, as the Crown Pass does); raw costs, prices,
  rewards and shard counts in Arabic labels and banners (card info,
  collection, deck picker, draft, frame, home, studio, rewards, the Champion
  Bot banner) go through `fmtNum`.
- aria-labels: Home's and the deck picker's battle button, Save deck, the
  sandbox reset, and the default Back of every screen header go through `tr()`.
- `src/ui/i18nLint.test.ts` (about 2 s) uses the TypeScript checker: it fails
  on an English-only aria-label in `src/ui` or `src/main.ts` (setAttribute,
  `ariaLabel:` options and `aria-label="…"` in markup; strings inside calls
  such as `tr()` and comparison operands don't count), on a number-typed
  expression in the Arabic half of any `tr()` call in `src`, and on Latin
  digits typed into an Arabic string. A self-check feeds it one of each
  mistake. Allowlist: the emote toggle's "Emotes" and the old season-reset
  banner's two numbers, both rewritten by the "kind" package (below).

## Merging with the other round-1 packages

- **kind** rewrites `src/main.ts`'s season-reset banner (a season-start toast
  that names the season, no counts) and the emote toggle's label
  (`tr("Emotes", "التعابير")`). I left both untouched to avoid conflicts; the
  lint allowlists them by expression text, so the entries simply go unused
  after the merge. My static emote-bar label uses the same word, التعابير.
  (Round 1 integration, r1/ship: once kind's rewrite landed, the three
  entries were removed and both allowlists are now empty; the lint passes.)
  kind also edits `src/meta/achievements.ts` (header and season-reset code);
  my edits there are the five definition lines only.
- `src/main.ts` changes here are small and away from kind's hunks: the brand
  import and call next to `applyEditionTokens`, the sandbox reset aria-label,
  and fmtNum in the Champion Bot banner.

## Verification (production build on the relay, phone 390x844 unless noted)

Scripts: `/tmp/claude-0/r1/online/friend.cjs`, `golden.cjs`, `plates.cjs`;
screenshots in `/tmp/claude-0/r1/online/shots/`.

- Classic and Golden Age: host creates a room (BEAR088, CRAB404), the guest
  types it as `bear-088`, the box shows BEAR088, both battles start
  (`classic-1..5`, `golden-1..5`). No Quick match text anywhere on the lobby;
  a stored `cr-clone-lobby-tab=quick` is cleared.
- 11 wrong codes in a row from the guest: 1-10 "No game with that code", the
  11th the new message, both editions (`classic-7-wrong-11.png`,
  `golden-7-wrong-11.png`). The relay logs `join-blocked` then `join-limited`.
- Titles: Classic tab "Crown Rush", Golden Age "هجمة التاج" (boot title too),
  manifest name and short_name "Crown Rush", `<html lang=ar>` with no `dir`.
- Golden Age digits: Profile season "الموسم: نوفمبر ٢٠٢٦" and فُز
  achievements (`ga-profile.png`), card sheet (`ga-cardinfo.png`), the desktop
  hover tooltip "١٬٤٠٠ صحة · ١٦٠ ضرر" (`ga-battle-tooltip.png`, 1440x900), HP
  plates ٢٥٣٤ / ٤٠٠٨ (`ga-plates-top.png`, `ga-plates-bottom.png`, dsf 3).
- Tests: `server/joinGuard.test.ts`, `server/relay.test.ts` (bundles the
  relay and runs it on a free port: Quick match refused by default, 3-digit
  codes, typos then the right code start a match, the 11th try after 10 wrong
  codes is rate-limited while another home still joins, rotating /64s inside
  one /56 stops at 30; it fails if the guard is unwired),
  `src/ui/friendsOnly.test.ts`, `src/ui/lobbyCode.test.ts`,
  `src/app/brand.test.ts`, `src/app/sw.test.ts`, `src/render/cardinfo.test.ts`,
  `src/ui/i18nLint.test.ts`, `src/render3d/goldenDigits.test.ts` (formatInt,
  the HP plate and level shield painters, the damage-number atlas and the
  profile season line: no Latin digits in Golden Age, Latin in Classic).

### After review (scripts and shots in `/tmp/claude-0/r1/online-fix/`)

- Dev server, bot battle with troops sent at the enemy towers, dsf 2: Golden
  Age damage numbers ١٨٠ / ٢٣٠, level shields ٩ next to plates ٤٠٠٨ / ٢١١٤
  (`shots/ga-dmg-top-0.png`, `-top-2.png`); Classic unchanged, 180 / 100,
  shields 9, plates 4008 / 1194 (`shots/cl-dmg-top-1.png`).
- Production build on the relay: a friend match in each edition (DEER310,
  LION379; both battles start), then 10 wrong codes and the 11th answered
  with the new line, "Too many wrong codes. Wait a little while, then check
  the code with your friend." / "رموز خاطئة كثيرة. انتظر قليلًا، ثم تأكّد من
  الرمز مع صديقك." (`shots/cl-friend-7-wrong-11.png`,
  `shots/ga-friend-7-wrong-11.png`). Golden Age profile still reads
  "الموسم: نوفمبر ٢٠٢٦" (`shots/ga-prod-profile.png`), and the production
  plates show ٩ shields (`shots/ga-prod-plates-top.png`, `-bottom.png`).
  No page errors.

## Known gaps

- **One address per home.** The limit counts per address, so on Render it
  depends on `True-Client-IP` (as the existing limits do). If that header ever
  went missing, every player would share one address and ten typos anywhere
  would pause every join for ten minutes. The deploy guide's "check the
  per-player limits" step covers it. Siblings at home share one count.
- **Many networks can still guess,** about 1 in 2,000 per address (1 in 670
  per IPv6 /56) per waiting room. Fine at family scale; a confirm step for
  the host would close it fully (not built).
- **Installed icons** may keep the "CR Clone" label until re-added to the
  home screen. The boot splash is "Crown Rush" in Latin letters until the
  game's script runs, then Arabic in the Golden Age edition.
- **Arabic wording** (هجمة التاج, the wrong-codes and friends-only lines, the
  new labels) should be checked by a native reader, as the plan asks.
- Not tested on a real phone or on Render itself; everything above ran on
  the local production build.
- C38's later parts (grown-ups corner, emote mute, break reminder) are round 3.
