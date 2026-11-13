# Save backup and move to another device (C42)

Round 2 package `save`, item C42 in `notes/features/enhancement-plan-2026-11.md`
("Opens every time, keeps every trophy"). No sim change: `src/game` is
untouched, golden and bot tests unchanged, SIM_VERSION and PROTOCOL_VERSION
stay 3. Nothing is sent off the device: a save code leaves the tablet only
when someone copies it or saves the file.

## Why

All progress is about 45 `cr-clone-*` localStorage keys in one browser on
one web address. Clearing site data, Safari's 7-day eviction for sites not
on the Home Screen, a new tablet, or opening the other live address (Render
and GitHub Pages are different origins) all showed an empty profile. This
must ship before the icon moves to Pages or the Render service is renamed
(decision 7), because a new address starts with an empty save.

## What a kid (or grown-up) sees

Settings has a new group between Edition and Help:

**Backup & move / النسخ الاحتياطي والنقل** — "Keep your trophies and cards
safe, or move them to another tablet." / "احفظ كؤوسك وبطاقاتك في أمان، أو
انقلها إلى جهاز لوحي آخر."

| Row | What it does |
| --- | --- |
| Copy my save code / انسخ رمز الحفظ | Closes Settings, opens "Your save code": the code in a read-only box (left to right in both editions), **Copy** (clipboard; if refused, the box is selected for a copy by hand) and **Save to a file** (the same code). |
| Save to a file / احفظ في ملف | Downloads `crown-rush-save-<yyyy-mm-dd>.txt` holding the code (one line). Toast: "Saved as …". |
| Load a save / حمّل حفظًا | Closes Settings, opens "Load a save": a box to paste into, **Load this code**, **Pick a file** (`.txt`). A bad code gets one friendly line under the box (below). |
| Undo the last load / تراجع عن آخر تحميل | Only while a pre-load backup exists. Asks first, the same way as a load. |

A good code opens the confirm sheet **"Load this save?" / "تحميل هذا
الحفظ؟"**: "This save will take the place of the progress on this tablet. We
keep a copy, so you can undo it." and a table, **This save** (highlighted)
next to **This tablet now**: name (when either has one), trophies, arena,
cards, gold, gems, and the edition when it would change. Numbers go through
`fmtNum` (Arabic-Indic digits in Golden Age). If the save has fewer trophies:
"This save has fewer trophies than this tablet." **Keep my progress / أبقِ
تقدّمي** is first, the big yellow button and takes the focus
(`confirmLook({ emphasis: "cancel" })`); **Load the save / حمّل الحفظ** is
second. Esc, a scrim tap or a swipe keep. Keep says "Nothing changed."

