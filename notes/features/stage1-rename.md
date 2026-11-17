# Stage 1: the game's own name and words (2026-11-17)

Branch `stage1/rename` merged into `claude/game-visuals-character-balance-w122wb`
(base 63fea18). The game is now **Banner Lanes** (درب الرايات, *Darb
ar-Rayat*, "the path of banners"), an original game by **Pebble Kite Games**
(«ألعاب الطائرة الورقية»). Card, arena and feature names that were another
game's coined words now have names of their own, and the battle resource is
**Sparks** (الشرارات).

Only what is shown on screen changed, plus some art. The battle rules, every
id and every saved value are as they were, so no save, deck code or invite
link is lost.

This note names old cards and arenas by their **id**: the ids are still in
the code (see `notes/README.md`), and the note does not repeat another game's
names as text.

## Old to new: Classic (English)

| What | Old (id) | New | Why it changed or was swapped |
|---|---|---|---|
| Game name | old title (save tag `crown-rush`) | **Banner Lanes** | Too close to another mobile game's name. |
| Credit line | "a fan-made tribute" line | **An original game by Pebble Kite Games.** | **Swap**: the pick "Little Lantern Games" is almost the name of a board-game publisher ("Little Lantern" / "Littlest Lantern") with a pending games-and-toys trademark. |
| Resource | elixir | **Sparks**; "Last minute! Double Sparks!"; "1 spark", "4 sparks" | Another game's word. |
| Modes | triple / mega | **Triple Sparks**, **Mega Sparks** | Follows the resource. |
| Card | `pekka` | **Steel Guard** | **Swap**: the pick "Iron Guard" was the name of a 1930s fascist movement. |
| Card | `mini-pekka` | **Little Steel Guard** | Follows its parent card. |
| Card | `hog-rider` | **Boar Rider** | As picked. |
| Card | `mega-knight` | **Thunder Knight** | As picked. |
| Card | `electro-wizard` | **Lightning Wizard** | **Swap**: "Spark Wizard" would read as the card that makes Sparks, next to the Spark Well. "Storm Wizard" is already a unit in another studio's game. It pairs with Ice Wizard. |
| Card | `royal-giant` | **Cannon Giant** | As picked. |
| Card | `skeleton-barrel` | **Bone Barrel** | As picked. |
| Card | `skeleton-army` | **Bone Swarm** | As picked. |
| Card | `minions` | **Imps** | As picked. The old word is also a film franchise. |
| Card | `magic-archer` | **Arrow Mage** | As picked. |
| Card | `elixir-collector` | **Spark Well** | As picked. |
| Card | `executioner` | **Axe Bearer** | Not in the picks. Renamed because it is grim for ages 6 to 12 and matches the Golden Age حامل الفأس. Easy to undo in `CLASSIC_NAME` (`src/render/cardNames.ts`). |
| Arena | `training-camp` | **Practice Meadow** | All eleven Classic arena names were another game's, in its order. Each new name matches the arena's look. |
| Arena | `goblin-stadium` | **Firefly Marsh** | |
| Arena | `bone-pit` | **Fossil Hollow** | |
| Arena | `barbarian-bowl` | **Snowdrift Fort** | |
| Arena | `pekka-playhouse` | **Ember Forge** | |
| Arena | `spell-valley` | **Starlight Glade** | |
| Arena | `builders-workshop` | **Tinker Yard** | |
| Arena | `royal-arena` | **Castle Court** | |
| Arena | `frozen-peak` | **Icicle Ridge** | |
| Arena | `jungle-arena` | **Vine Valley** | |
| Arena | `legendary-peak` | **Lantern Summit** | |
| Progress path | trophy road | **Trophy Trail** ("Trail complete") | Another game's feature name. |
| Side towers | princess tower(s) | **side tower(s)** ("Your side tower fell") | Another game's coined tower name. King tower stays. |
| Tower troop | `duchess` | **Swift Duchess**, "a strong start" | Another game's name; the old blurb said "deadly". |
| Challenges | `hog-rush`, `mega-drop`, `bridge-spam` | **Boar Rush**, **Thunder Drop**, **Bridge Rush** | Follow the cards; "spam" is another game's deck slang. |
| Kinder words | "death bomb"; Hard "Fast and ruthless" | "bursts when it falls"; "Fast and tough" | Too grim for small children. |
| Firecracker blurb | "bursts into sparks" | "a shower of stars" | Would read as the card dropping Sparks. |
| Edition gate (Arabic line for Classic) | فرسان وسحرة | فرسان وتنانين ("knights, dragons") | سحرة ("sorcerers") worries Gulf families. |

