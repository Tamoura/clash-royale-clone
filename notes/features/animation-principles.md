# Animation principles round (3d-animation skill)

Applied the skill's core principles to the procedural rigs:
- Anticipation: attacks now wind up — the weapon arm cocks back
  with an ease-in as the cooldown approaches the hit (signed swing
  < 0), body leaning back via the existing swing-driven lean.
- Follow-through: after the strike sweep (1 -> 0) the arm dips
  past rest in a damped overshoot before settling.
- Overlapping action: the free arm now lags the leg cycle by half
  a beat instead of mirroring it exactly.
- Squash on impact: the body compresses ~5% during a heavy strike.
attackSwing(e, engaged) in scene3d feeds both field troops and the
tower crew; animateTroop handles the signed value naturally
(negative swing raises the arm past rest).

## Demo tooling
tools/record-battle.cjs: puppeteer-core drives headless Chrome,
starts a battle (hard bot), deploys knight+archers, records 9s of
the live canvas via MediaRecorder -> /tmp/cr-battle.webm; convert
with ffmpeg to mp4/gif. Used to send the user battle clips.
