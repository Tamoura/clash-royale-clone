# War Drums (طبول الحرب): the battle music

Owner's request: "Replace play music by طبول الحرب". The music that plays
during a battle is now an original war-drums track in both editions. The
menu theme is unchanged.

It plays in every match (bot battles, trials, the tutorial, friends/online
and replays): `src/audio/wire.ts` still starts `"battle"` the frame the
countdown ends, and `main.ts` still drives `setIntensity` (0 normal time,
1 double elixir, 2 overtime) every frame.

Everything is synthesized with the Web Audio API, as before: no audio
files, no samples, no borrowed melodies. The tune, the grooves and the drum
voices were written for this game. The Golden Age grooves are traditional
Arab rhythm cycles (Maqsum, Saidi, Baladi, Malfuf), which belong to
everyone, like a march or a waltz.

## What it sounds like

A heroic army marching into battle: big drums from the first beat, short
horn calls with space between them, and a low drone underneath. It aims to
be bold and fun for 6-12 year olds, not grim. There are no gunshots, no
explosions and no screams.

- **Classic:** big war drum (a taiko-like boom with the slap of the stick),
  low and high war toms, snare and snare rolls, and stick clicks. A war horn
  calls, a brass horn answers, over a drone of root and fifth. Mode: D
  dorian (D E F G A B C).
