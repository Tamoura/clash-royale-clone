# Clash Royale character design reference

Official card art for all 25 deck cards, pulled from the Clash Royale
Fandom wiki as **visual reference only** (to guide our original
low-poly 3D models — no Supercell assets ship in the build). Images
live next to this file in `cards/<slug>.png`.

Per-card breakdown below: silhouette/proportions, palette, signature
features, and the cues that matter for our Three.js character models.

> Art-direction throughline across the whole roster: chunky toy-like
> proportions (big heads, stubby limbs), thick dark cel outlines,
> saturated primary palettes, glossy "vinyl figure" shading, and one
> bold readable silhouette per unit. Blue tints read as the player
> side, red/dark as the enemy.

---

## Troops

### Knight (`cards/knight.png`)
- **Silhouette:** broad, stocky man-at-arms; big round head, thick neck.
- **Palette:** steel-grey chainmail coif, blonde handlebar moustache,
  ruddy skin, dark navy under-armor.
- **Signature:** chainmail hood framing the face, huge blonde moustache,
  heavy-lidded confident squint. Friendly, not menacing.
- **3D cues:** rounded helmet/coif as one shell; the moustache is the
  hero feature — exaggerate it. Holds a broadsword (off-frame in card).

### Archers (`cards/archers.png`)
- **Silhouette:** slim young woman, longbow drawn; deployed as a pair.
- **Palette:** hot-pink hair (blunt fringe + side braid), green tunic,
  fair skin, brown leather bracers, wooden bow with green string.
- **Signature:** the magenta bob with straight-cut bangs; bright blue
  eyes; bow held at full draw.
- **3D cues:** pink hair block is the read; green sleeveless tunic;
  always model two of them, slightly varied poses.

### Firecracker (`cards/firecracker.png`)
- **Silhouette:** lithe woman shouldering an oversized firework launcher.
- **Palette:** magenta-pink hair, blue headband, dark fingerless gloves,
  tan/olive outfit, wooden-tube launcher.
- **Signature:** blue sweatband across the forehead, pink ponytail,
  determined scowl; the big firework tube on the shoulder.
- **3D cues:** recoil animation already in our sim — the launcher tube
  is the key prop. Headband + ponytail distinguish her from Archer.

### Magic Archer (`cards/magic-archer.png`)
- **Silhouette:** tall, slick, pointing forward; cape/sash trailing.
- **Palette:** white-silver swept-back hair, dark outfit, teal-glowing
  eyes and energy, purple/teal sash.
- **Signature:** glowing cyan eyes and a beam of cyan magic firing from
  a pointed finger/bow; smug grin. Legendary "iridescent" card frame.
- **3D cues:** the cyan piercing-beam (our line-damage shot) is the FX
  hero; white hair + glowing eyes. Lean, confident posture.

### Musketeer (`cards/musketeer.png`)
- **Silhouette:** woman shouldering a long musket rifle.
- **Palette:** purple curled hair, steel helmet, blue-grey coat with
  gold trim, wooden+steel musket.
- **Signature:** curly purple hair under a domed steel helm, one-eye
  wink/aim, big confident smile; long-barreled musket.
- **3D cues:** purple curls + helmet combo; the long rifle is the read
  at range. Stock braced to shoulder.

### Mini P.E.K.K.A (`cards/mini-pekka.png`)
- **Silhouette:** compact armored robot-knight; bulky pauldrons.
- **Palette:** blue-steel plate armor, cyan visor glow, dark joints.
- **Signature:** smooth featureless helmet with a glowing cyan slit
  visor; oversized sword (the "Pancake-loving" mini PEKKA). Chunky.
- **3D cues:** all hard-surface plate; cyan visor strip is the only
  "face". Big sword. Reads as a stubby version of P.E.K.K.A.

### P.E.K.K.A (`cards/pekka.png`)
- **Silhouette:** tall, heavy, menacing armored knight.
- **Palette:** near-black/dark-purple plate, magenta-pink glowing eyes,
  purple energy accents.
- **Signature:** angular demonic helmet with two glowing pink eye-slits;
  spiked armor; enormous greatsword. Epic (purple) card.
- **3D cues:** dark faceted plate + pink eye glow; taller and spikier
  than Mini P.E.K.K.A. Pure intimidation silhouette.

### Prince (`cards/prince.png`)
- **Silhouette:** knight on horseback (card shows bust); plumed helm.
- **Palette:** gold helmet, blue-and-white plume, dark moustache+goatee,
  blue mounted barding.
- **Signature:** golden barred-visor helmet with a tall blue/white
  feather plume; toothy grin, black goatee. Charges with a lance.
- **3D cues:** gold helm + blue plume is the read; lance + horse for the
  charge mechanic (our 2x charge). Heroic, grinning.

### Wizard (`cards/wizard.png`)
- **Silhouette:** bearded man in a hooded robe, hands raised to cast.
- **Palette:** blue hooded robe/cloak, brown beard, fair skin; conjures
  orange-red fireballs.
- **Signature:** blue pointed hood framing a brown beard and wide grin;
  fireball forming in the hands.
- **3D cues:** blue robe + hood silhouette; fireball FX in hands (splash
  attacker). Friendly enthusiastic expression.

### Witch (`cards/witch.png`)
- **Silhouette:** slender woman in a hooded cloak; staff.
- **Palette:** deep purple hood/cloak, pale lavender skin, glowing
  magenta-pink eyes, dark lips.
