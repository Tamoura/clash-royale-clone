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
| 25-28 | break | none: drums and drone alone | three big strokes a bar, 3 + 3 + 2: `B . . B . . B .` / Malfuf `U . . A . . A .` |
| 29-32 | charge | The horn climbs the chord (D F A D'), holds the top, comes down, and a fill leads back to the call | `B . S . B . S .` / Maqsum with ghost taks `U A a A U a A a` |

(Lower-case letters are soft ghost strokes. The letters are explained in
the next section.)

- **Fills:** the last bar of every 4-bar phrase (bars 4, 8, 12 ... 32) ends
  in a run of four full strokes into the next phrase: snare runs, a run of
  big-drum booms into the break, tak runs and dum runs.
- **Horn calls:** the horn sounds on less than 60% of the steps and never
  more than two bars without a breath. The break is drums alone.
- **The second horn** (double elixir up) echoes the calls in their rests,
  answers the march tune, and plays thirds and fourths under the charge.
- **The drone** (the bass line) holds the root, D2, with a pure fifth above
  it, mostly two bars at a time. It moves to G2 under some bars of the
  march, answer and charge. Every drone note overlaps the next by 5%
  (`bassGate`), so it never dips between notes.

## Drum voices

One letter per drum in the drum lines. A token of several letters strikes
them together, and lower case is a soft ghost stroke. Every stroke is 2-5
Web Audio nodes built from the shared noise buffers and one cached skin
waveform (`drumWave`, sine partials 1 : 0.8 : 0.55 : 0.3, made once in
`ensure()`). Nothing is allocated per hit.

| Letter | Drum | Synthesis |
|---|---|---|
| B | big war drum | skin 183 → 122 → 66 Hz over 0.75 s + stick slap (noise, band-pass 650 Hz) |
| L / H | low / high war tom | skin 170 → 118 Hz / 245 → 175 Hz + a small stick click |
| S | snare | tight skin 235 → 175 Hz + the wires (noise, band-pass 2 kHz) |
| R | snare roll | 4 strokes growing across one step, on one noise source (3 nodes per roll) |
| C | stick / rim click | short triangle 1750 → 1500 Hz |
| U | tabl dum | skin 116 → 74 Hz + beater slap (band-pass 700 Hz) |
| A | tabl tak | thin-stick crack (band-pass 2.9 kHz) + a small high skin |
| N / Q | naqqara low / high | skin 240 → 205 Hz / 360 → 315 Hz, dry and short |
| Z | naqqara roll | 4 strokes, high and low in turn, on one skin (2 nodes per roll) |
| F | daf | frame-drum skin 135 → 92 Hz + its jingles (band-pass 7.2 kHz) |

Every skin starts 1.5x above its pitch and drops to it in 15 ms, which is
the stick's attack. The big drums keep their body and attack between
roughly 120 and 500 Hz (the overtones) and 650 Hz to 3 kHz (the slap), so a
phone speaker plays them. The fundamentals stay at 64 Hz and above, so
nothing is spent below 40 Hz. The menu's darbuka (D, T) is unchanged.

New patches: `horn` (sawtooth with a soft triangle octave below, a slow
brassy bloom), `nafir` (brighter, nasal, wider vibrato), `drone` (two
sawtooths a pure fifth apart, low-passed at 600 Hz) and `arghul` (a reedy
square and sawtooth fifth). The battle track's old `chip` patch and the
old kick (K) were only used by the old track and are gone.

## Intensity

| Level | When | What plays | Step |
|---|---|---|---|
| 0 | normal time | the groove + drone + horn calls | 0.23 s (130 bpm) |
| 1 | double elixir | + answering drums (war toms / naqqara and daf), hats / riq jingles, the second horn | 0.215 s (140 bpm) |
| 2 | overtime | + rolls into every phrase (longer into every section), faster | 0.195 s (154 bpm) |

A change takes effect on the next step booked, the same as before. A test
checks that every gap between steps is one step at the old or the new
tempo, and that the tempo changes once.

## Hush (a tutorial step holding the clock)

The bed is the drone alone, at 85% of its level: no horns, no second horn,
no drums, answers, rolls or hats. When the kid plays, the drums come back
from the next step. `hushedLayers()` is unchanged in code (the bass line,
because the track has no pad), and its doc and test now say it is the
drone. `HUSH_LEVEL` went from 0.7 to 0.85 because the drone is already the
quietest layer.

## Starting from silence

The battle track starts after the countdown, from silence. Its first boom
used to fall inside the 0.4 s fade-in, 18 dB down. Now a track that starts
from silence ramps up in 10 ms (`MUSIC_START_SEC`), before its first note at
0.05 s. Replacing a playing track (for example the menu theme to the
battle) still crossfades over 0.4 s.

## Mix and loudness (measured)

These numbers come from renders of the game's own engine at default prefs
(master 1, music 0.5, sfx 0.8). Each render is 62 s at one intensity and is
measured from 1 s on. Loudness is EBU R128 integrated, measured as
dual-mono stereo. "Bus" is the music bus after its echo and duck, before
master. "Speaker" is the final output after master and the limiter.

| Edition, level | Old bus | New bus | Old speaker | New speaker | New true peak (bus) |
|---|---|---|---|---|---|
| Classic 0 | -29.3 LUFS | -29.9 | -32.4 | -33.1 | -15.2 dBTP |
| Classic 1 | -29.1 | -28.9 | -32.3 | -32.1 | -12.7 |
| Classic 2 | -27.5 | -28.5 | -30.7 | -31.7 | -12.6 |
| Golden Age 0 | -29.4 | -30.3 | -32.6 | -33.5 | -14.3 |
| Golden Age 1 | -29.2 | -29.3 | -32.4 | -32.5 | -11.8 |
| Golden Age 2 | -27.5 | -28.9 | -30.7 | -32.1 | -12.7 |

So every level is within 1.4 LU of the old track, and true peak stays at
-11.8 dBTP or below.

- **Hush bed:** -43.0 / -41.6 LUFS (Classic / Golden Age), against the old
  bass-line bed's -34.0 / -36.8.
- **Balance in normal time** (momentary loudness on the bus):
  - Drums: median -30.9 (Classic), -32.7 (Golden Age).
  - Horn calls: their loud moments (90th percentile) reach -35.9 / -35.5.
  - Through a steep 180 Hz high-pass, a rough phone speaker: drums median
    -35.2 / -37.4, horn calls -37.6 / -37.0.

  The drums lead and the horns stay clear.
- **Sub-bass:** below 40 Hz the new track carries -64 dBFS RMS, against
  -42 dBFS for the old one. The old pluck bass doubled every note an
  octave down, to 37 Hz.
- **Under the sound effects:** music levels in 0.5 s windows (speaker path,
  normal time, first 24 s):

  | | Median | 90th percentile |
  |---|---|---|
  | Old | -33.5 | -32.2 |
  | New, Classic | -34.3 | -32.2 |
  | New, Golden Age | -34.1 | -32.9 |

  In 40-200 Hz the new track is lower than the old: median -38.2 against
  -36.3. A Comet boom measured -21.6 dB in 40-200 Hz over 0.5 s, 14.4 dB
  over the new music's 90th percentile in that band (12.9 dB over the
  old's). So the big drum masks the booms less than the old bass did.

  Each sound effect alone, over 0.5 s, against the music's median: a
  giant's deploy thump +4.9 dB (old +4.1), a knight's +4.3 (old +3.5), the
  fireball +9.6 (old +8.8), the crown cheer +4.6 (old +3.8). A falling
  tower is about level (+0.6, old -0.2), because its rumble spreads over a
  second. A single melee hit is 3.3 dB under (old 4.1 under). Every effect
  sits 0.8 dB further above the new music than above the old.
- **Unchanged:** mute, the Music slider (it scales the bus gain), the
  8 dB duck under stings and results, and the crossfade between tracks.
  Their tests still pass, and the browser check below covers mute and the
  slider.

## Cost on old tablets (measured)

Web Audio nodes created per second, counted on every `create*` call during
the renders above:

| Edition, level | Old | New |
|---|---|---|
| Classic 0 | 30.0 | 20.5 |
| Classic 1 | 60.1 | 41.2 |
| Classic 2 | 81.2 | 46.0 |
| Golden Age 0 | 35.4 | 22.7 |
| Golden Age 1 | 71.7 | 42.7 |
| Golden Age 2 | 101.3 | 47.3 |

At overtime the new track costs 0.57x (Classic) and 0.47x (Golden Age) of
the old. The old track's lead, counter-melody and hats ran on every step.
The new one's horns rest more, and each roll costs one source for the whole
step, not one per stroke.

## How the previews were rendered

The previews are in `/tmp/claude-0/drums/previews/` (outside the repo), and
the harness is `/tmp/claude-0/drums/build/render.cjs`.

The harness runs the game's own `src/audio/sound.ts` (and, for the
comparison, the base commit's copy) in headless Chromium against an
OfflineAudioContext. It changes nothing in the engine:

- The page hands the engine a Proxy of the offline context as its
  `AudioContext`. Its state always reads "running", and it counts every
  node created.
- It replaces the engine's `setInterval` timer with its own tick: every
  25 ms of audio time (the game's `SCHEDULER_TICK_MS`) it suspends the
  render and calls the engine's own `pump()`.
- `setIntensity`, `setHushed` and `playMusic` are the engine's public
  calls, made at fixed times.

No seam was added to the engine, and nothing ships.

The files:

- `war-drums-classic.mp3` and `war-drums-golden-age.mp3` (72 s each): 25 s
  normal time, 20 s double elixir, then 27 s overtime ending on the
  engine's own fade.
- `old-battle-music-classic.mp3`: the old track, 30 s, normal time.
- `war-drums-with-battle-sounds-{classic,golden-age}.mp3` and
  `old-battle-music-with-battle-sounds-classic.mp3`: 30 s with deploys,
  hits, archers, a fireball, a Comet, a tower falling with the crown cheer,
  a Hog Rider, a Zap and a Giant, played through the engine's `onEvent`.
  These let you hear the music sitting under the game's sounds.

All are the speaker output at default prefs, made louder by one fixed gain
for listening: +12 dB for the music-only files and +8 dB for the files
with sound effects (so their peaks stay under -1 dBTP). The gain is the
same for old and new, so their relative loudness is true. MP3, 192 kbps,
44.1 kHz. Each file has a spectrogram and a waveform PNG next to it.

## Browser check (production build)

See the "Browser acceptance" part of this package's report.

## Known gaps

- Nobody in the pipeline could listen. Every judgment here was made by
  measurement, by looking at spectrograms and waveforms, and by reading the
  score. The owner's ears decide.
- The "phone speaker" numbers come from a plain 180 Hz high-pass. That is
  not a real phone.
