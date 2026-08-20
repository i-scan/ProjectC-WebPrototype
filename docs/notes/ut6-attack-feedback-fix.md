# UT6 Attack Feedback Regression Fix

- Attack playback is keyed by `PlaybackEvent.id` in the shared Three.js Hex renderer and must not restart when hover/preview props re-render.
- Equivalent preview arrays/selections use semantic render keys so reference-only changes do not rebuild the Three scene.
- Real Actor HP loss triggers a short `HIT · -N HP` board-screen cue; this is feedback only and does not alter UT6 damage numbers.
- Basic Attack remains `weapon.basicDamage = 1`; this change does not modify Momentum, AT0, Incoming Momentum, or Thermal rules.
- Real-Chrome verification sweeps pointer hover across the board after an Attack and requires the playback-start count to remain unchanged.