- **Signature:** purple hood with glowing pink eyes; spawns skeletons
  (our spawner). Sinister, alluring. Epic card.
- **3D cues:** purple robe + pink eye glow; staff prop; ties visually to
  the Skeletons she summons.

### Hog Rider (`cards/hog-rider.png`)
- **Silhouette:** muscular bare-chested man riding a hog; hammer raised.
- **Palette:** dark skin, thick black beard+topknot, brown shorts, grey
  hog mount, wooden hammer.
- **Signature:** wide-open shouting mouth, huge beard, top-knot; rides
  a tusked hog and jumps the river (our river-jumper).
- **3D cues:** beard + open-mouth yell is the personality; hog mount is
  half the silhouette; raised hammer.

### Skeletons (`cards/skeletons.png`)
- **Silhouette:** tiny goofy skeleton; deployed as a swarm of 3.
- **Palette:** off-white/bone with bluish shadow, dark hollow eye sockets.
- **Signature:** big round skull, oversized empty eye sockets, little
  bone arms holding a short sword. Cute, not scary.
- **3D cues:** cheap low-poly bone units, model 3+; exaggerated skull,
  spindly limbs. Witch/Tombstone spawn these.

---

## Flying troops

### Baby Dragon (`cards/baby-dragon.png`)
- **Silhouette:** pudgy winged baby dragon, tongue out.
- **Palette:** lime/emerald green body, teal wing membranes + horns,
  cream belly, yellow eyes.
- **Signature:** chubby snout with a lolling blue tongue, two small
  back-swept horns, stubby bat wings; breathes fire (splash flyer).
- **3D cues:** round green body + teal wings; goofy tongue-out face;
  small wings relative to body (toy-like).

### Balloon (`cards/balloon.png`)
- **Silhouette:** skeleton pilot in a hot-air balloon basket.
- **Palette:** dark navy/teal balloon canopy, tan sandbag basket, ropes,
  bone-white skeleton, black bomb.
- **Signature:** grinning skeleton leaning out of a patched balloon,
  cradling a round black bomb with a lit fuse; drops bombs, death-blast.
- **3D cues:** balloon canopy + basket is the big read from above
  (top-down camera); skeleton + bomb the detail.

### Gargoyles / Minions (`cards/gargoyles.png`)
- **Silhouette:** small dark flying imps; deployed in a group.
- **Palette:** blue-to-navy skin, purple wing membranes, glowing violet
  eyes, little horns.
- **Signature:** stubby winged gremlins with big violet eyes, snaggle
  teeth, clawed hands; fast fliers. (CR "Minions" = our Gargoyles.)
- **3D cues:** small blue bat-imps, model 3; violet eye glow; quick
  darting flyers.

---

## Buildings

### Cannon (`cards/cannon.png`)
- **Silhouette:** stubby cannon barrel on a wooden cart base.
- **Palette:** dark gunmetal barrel with blue bands, light wood crate
  base with cross-plank top.
- **Signature:** fat round muzzle pointed up/forward; chunky wooden
  platform. A decaying defensive building (baits building-seekers).
- **3D cues:** cylinder barrel + box base; blue accent rings; reads as
  a squat ground turret.

### Tombstone (`cards/tombstone.png`)
- **Silhouette:** stone grave with a ghostly hand bursting out.
- **Palette:** pale teal-white spectral hand, grey weathered headstone,
  dark earth base.
- **Signature:** skeletal/zombie hand clawing up out of a cracked
  gravestone; spawns skeletons then dies (our spawner building).
- **3D cues:** headstone block + emerging hand; spectral teal glow;
  pairs visually with Skeletons.

### Elixir Collector (`cards/elixir-collector.png`)
- **Silhouette:** industrial pump/refinery on a stone pad (full render).
- **Palette:** glowing magenta-pink elixir cylinder, blue wood trim,
  dark grey pump tube + valve wheel, grey base.
- **Signature:** glass tube of bright pink elixir under a wooden cap,
  with a curved exhaust pipe and a brown valve hand-wheel; periodically
  produces elixir.
- **3D cues:** pink glowing core is the read; pipe + wheel + barrel
  staves; sits flat on a stone slab.

---

## Spells (visual FX, no character)

### Fireball (`cards/fireball.png`)
- Roaring orange-yellow fireball with a fiery comet trail and sparks;
  warm core, red-orange edges. → projectile + splash burn FX.

### Arrows (`cards/arrows.png`)
- Volley of brown-shafted arrows with **red fletching** and steel heads
  raining down against a pale-blue sky. → area arrow-rain FX.

### Zap (`cards/zap.png`)
- Tall vial of **electric-blue** liquid wrapped in white lightning arcs
  on a stormy blue ground. → short stun + lightning crackle (our root).

### Rage (`cards/rage.png`)
- Squat bottle of **purple** potion glowing magenta; cork stopper.
  → purple ground haze that speeds friendly troops (our rage zone).

### Freeze (`cards/freeze.png`)
- Vial of pale **cyan** liquid amid snowflakes and frost crystals.
  → icy-blue freeze burst that roots everything.

---

## Source / refresh

Resolved via the Fandom MediaWiki API (`/api.php?action=query&
prop=imageinfo`), filenames mostly `File:<Name>Card.png` (spaces and
dots stripped: `MagicArcherCard`, `PEKKACard`, `MiniPEKKACard`;
Gargoyles = `MinionsCard`; `Elixir_Collector` and `FreezeCard`).
Images are served as WebP by the CDN and were converted to PNG via
`sips`. See `cards/` for the 25 files.