## Old to new: Golden Age (Arabic)

| What | Old | New | Why it changed or was swapped |
|---|---|---|---|
| Game name | هجمة التاج | **درب الرايات** | As picked; matches Banner Lanes. |
| Credit line | the fan-tribute line | **لعبة أصلية من «ألعاب الطائرة الورقية»** | Only "Kite" is translated. "بيبل كايت" read as "Bible Kite", and حصاة ("pebble") is already the Pebble Golem's name. |
| Resource | الإكسير | **الشرارات** (شرارة واحدة، شرارتان، ٣ شرارات، ١١ شرارة); "شرارات مضاعفة!" | As picked. Counts agree with the number. |
| Modes | إكسير ثلاثي / هائل | **شرارات ثلاثية / هائلة** | Follows the resource. |
| `skeletons` | ميليشيا | **المشاة** | **Swap**: the pick الكشّافة first means the Scouts, which children join, so small spearmen read as children sent to fight. ميليشيا ("militia") is a loaded political word. |
| `skeleton-army` | حشد الميليشيا | **حشد المشاة** | Follows المشاة. |
| `skeleton-barrel` | برميل الميليشيا | **برميل المشاة** | Follows المشاة. The card art now shows a smiling foot soldier, not a skull. |
| `executioner` | الجلّاد | **حامل الفأس** | As picked. |
| `princess` | خولة | **صاحبة القوس** | **Swap**: خولة is a Companion's name, which the rebrand rules keep off combat units. The pick الرامية clashes with رماة and رامٍ بارع. |
| `tombstone` | رباط | **المعسكر** (a camp tent, not a grave) | **Swap**: رباط is a religious frontier word. The pick برج الحراسة reads as a fourth tower to protect; مخفر means police station in Kuwait. |
| `rage` | طبول الحرب | **حماسة** | As picked. The battle music keeps the title طبول الحرب (only in code comments). |
| `royal-giant` | مدفعي | **عملاق المدفع** | Not in the picks: it was the same word as the tower troop المدفعي. |
| Spell kind | تعويذة | **حيلة** | تعويذة means a charm or amulet, tied to sorcery in Gulf teaching. حيلة is the word of the Banu Musa "Book of Ingenious Devices". |
| Arena floor | a crescent inlaid in the floor | **a ten-fold geometric rosette** | As picked (rosette, not palm). Troops walked on a religious symbol. The palm is the centre of the Saudi emblem. Not 5, 6, 8 or 9 points. Dome finials and tower banners keep their crescents. |
| Progress path | طريق الكؤوس | **سلّم الكؤوس** | **Swap** from مسار الكؤوس: مسار already means "lane". |
| Side towers | برج أميرة / أبراج أميرات | **البرج الجانبي / الأبراج الجانبية** | Another game's coined name. |
| Tower troop | دوقة الخناجر | **الدوقة السريعة**, "بداية قوية" | Another game's name; the old blurb said "قاتل". |
| Challenge | عاصفة الميليشيا | **عاصفة المشاة** | Follows المشاة. |
| Kinder words | قنبلة موت; سريع ولا يرحم | **انفجار عند السقوط; سريع وقوي** | Too grim for small children. The first was suggested as انفجار الوداع, which sounds funereal. |
| HUD ornament | the Rub el Hizb sign (U+06DE) | ✦ ❖ ✦ | A Quranic section mark used as decoration. |
| Sparks bar tag | x2 / x3 | ×٢ / ×٣ | The edition's own digits. |

