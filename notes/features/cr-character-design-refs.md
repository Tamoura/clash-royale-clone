# cr-character-design-refs

Goal: grab official Clash Royale art + character design breakdowns for
all 25 deck cards, to drive our original low-poly 3D character models.

## What was collected
- `docs/cr-reference/cards/<slug>.png` — official card art, all 25 cards
  (troops, flyers, buildings, spells).
- `docs/cr-reference/character-design.md` — per-character breakdown:
  silhouette/proportions, palette, signature features, 3D modeling cues.
- `docs/cr-reference/README.md` — folder intro + refresh instructions.

## How they were grabbed
- Source: Clash Royale Fandom wiki MediaWiki API
  (`/api.php?action=query&prop=imageinfo`), run from the page context.
- Filenames mostly `File:<Name>Card.png` with spaces/dots stripped
  (`MagicArcherCard`, `PEKKACard`, `MiniPEKKACard`). Gargoyles =
  `MinionsCard`; `Elixir_Collector` and `FreezeCard` are exceptions.
- CDN serves WebP despite `.png` URLs; converted to PNG with `sips`.
- Sandbox PATH lacks curl/wget/ls; used `/opt/homebrew/bin/node` https
  for downloads and absolute-path `/usr/bin/sips` for conversion.

## Decision log
- Repo README says "no Supercell assets are used"; prior ref workflow
  kept images in /tmp. User explicitly chose to COMMIT the images to
  this branch anyway (their repo, their call). README's policy note in
  docs/cr-reference flags that these are reference-only, not shipped.

## Status: complete — 25/25 images + design doc written.
