# Deploy-zone expansion + HP clarity + elixir veil v2

- Deploy zone: canDeployTroopAt(side,x,y,open) takes OpenLanes;
  openLanes(state,side) opens a lane into enemy territory once the
  opponent's princess tower on that side is destroyed (CR rule).
  checkDeploy passes it. TDD'd.
- HP bars: new HP_COLOR — ally GREEN (0x35d04a), enemy RED — so
  the player's own troop health reads clearly (was team blue).
- Elixir veil v2: bottom-up linear fill (dark covers the uncharged
  top, clears downward as elixir -> cost) instead of the radial;
  a ready-pop scale+glow fires the moment a card becomes playable.
