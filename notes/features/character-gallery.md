# Character portrait gallery (dev tool)

- `?gallery=<cardId|tower-princess|tower-king>` renders one posed
  character: pedestal, key+rim studio lights, slow showcase sway,
  idle animation, name caption. Battle bootstrap halts in this mode.
- Portraits render cleanly through headless Chrome:
  chrome --headless=new --enable-unsafe-swiftshader
    --screenshot=out.png "http://localhost:3101/?gallery=knight"
  (used to deliver all 17 portraits to the user; works while the
  desktop is locked, unlike screencapture).
