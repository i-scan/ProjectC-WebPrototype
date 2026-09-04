from pathlib import Path

p = Path('src/labs/trajectory/trajectory-rules.test.js')
text = p.read_text()
old = "  it('builds every rule trajectory from adjacent Cell-center anchors while visual samples curve through them', () => {\n    const result = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: -3, r: 0 })"
new = "  it('builds every rule trajectory from adjacent Cell-center anchors while visual samples curve through them', () => {\n    const result = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: 2, r: 1 })"
if old not in text:
    raise RuntimeError('legacy trajectory anchor missing')
p.write_text(text.replace(old, new, 1))