Unchanged on purpose: the Golden arena names, خان القوافل (Spark Well),
نفّاط البرق (Lightning Wizard), أمير المماليك, تذكرة التاج (its text says
crowns fill it), King tower / برج الملك, the tower troops الأميرة and
المدفعي, and the tagline "أبراج الهلال" (the domes keep their crescents).

Also unchanged in Classic, as plain words: Knight, Archers, Giant, Wizard,
Witch, Valkyrie, Prince, Princess, Tombstone, Cannon, Skeletons, Baby Dragon,
Ice Wizard, the spells, Crown Pass, crowns, chests, rarities, Champion,
Cannoneer.

Other art kids will notice: a gold banner over two lanes on navy-teal is the
app icon (it was a crescent and star) and hangs on the start screen; the
Sparks icon is a four-ray spark; the Spark Well shows a spark crystal; the
Classic Steel Guards wear a brass crest, not curved horns; the Classic Axe
Bearer wears a bandana, not a hood; the Golden المشاة fall in a sand puff,
not bones; the Golden Valkyrie carries a sword, and her headscarf has no cord
ring. The kids' guide folder is now `Kids-Presentation/`, with new pictures
and rebuilt slide decks.

## What stayed the same

- **Battle rules.** `git diff 63fea18 -- src/game` is empty. `SIM_VERSION`
  and `PROTOCOL_VERSION` are both 3. The sim keeps its own card names; the
  screen gets the new ones from `src/render/cardNames.ts`,
  `src/render/challengeText.ts`, `src/render/towerTroopText.ts` and the
  tutorial overlay.
- **Ids.** Card, arena, challenge, mode, tower troop and ability ids. The
  deck-code card list.
- **Saves.** Every `cr-clone-*` storage key. The save code still starts `CR1`
  and still carries the game tag `crown-rush`, so every old code and backup
  file loads. Only the download name changed, to
  `banner-lanes-save-<date>.txt`; old files still load because the game reads
  what is inside.
- **The offline app.** Cache names `cr-clone-<build>` and the
  `cr-app-shell` marker. No manifest `id` was added, so phones see the same
  app.
- **Editions.** `data-edition` values and the edition switch.
- **Addresses.** The repository name, the Render service and its address,
  the fly app, the GitHub Pages path (`VITE_BASE`), the relay URL and the
  `package.json` name.

## How it was checked

- **Gates after the merge**, on a clean `npm ci`: typecheck clean; tests 186
  files, 2,741 tests, all passing (179 / 2,691 before the rename);
  `npm run build:all` passes; `npm audit` finds 0; `src/game` unchanged.
- **Guards.** `src/app/oldNames.test.ts` fails if a retired name comes back
  in a shown string (Arabic matched without harakat or hamza), or if screen
  code reads the sim's own names and skips the display layer.
  `src/meta/renameCompat.test.ts` decodes save codes and a save file made by
  the 63fea18 build and checks that all 57 old storage keys are still
  registered. Other new tests cover the name maps, Sparks counts in both
  languages, the rosette, the camp tent and the Arabic loss tips.
- **Production smoke after the merge** (`node dist-server/relay.mjs`, both
  editions, Chromium), all checks passing:
  - A first visit picks an edition and loads with the new title (Banner
    Lanes / درب الرايات).
  - A save code made by the 63fea18 build's own Settings screen (with
    `pekka`, `hog-rider`, `mini-pekka`, `elixir-collector`, `skeleton-army`,
    `minions`, `electro-wizard` and `magic-archer` in its deck) loads through
    Settings, Load a save: gold, trophies, deck and edition all kept.
  - The Cards screen shows the new names for that deck in each edition.
  - Settings, Credits shows the studio.
  - A bot battle shows the Sparks bar ("Sparks" / "الشرارات"). The hand
    reads "Steel Guard, 7 sparks" / "مدرّع، ٧ شرارات".
  - The results screen counts sparks.
  - A friend match by invite link (`?join=CODE`, two pages) starts in both
    editions.
  - No retired name in the visible text, labels, titles or alt text of 13
    screens per edition. No page errors or console errors.
