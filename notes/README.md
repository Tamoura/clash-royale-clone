# Notes

Design and history notes for the game, one file per feature or round, in
`features/`. They are written for whoever works on the code next.

## Words in these notes

The code keeps its first internal words, because ids, storage keys, the save
format and the online protocol depend on them. The screen uses the game's
own words:

| In the code and these notes | On screen |
|---|---|
| elixir (`src/game/elixir.ts`, `elixirRate`, `.elixir-bar`) | Sparks / الشرارات |
| princess tower | side tower / البرج الجانبي |
| card ids (`pekka`, `hog-rider`, `elixir-collector`...) and the sim's card names in `src/game/cards.ts` | the display names in `src/render/cardNames.ts` |
| challenge, tower troop and tutorial text in `src/game` | the display overrides in `src/render/challengeText.ts`, `src/render/towerTroopText.ts` and `src/ui/tutorialOverlay.ts` |
| `cr-clone-*` storage keys, the save tag `crown-rush`, the code head `CR` | (never shown) |

The game is **Banner Lanes** (درب الرايات), an original game by Pebble Kite
Games. The repository, the Render service and the Pages path keep their
first name so that no link or save is lost.
