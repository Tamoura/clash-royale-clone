# Deploy UX: ghost preview, validity colors, drag-to-deploy

## Changes

- New pure `checkDeploy` in battle.ts — a dry-run of `deployCard`
  returning "ok" | "finished" | "not-in-hand" | "bad-spot" |
  "no-elixir". `deployCard` now delegates to it (single validity
  authority, fully unit-tested).
- Hover disc is now green (valid), red (invalid), orange (spell).
- Selected troops show a translucent 3D ghost rig at the cursor
  (rebuilt only when the selected card changes; cleared on restart).
- Drag-to-deploy: hand cards select on pointerdown (releasing any
  implicit touch pointer capture), pointermove previews at window
  level, and pointerup over the field deploys. Click-click still
  works since it ends in the same pointerup.