- **Before the merge, on the branch:**
  - An installed copy of the 63fea18 build upgraded to the renamed build:
    old cache swept, progress kept, the new build opens offline.
  - "Double Sparks!" appeared at 1:00 in both editions.
  - `perf:budget` passed all 4 runs.
  - A review round found and fixed: old names in `notes/`, the guard gaps,
    the Golden barrel skull, the Arabic loss-tip grammar, the "Bible"
    reading of the studio name, سحرة in the Arabic kids' guide, the HUD
    ornament, the Latin x2 tag, and a time unit wrapping onto its own line.

## For an Arabic reader to check

1. Say «درب الرايات» aloud: does it sound like a children's game and bring
   nothing else to mind?
2. Does «لعبة أصلية من «ألعاب الطائرة الورقية»» read naturally as a studio
   credit?
3. Costs on the hand, card sheet and deck screen: شرارة واحدة، شرارتان،
   ٣ شرارات، ١٠ شرارات، ١١ شرارة. Do they read right?
4. In the game font at small size, does حماسة always show its final ة and
   never look like حماس?
5. Does صاحبة القوس suit the crowned archer girl, with no "girlfriend"
   reading for a Gulf child?
6. Do you prefer المشاة to الكشّافة for the small spearmen? Does it read as
   soldiers, not pedestrians?
7. Is المعسكر natural for the building that keeps sending out المشاة?
8. As the card-type word for spells, is حيلة acceptable in place of
   تعويذة?
9. Do سلّم الكؤوس، البرج الجانبي، الدوقة السريعة، عملاق المدفع and
   انفجار عند السقوط read naturally?
10. In a Golden Age battle, does the floor rosette look like plain decoration
    and not a religious or national mark? (Also the HUD ornament ✦ ❖ ✦.)
11. Is the Tombstone (المعسكر) no longer a grave? Does the Valkyrie wear a
    woman's headscarf and carry a sword?
12. Is the Golden Princess's uncovered front hair, with the veil at the back,
    acceptable for your family? (Unchanged in this stage.)
13. The Golden Executioner (حامل الفأس) still wears a ghutra and agal with a
    big axe. Is that comfortable, or should he wear a turban or cap?

## What the owner still has to do

- **Domains.** `bannerlanes.com`, `bannerlanes.games`, `bannerlanes.app` and
  `pebblekitegames.com` found nothing in web searches, so they look free, but
  registry lookups were blocked here. Check with a registrar, then buy the
  ones you want.
- **Email.** Once a domain is yours, create the address you want on it (for
  example a contact address for parents).
- **Repository and Render service names.** Both still carry the old working
  name. Renaming either one changes an address:
  - A new repository name moves the GitHub Pages path (`VITE_BASE`, the
    Pages build in `.github/workflows/deploy.yml`). Check GitHub's own help
    first: as far as we know it does not forward an old Pages path, so links
    and home-screen installs on the old path would stop working.
  - A new Render service name (`render.yaml`) gives a new web address. The
    relay address the Pages build uses must follow (`deploy.yml`, or the
    `RELAY_URL` repository variable). A browser keeps saves per address, so
    kids on the old Render address would move their progress with a save
    code (Settings, Backup & move).
  - Keeping the names costs nothing: players never see them.
- **Not legal clearance.** All name checks were web searches. A trademark
  lawyer or a registry search is the real check, especially for Banner Lanes
  and Pebble Kite Games.
- **Classic arena names** had only quick web searches.
- **Axe Bearer** was renamed on our judgement (not a pick). Keep it or undo
  it.
- **Still looks like the other game:** the magenta and purple Sparks bar
  colours, and the Classic Tombstone, which is still a grave. The
  developer-only rig view and the 2D fallback art still draw the old horned
  helm and hood. Code comments in `src/game` and git history keep the old
  names; history was not rewritten.
- **Existing home-screen installs** on iPhone and iPad keep the old label
  and icon until reinstalled. Android updates them by itself, slowly.
- `notes/features/save-backup.md` still gives the old download file name.