- **Golden Age:** Arab war drums. The tabl has a deep dum and a sharp tak,
  the naqqara is a pair of small kettle drums (high and low) that also
  rolls, and the daf is a frame drum with ringing jingles. Hats become riq
  jingles. A nafir (long trumpet) calls and a mizmar answers, over an
  arghul drone. Maqam Hijaz on D (D Eb F# G A Bb C), the old battle track's
  maqam, which keeps the menu's Bayati for the menu.

Each edition plays the same structure and the same tune (written in scale
degrees) in its own voice. Only the drum lines differ, so each kit can play
its own rhythms.

## The score

32 bars of 8 eighth-note steps (256 steps). At normal time a step is
0.23 s (130 beats a minute), so the loop lasts 59 s. A 3-minute match hears
it about three times, and every 4 bars ends in a drum fill, so it never
feels like one bar repeating.

| Bars | Section | Horn | Drums (Classic / Golden Age) |
|---|---|---|---|
| 1-8 | call | Two calls (bars 1-2, 5-6): "D . D A— . D'— A" and "D . D A— B A, G F D". The drums answer each call. | `B . . B B . C .` (boom . . boom boom . click) / Maqsum `U A . A U . A .` |
| 9-16 | march | A march tune in quarter notes; the drone moves to G for bars 13-14 | `B . S s B B S .` / Saidi `U A . U U . A .` |
| 17-24 | answer | Call and response: the horn calls (bars 17, 19, 21, 23), the drums answer in its rests, and at double elixir the second horn echoes each call | `B . C . B . C .` under a call, `B B S . B B S .` answering / Baladi `U U . A U . A .` |
| 25-28 | break | none: drums and drone alone | three stomps a bar, 3 + 3 + 2: `B . . B . . B .` / Malfuf with the beater and the stick together on its last two strokes, `U . . UA . . UA .` |
| 29-32 | charge | The horn climbs the chord (D F A D'), holds the top, comes down, and a fill leads back to the call | `B . S . B . S .` / Maqsum with ghost taks `U A a A U a A a` |

(Lower-case letters are soft ghost strokes. A token of several letters,
such as `BS` or `UA`, strikes those drums together. The letters are
explained in the next section.)

- **Fills:** the last bar of every 4-bar phrase (bars 4, 8, 12 ... 32) ends
  in a run of four full strokes into the next phrase, with the big drum
  under the run: for example `B . B . BS S BS S` and `U . U . UA A UA A`,
  and a run of booms into the break. Every fill strikes the big drum at
  least as often as the groove bar before it, so a fill builds instead of
  dropping out of the low end (a test checks it).
- **Horn calls:** the horn sounds on less than 60% of the steps and never
  more than two bars without a breath. The break is drums alone.
- **The second horn** (double elixir up) echoes the calls in their rests,
  answers the march tune, and plays thirds and fourths under the charge.
  It sits about 2 dB under the call.
- **The drone** (the bass line) holds the root, D2, with a pure fifth above
  it, mostly two bars at a time. It moves to G2 under some bars of the
  march, answer and charge. Every drone note overlaps the next by 5%
  (`bassGate`), so it never dips between notes.

## Drum voices

One letter per drum in the drum lines. Every stroke is 2-5 Web Audio nodes
built from the shared noise buffers and one cached skin waveform
(`drumWave`, sine partials 1 : 0.8 : 0.55 : 0.3, made once in `ensure()`).
Nothing is allocated per hit.

| Letter | Drum | Synthesis |
|---|---|---|
| B | big war drum | skin 183 → 122 → 66 Hz over 0.75 s, loud for its first 18% + stick slap (noise, band-pass 650 Hz) |
| L / H | low / high war tom | skin 170 → 118 Hz / 245 → 175 Hz + a small stick click |
| S | snare | tight skin 235 → 175 Hz + the wires (noise, band-pass 2 kHz) |
| R | snare roll | 4 strokes growing across one step, on one noise source (3 nodes per roll) |
| C | stick / rim click | short triangle 1750 → 1500 Hz |
| U | tabl dum | skin 116 → 74 Hz, loud for its first 18% + beater slap (band-pass 700 Hz) |
| A | tabl tak | thin-stick crack (band-pass 2.9 kHz) + a small high skin |
| N / Q | naqqara low / high | skin 240 → 205 Hz / 360 → 315 Hz, dry and short |
| Z | naqqara roll | 4 strokes, high and low in turn, on one skin (2 nodes per roll) |
| F | daf | frame-drum skin 135 → 92 Hz + its jingles (band-pass 7.2 kHz) |

Every skin starts 1.5x above its pitch and drops to it in 15 ms, which is
the stick's attack. The big drums keep their body and attack between
roughly 120 and 500 Hz (the overtones) and 650 Hz to 3 kHz (the slap), so a
phone speaker plays them. The fundamentals stay at 64 Hz and above, so
nothing is spent below 40 Hz. A test checks every war drum's pitch through
the fake audio graph: struck at 100 Hz or above, ringing no lower than
60 Hz, and the big drums with an overtone in 120-500 Hz. The menu's darbuka
(D, T) is unchanged.

**Accents** (`strokeAccent` in sound.ts): no two strokes are quite alike,
as with a real drummer. Beats sit above the off-steps. A bar's downbeat is
struck harder, which on a drum means a louder stick slap (+1.5 dB) and a
touch higher pitch, not more low boom over the game's thumps. Every stroke
also varies a little in level (+/-4%) and pitch (+/-2.4%) in fixed patterns
that do not line up with the bar, so two bars of the same groove never
sound the same. There is no randomness and no extra node.

New patches: `horn` (sawtooth with a soft triangle octave below, a slow
brassy bloom, low-passed at 1600 Hz), `nafir` (brighter, nasal, wider
vibrato), `drone` (two sawtooths a pure fifth apart, low-passed at 600 Hz)
and `arghul` (a reedy square and sawtooth fifth). The `brass` and `mizmar`
patches, now used only by the second horn, are set about 2 dB under the
call. The battle track's old `chip` patch and the old kick (K) were only
used by the old track and are gone.

## Intensity

| Level | When | What plays | Step |
|---|---|---|---|
| 0 | normal time | the groove + drone + horn calls | 0.23 s (130 bpm) |
| 1 | double elixir | + answering drums (war toms / naqqara and daf), hats / riq jingles, the second horn | 0.215 s (140 bpm) |
| 2 | overtime | the groove struck about 1 dB harder, a roll into every second bar (two steps into every phrase and section, four into the break), and ghost snares (Classic) or ghost taks (Golden Age) on the off-steps the groove leaves empty | 0.195 s (154 bpm) |

The overtime line is made from the groove (`overtimeFor` in music.ts), so
it always fits it. A change takes effect on the next step booked, the same
as before. Tests check that every gap between steps is one step at the old
or the new tempo, and that the engine plays exactly the groove at 0, adds
the answering drums at 1 and the rolls and ghost strokes at 2, in both
editions.

## Hush (a tutorial step holding the clock)

The bed is the drone alone, at 85% of its level: no horns, no second horn,
no drums, answers, rolls or hats. When the kid plays, the drums come back
from the next step. `hushedLayers()` keeps the bass line (the track has no
pad), which is the drone, and names every other layer, the answering drums
and rolls included, as off. `HUSH_LEVEL` went from 0.7 to 0.85 because the
drone is already the quietest layer.

## Starting from silence

The battle track starts after the countdown, from silence. Its first boom
used to fall inside the 0.4 s fade-in, 18 dB down. Now the battle track,
when it starts from silence, ramps up in 10 ms (`MUSIC_START_SEC`), before
its first note at 0.05 s. The menu theme still fades in over 0.4 s from
silence, at start-up and after every match, as before. Replacing a playing
track (for example the menu theme to the battle) still crossfades over
0.4 s. Tests check both.

## Mix and loudness (measured)

These numbers come from renders of the game's own engine at default prefs
(master 1, music 0.5, sfx 0.8). Each render is 62 s at one intensity and is
measured from 1 s on. Loudness is EBU R128 integrated, measured as
dual-mono stereo. "Bus" is the music bus after its echo and duck, before
master. "Speaker" is the final output after master and the limiter.

| Edition, level | Old bus | New bus | Old speaker | New speaker | New true peak (bus) |
|---|---|---|---|---|---|
| Classic 0 | -29.3 LUFS | -30.9 | -32.4 | -34.1 | -12.4 dBTP |
| Classic 1 | -29.1 | -29.7 | -32.3 | -32.9 | -12.0 |
| Classic 2 | -27.5 | -28.7 | -30.7 | -31.9 | -11.1 |
| Golden Age 0 | -29.4 | -31.0 | -32.6 | -34.2 | -12.3 |
| Golden Age 1 | -29.2 | -30.1 | -32.4 | -33.3 | -12.2 |
| Golden Age 2 | -27.5 | -29.1 | -30.7 | -32.3 | -11.6 |

So every level is 0.6 to 1.6 LU under the old track, and true peak stays
at -11.1 dBTP or below. Overtime is 1.0 LU above double elixir in both
editions (the first version gave only 0.4; the old track gave 1.6), and
double elixir is 0.9-1.2 LU above normal time (the old track 0.2).

- **Hush bed:** -43.0 / -41.6 LUFS (Classic / Golden Age), against the old
  bass-line bed's -34.0 / -36.8.
- **Balance in normal time** (momentary loudness on the bus, from stems
  rendered with the other voices muted):
  - Drums: median -32.4 (Classic) / -32.5 (Golden Age), loud moments
    (90th percentile) -30.0 / -30.4.
  - Horn calls alone: loud moments -33.3 / -34.0, within 1-1.5 dB of the
    drums' median and 3.3 / 3.6 dB under the drums' loud moments (8.1 /
    7.0 dB under in the first version).
  - Horns and drone together: median -34.9 / -34.9.
  - Through a steep 180 Hz high-pass, a rough phone speaker: drums median
    -36.7 / -36.9, horn calls' loud moments -34.0 / -34.2, horns and drone
    median -36.5 / -36.4.

  The drums lead on average and the calls read clearly over them.
- **Second horn under the call** (double elixir, integrated loudness of
  each horn alone): Classic -36.7 against the call's -34.8 (1.9 dB under),
  Golden Age -37.8 against -35.4 (2.4 dB under). In the first version the
  second horn was 1.1 and 3.8 dB louder than the call.
- **Fills:** each fill bar is 1.1 to 4.2 dB (Classic) and 1.2 to 2.7 dB
  (Golden Age) louder than the bar before it. In the first version some
  fills were up to 4.3 dB quieter. The break is about 1.5-2 dB under the
  bars around it (no horns); the Golden Age break was 4 dB under before it
  got its three stomps.
- **Bands** (normal time, bus RMS):
  - Below 40 Hz: -67.3 / -63.8 dBFS, against -41.8 / -46.2 for the old
    track. The old pluck bass doubled every note an octave down, to 37 Hz.
  - 80-400 Hz: -36.3 / -36.9 (first version -34.4 / -35.0, old track
    -35.6 / -37.9).
  - 1-4 kHz: -46.6 / -46.0, against -46.6 / -41.5 for the old track (first
    version -50.1 / -49.2). The Classic mix is now as bright as the old one;
    the Golden Age one is still darker than the old qanun and mizmar, which
    played on every step.

## Under the sound effects (measured)

The music must sit under the game's sounds. Three measurements, all on the
speaker path at normal time:

- **A sound effect dropped anywhere in the music.** The real melee hit,
  enemy giant deploy and enemy hog deploy (150 ms from their start) were
  added to 60 s of music at every 20 ms. "Covered" means the effect lifts
  the mix by less than 3 dB.

  | Effect | Old track | First version (Classic / Golden Age) | Now (Classic / Golden Age) |
  |---|---|---|---|
  | Melee hit | 40% covered, median lift +3.3 dB | 23% / 20% | 10% / 10%, median lift +6.2 / +6.3 dB |
  | Enemy giant deploy | 0.2%, +4.8 dB | 4.7% / 4.2% | 0% / 0%, +8.2 / +8.5 dB |
  | Enemy hog deploy | 0.2%, +4.5 dB | 9.1% / 10.0% | 0% / 0%, +8.2 / +8.3 dB |

- **The worst case: an effect landing exactly on a big-drum stroke** (the
  same moments the review used). An enemy giant deploy on a bar's downbeat
  is now 1.7 dB (Classic) / 1.3 dB (Golden Age) over the music in its
  150 ms and lifts the mix 4.1 / 3.8 dB; in the first version it was 0.3 /
  0.9 dB under and lifted it 2.8 / 2.5 dB. A melee hit on a downbeat is
  still 1.1 / 1.2 dB under the drum (lift +0.9 / +2.1 dB, first version
  3.4 / 3.1 dB under). The old track was quieter at those moments (+5.5 dB
  for the melee hit), but it covered melee hits four times as often
  overall.
- **Each effect against the music under it** (0.5 s from the effect, the
  30 s battle event list of the previews; the old column is the old
  Classic track):

  | Effect | over War Drums Classic | over War Drums Golden Age | over the old track |
  |---|---|---|---|
  | Giant deploy | +7.7 dB | +7.1 | +2.9 |
  | Knight deploy | +8.6 | +7.7 | +2.0 |
  | Comet boom | +16.3 | +16.8 | +13.2 |
  | Fireball | +8.8 | +10.9 | +9.2 |
  | Tower falls | +3.7 | +4.9 | +0.1 |
  | Crown cheer | +5.8 | +5.6 | +3.3 |
  | Melee hit | -1.6 | -1.2 | -3.9 |

  In 40-200 Hz, where the booms live, the Comet is 18.9 / 19.3 dB over the
  music (old 14.1) and a falling tower 7.3 / 7.4 dB (old -0.1). Music
  levels in 0.5 s windows over the first 24 s: median -36.3 / -36.5,
  90th percentile -34.1 / -34.5, against the old track's -33.5 and -32.0.
- **Unchanged:** mute, the Music slider (it scales the bus gain), the
  8 dB duck under stings and results, and the crossfade between tracks.
  Their tests still pass, and the browser check below covers mute and the
  slider.

## Cost on old tablets (measured)

Web Audio nodes created per second, counted on every `create*` call during
the renders above:

| Edition, level | Old | First version | Now |
|---|---|---|---|
| Classic 0 | 30.0 | 20.5 | 21.8 |
| Classic 1 | 60.1 | 41.2 | 42.8 |
| Classic 2 | 81.2 | 46.0 | 56.1 |
| Golden Age 0 | 35.4 | 22.7 | 24.5 |
| Golden Age 1 | 71.7 | 42.7 | 44.7 |
| Golden Age 2 | 101.3 | 47.3 | 54.6 |

At overtime the new track costs 0.69x (Classic) and 0.54x (Golden Age) of
the old. The old track's lead, counter-melody and hats ran on every step.
The new one's horns rest more, and each roll costs one source for the whole
step, not one per stroke. The overtime ghost strokes and the extra rolls
cost about 8-10 nodes a second.

## How the previews were rendered

The previews are in `/tmp/claude-0/drums/previews/` (outside the repo).
The harness is `/tmp/claude-0/drums/fix-1/render.cjs` with `previews.sh`
next to it (the first version used `/tmp/claude-0/drums/build/`).

The harness runs the game's own `src/audio/sound.ts` (and, for the
comparison, the base commit's copy) in headless Chromium against an
OfflineAudioContext. It changes nothing in the engine:

- The page hands the engine a Proxy of the offline context as its
  `AudioContext`. Its state always reads "running", and it counts every
  node created.
- It replaces the engine's `setInterval` timer with its own tick: every
  25 ms of audio time (the game's `SCHEDULER_TICK_MS`) it suspends the
  render and calls the engine's own `pump()`.
- `setIntensity`, `setHushed`, `playMusic` and `onEvent` are the engine's
  public calls, made at fixed times. For stems, it can silence one kind of
  voice; for checks, it can log every step and drum stroke.

No seam was added to the engine, and nothing ships.

The files:

- `war-drums-classic.mp3` and `war-drums-golden-age.mp3` (72 s each): 25 s
  normal time, 20 s double elixir, then 27 s overtime ending on the
  engine's own fade. Their step logs show 337 steps with none skipped or
  doubled, the tempo changing on the first step after each switch, and the
  loop wrapping cleanly at 55.7 s.
- `old-battle-music-classic.mp3`: the old track, 30 s, normal time.
- `war-drums-with-battle-sounds-{classic,golden-age}.mp3` and
  `old-battle-music-with-battle-sounds-classic.mp3`: 30 s with deploys,
  hits, archers, a fireball, a Comet, a tower falling with the crown cheer,
  a Boar Rider, a Zap and a Giant, played through the engine's `onEvent`.
  These let you hear the music sitting under the game's sounds.

All are the speaker output at default prefs, made louder by one fixed gain
for listening: +12 dB for the music-only files and +8 dB for the files
with sound effects. The gain is the same for old and new, so their relative
loudness is true. MP3, 192 kbps, 44.1 kHz. Loudness of the files: War Drums
-21.1 / -21.4 LUFS (true peak -2.3 / -2.8 dBTP), the old track -20.7; with
the sound effects -23.7 / -23.9 against the old -23.0, true peak -1.9 dBTP
or below.

Each file has three pictures next to it: `-waveform.png`,
`-spectrogram.png` (linear, 0-4 kHz) and `-spectrogram-low.png` (linear,
0-1 kHz, where the drums live). Both spectrograms resample the audio and
use linear axes with no zoom: in this ffmpeg (6.1.1), `showspectrumpic`'s
log axis and its start/stop zoom smear and misplace low frequencies (a
pure 100 Hz tone drew as a band from 50 to 170 Hz, and the first previews
showed a dark band at 210-290 Hz that was not in the audio). The settings
were checked on test tones at 100, 300 and 2000 Hz.

## Browser check (production build)

`npm run build:all`, served by `dist-server/relay.mjs` on port 3811, in
headless Chromium, with the final code of the first review round. Classic
ran on a phone (390x844, touch) and Golden Age on a desktop (1440x900).
Headless Chromium cannot be heard, so the page's Web Audio was instrumented
before the game loaded:

- every `create*` call is counted;
- every skin stroke is counted (`OscillatorNode.setPeriodicWave`, which
  only the new drum voices call; the old engine never did);
- an AnalyserNode taps the music bus (the gain that feeds the hall echo).

The production build has no debug hooks (`window.__cr` and `__crAudio`
are undefined), so these checks go through the audio graph only. Each
edition played a real bot battle from Home with real taps.

| Check | Classic (phone) | Golden Age (desktop) |
|---|---|---|
| Battle, normal time: skin strokes a second, music bus RMS | 3.7 /s, median -33.6 dB | 3.1 /s, median -37.4 dB |
| The skin wave is made once, not per hit | 1 | 1 |
| Pause menu open (the clock is held, so the music hushes): strokes, bus | 0 /s, -44.5 dB (the drone alone) | 0 /s, -42.5 dB |
| Battle menu "Sound: Off", playing: strokes, master gain, bus | 0 /s, 0, silent | 0 /s, 0, silent |
| "Sound: On" again: strokes, bus | 2.4 /s, -35.6 dB | 3.6 /s, -39.0 dB |
| Settings > Music to 0% (keyboard Home on the slider): music bus gain, level on Home | 0, silent | 0, silent |
| Then a battle at music 0%: strokes (the music keeps time), bus | 2.9 /s, silent | 3.4 /s, silent |
| Page errors, console errors, failed requests | none | none |

Double elixir and overtime were not reached in production in this round
(nothing in production can move the clock, and a real match takes
minutes). The intensity layers are checked by the engine test (the exact
strokes played at each level), the offline renders' step logs, and, for
the first version, on the dev server:

**Dev server, with hooks (first version):** `__cr.battle().time` was moved
on to reach double elixir and overtime in a real bot battle. `__crAudio()`
then read the engine directly:

| Edition | Normal: intensity, step, drum hits | Double elixir | Overtime |
|---|---|---|---|
| Golden Age | 0, 0.23 s, 3.0 /s | 1, 0.215 s, 6.0 /s | 2, 0.195 s, 5.6 /s |
| Classic | 0, 0.23 s, 2.2 /s | 1, 0.215 s, 4.7 /s | 2, 0.195 s, 5.0 /s |

In every row the music was "battle" and running, and nothing hushed.
There were no errors.

## First review round

Two blind reviews (music, code) passed the first version with minor
findings. All were fixed:

- Overtime lifted only 0.4 LU over double elixir: the groove now plays
  harder in overtime, with rolls into every second bar and ghost strokes
  (now +1.0 LU, node rate still 0.54-0.69x the old track).
- A big-drum hit could cover a deploy or a melee hit landing on it: the big
  drum's and the dum's body is about 2 dB lower with a shorter loud part,
  and the downbeat accent went into the stick slap. Deploys are no longer
  covered anywhere; a melee hit exactly on a downbeat is still about 1 dB
  under the drum for 150 ms (it was 3.4 dB under).
- The horn calls sat 5-8 dB under the drums: the calls are 3.9 dB
  (Classic, the horn also brighter) and 3.0 dB (Golden Age) louder, a bit
  more than the review's 2 dB to keep the track's loudness while the big
  drum came down; the drums still lead. The second horn, which was louder
  than the call, now sits 2 dB under it.
- Normal-time fills were quieter than the groove: the big drum now plays
  under every fill run.
- Every big-drum hit was identical: strokes now carry fixed accents.
- The menu theme had lost its 0.4 s fade-in from silence: restored, with
  a test.
- `hushedLayers()` did not name the new layers: it now does.
- Tests did not check the engine's layering, the drone overlap or the
  drums' phone range: they do now (each checked by breaking the code on
  purpose and watching the test fail).
- The preview spectrograms misread the low end: redrawn on linear axes.

## Known gaps

- Nobody in the pipeline could listen. Every judgment here was made by
  measurement, by looking at spectrograms and waveforms, and by reading the
  score. The owner's ears decide.
- The "phone speaker" numbers come from a plain 180 Hz high-pass. That is
  not a real phone.
- The music is 0.6-1.6 LU quieter than the old track (inside the +/-2 LU
  target). That was the price of the drums covering the game's sounds less;
  the Music slider can raise it.
- A melee hit that lands exactly on a bar's downbeat is still slightly
  under the big drum for 150 ms.