Load backs up this tablet, writes the save, covers the reload with the
splash and reloads; Home then says "Save loaded! Welcome back." /
"تم تحميل الحفظ! أهلًا بعودتك." (Undo: "Everything is back to how it was
before the load.").

Load errors (kid wording, both languages in `saveSheet.ts saveErrorText`):
empty, too long, not a Crown Rush code, a deck code ("That's a deck code, not
a save code."), a typo ("Part of this code is wrong or missing. Copy the
whole code again and paste it."), a newer game ("This save is from a newer
Crown Rush. Update the game, then try again."), another game, broken, a
browser too old to unpack it, a save with nothing in it, no room to save.

After the kid's first real win (not a replay, not Sandbox) the game asks
`navigator.storage.persist()` once. On an iPhone or iPad in a browser tab
(not opened from the Home Screen) the next Home shows, once: "Add Crown Rush
to your Home Screen so your progress stays safe." / "أضف هجمة التاج إلى
الشاشة الرئيسية ليبقى تقدّمك في أمان." (8 s toast).

## Where things live

| Piece | File |
| --- | --- |
| Key registry: every `cr-clone-*` key, progress or device, value shape | `src/meta/saveKeys.ts` |
| Registry scan test (unregistered or stale key fails, naming it) | `src/meta/saveKeys.test.ts` |
| Save code: gather, encode/decode, check, load, backup, undo, summary | `src/meta/saveCode.ts` (+ test) |
| Persist-once and Home Screen tip logic | `src/meta/keepSafe.ts` (+ test) |
| Hook wiring: first win, tip on Home, "loaded" toast | `src/ui/keepSafeWire.ts` (+ test), one import in `src/main.ts` next to `./audio/wire` |
| Settings group, code/load/confirm sheets | `src/ui/screens/saveSheet.ts` (+ fake-DOM test), `src/ui/styles/save.css`, two lines in `settings.ts` |
| Docs | `docs/deploy-multiplayer.md` ("Two addresses, two saves" + a troubleshooting entry), `README.md` |

## The key registry

`SAVE_KEYS` lists each key with `cls` ("progress" goes in a save; "device"
stays), `shape` ("json" must parse, "number" is a plain number, "text" any
short string), optional `values` (allowed values), `keepIfAbsent`, `session`
and `prefix` (for keys built from a template; none today). The test parses
every non-test `.ts` file under `src` with the TypeScript parser (comments do
not count), finds `'cr-clone-…'` literals, template starts and
`"cr-clone-x-" + id` joins, and fails on one the registry does not cover, and
on a registered key nothing uses (the four pre-registered round-2 keys are
exempt until they land).

Decisions:
- **Progress** (travels): trophies, gold, gems, levels, owned, shards, chests,
  deck, `cr-clone-meta-v1` (the migration flag: without it the next boot would
  reset gold and cards), deck slots, pass, tower flair, emotes unlocked, road,
  quests, achievements, season, chests earned, free chest timer, legendary
  pity, reward inbox, draft run, challenges done, daily done, streak, friendly
  wins, losses, seen unlocks, champion, tutorial/tutored/tutorial-paid, chest
  tapped, new-cards seen, difficulty and auto history, mode, ability, tower
  troop, and **the edition** (`cr-clone-arena-theme`, values `normal` /
  `arabic`): a kid on a new tablet keeps the edition they know. A save
  without an edition leaves this tablet's alone.
- **Device** (stays): `cr-clone-settings` (volumes, graphics, motion, team
  colours, text size suit a tablet, not a kid), relay, replay tape,
  left-match marker, old lobby tab, coach rotation, splash hold and pulse
  chest (session), and this change's `cr-clone-save-backup`,
  `cr-clone-persist-asked`, `cr-clone-home-tip-seen`, `cr-clone-save-loaded`
  (session), plus the pre-registered round-2 keys `cr-clone-problem-log`,
  `cr-clone-gfx-memory`, `cr-clone-gfx-note-seen`,
  `cr-clone-offline-ready-seen`.
- **Name and crest** live inside the settings blob. The save carries them on
  their own (`"w": {"n","c"}`); loading patches only those two fields of the
  settings blob (through `sanitizePrefs`), every other setting stays.

## The code

`CR` + format digit (`1`) + packing letter + base64url body + 1 check char.

- Inside: `{"g":"crown-rush","v":1,"t":<ms>,"k":{key: value},"w":{"n","c"}}`.
- Packing `Z`: `CompressionStream("deflate-raw")`; `P`: plain bytes, used when
  the browser cannot make deflate-raw (older Chrome, Safari and Firefox
  releases). A `Z` code on a browser with no `DecompressionStream("deflate-raw")`
  gets "This browser is too old to open this code" (no JS inflate fallback).
- Check: Luhn mod 64 over the whole code; catches every single wrong
  character (tested exhaustively on a sample) and a dropped character.
- Reading strips spaces, line breaks and zero-width characters, then: size cap
  (200,000 characters; 2x that before stripping), deck-code shape, alphabet
  and `CR`, check character, version (a newer digit or a letter = "newer"),
  packing, base64url, unpack with a 1,000,000-byte cap, strict UTF-8, JSON,
  game name, format version, then key by key: registered progress keys only,
  string values of at most 100,000 characters in the key's shape. Anything
  else is dropped (and listed in `dropped`). A save with nothing left is
  refused.
- A real profile after one battle is about 880-900 characters.

## Loading

`applySave(store, data)`:
1. Write this device's progress (and name/crest) to `cr-clone-save-backup`
   (JSON). If that fails (storage full), stop: nothing changed.
2. Remove progress keys the save does not have (except `keepIfAbsent`), set
   the save's keys, patch name/crest.
3. If a write throws half way, write the backup back.

Then the page reloads (`holdSplashForReload`), so `loadProfile`'s sanitisers
and migrations, the season roll and every module's own loader read the new
progress exactly as on a normal boot. `undoLastLoad` writes the backup the
same way and deletes it. The confirm table is read through the game's own
`loadProfile` on an in-memory copy, so it shows what the game will show.

## Checked

Unit: `saveKeys.test.ts` (7), `saveCode.test.ts` (25: round trip packed and
plain, typo and dropped character, wrong game, newer format in header and
JSON, garbage, deck code, size caps, unpack bomb, key/value filtering, load
keeps device keys, backup and exact undo, edition kept when absent, storage
full before and half way, summary), `keepSafe.test.ts` (6),
`keepSafeWire.test.ts` (3), `saveSheet.test.ts` (8, fake DOM).

Browser, production build (`dist-server/relay.mjs`, port 3413), phone
390x844 with real touch, plus desktop 1440x900, both directions:
- A: seeded trophies (640) and name, then a real ladder battle (two cards
  deployed by touch, Forfeit, settled by the game's finish path: trophies 620,
  gold +15, quests, achievements, season, streak, losses written by the game).
  In the `-extra` run A also had 14 cards, 2,480 gold and 35 gems (re-written
  by the game's own `saveProfile` after the battle). Copy put the exact code
  on the clipboard; the file `crown-rush-save-2026-11-13.txt` held it.
- B (fresh context, other edition, its own 120 trophies, settings, relay
  override and replay tape): a typo'd code got the friendly line; the real
  code via paste showed the confirm table (Keep my progress focused, CTA);
  after Load, Home and Profile showed A's trophies, arena, cards and gold
  (and edition, name, crest); every progress key equalled A's; relay and
  replay untouched; volume, music, graphics and text size unchanged (name and
  crest moved, by design). Undo put every key back (the settings blob comes
  back with the same values written out in full).
- C (fresh desktop context): the downloaded file via Pick a file, then the
  same result.
- Dev server (needs `window.__cr` to end a battle as a win): with an iPhone
  user agent, the first win called `navigator.storage.persist()` once and set
  `cr-clone-persist-asked`; the next Home showed the tip (both editions); a
  second win asked nothing and showed nothing.

Screenshots: `/tmp/claude-0/r2/save/shots/` (`normal-to-arabic-extra-*`,
`arabic-to-normal-*`, `loaded-toast-arabic.png`, `keepsafe-*`, `look-*`).

## Known limits

- **Other tabs.** A second tab of the game left open keeps its old profile
  in memory; if it then finishes a match it writes that profile back over
  the loaded one. The load does not tell other tabs. Rare on a kid's tablet;
  a BroadcastChannel "reload" would close it.
- **Old browsers.** A packed code cannot be opened by a browser without
  `DecompressionStream("deflate-raw")` (old Safari/Chrome); the kid is told
  to update the browser. Codes made on such a browser are plain and open
  anywhere.
- **No QR code.** The plan mentioned one as optional; not built.
- **Not typeable.** A real code is about 900 characters: it is for copy and
  paste or the file, not for reading aloud. The check character still
  catches a slip when someone edits it.
- **The persist call** is only exercised in the dev server (a production win
  through real play takes minutes on the software renderer); Chrome decides
  quietly, Firefox may ask once, Safari mostly declines outside the Home
  Screen (hence the tip).
- **The left-match marker** (`cr-clone-left-match`, device) is not touched by
  a load. It only exists between a reload mid-match and the next boot, which
  settles it, so it is not there when Settings is open.
- `docs.test.ts` now allows the deploy guide 520 lines (was 500) for the new
  section.
