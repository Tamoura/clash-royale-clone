# Graphics: status effect visuals

- New sim export `isRaged(state, entity)` (tested) so the renderer
  shares the exact zone logic the boost uses.
- Raged troops pulse with a hot-pink emissive glow (suspended while
  a white damage flash plays, restored after).
- Stunned troops show spinning "seeing stars" above their head,
  using one shared canvas texture; sprite is created lazily per view.
