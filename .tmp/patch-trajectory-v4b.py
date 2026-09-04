from pathlib import Path

p = Path('src/labs/trajectory/trajectory-rules.js')
text = p.read_text()
old = r'''function bezierSection({ from, to, fromAxis, toAxis, movingM, includeStart = true, collisionAtEnd = false }) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  if (distance < 0.0001) {
    return includeStart ? [{ position: { ...from }, axisId: fromAxis ?? toAxis ?? null, momentumLevel: movingM }] : []
  }
  const fromHeading = axisAngle(fromAxis ?? toAxis ?? 'E')
  const toHeading = axisAngle(toAxis ?? fromAxis ?? 'E')
  const turn = Math.abs(shortestDelta(fromHeading, toHeading))
  const handleScale = turn > 0.01 ? BEZIER_TURN_HANDLE : BEZIER_STRAIGHT_HANDLE
  const handle = distance * handleScale
  const p0 = { ...from }
  const p3 = { ...to }
  const p1 = { x: p0.x + Math.cos(fromHeading) * handle, z: p0.z + Math.sin(fromHeading) * handle }
  const p2 = { x: p3.x - Math.cos(toHeading) * handle, z: p3.z - Math.sin(toHeading) * handle }
  const count = Math.max(12, Math.round(VISUAL_CURVE_SAMPLES * Math.max(0.45, Math.min(1, distance / 3))))
  const samples = []
  for (let index = includeStart ? 0 : 1; index <= count; index += 1) {
    const local = index / count
    const position = cubicBezierPoint(p0, p1, p2, p3, local)
    const derivative = cubicBezierDerivative(p0, p1, p2, p3, local)
    const heading = Math.hypot(derivative.x, derivative.z) > 0.0001 ? Math.atan2(derivative.z, derivative.x) : toHeading
    samples.push({
      position,
      velocity: velocityForHeading(heading, movingM),
      axisId: nearestAxisIdFromAngle(heading),
      momentumLevel: movingM,
      collision: collisionAtEnd && index === count,
    })
  }
  return samples
}
'''
new = r'''function tangentHandleLengths(from, to, fromHeading, toHeading) {
  const fromDir = { x: Math.cos(fromHeading), z: Math.sin(fromHeading) }
  const toDir = { x: Math.cos(toHeading), z: Math.sin(toHeading) }
  const delta = { x: to.x - from.x, z: to.z - from.z }
  const distance = Math.max(0.0001, Math.hypot(delta.x, delta.z))
  const cross = (a, b) => a.x * b.z - a.z * b.x
  const denominator = cross(fromDir, toDir)
  if (Math.abs(denominator) < 0.0001) {
    const handle = distance * BEZIER_STRAIGHT_HANDLE
    return { fromHandle: handle, toHandle: handle, construction: 'parallel-tangent' }
  }
  const fromToIntersection = cross(delta, toDir) / denominator
  const endBackToIntersection = cross(fromDir, delta) / denominator
  if (fromToIntersection <= 0.001 || endBackToIntersection <= 0.001) {
    const handle = distance * BEZIER_STRAIGHT_HANDLE
    return { fromHandle: handle, toHandle: handle, construction: 'safe-fallback' }
  }
  const maxHandle = distance * 0.9
  return {
    fromHandle: Math.min(maxHandle, fromToIntersection * BEZIER_TURN_HANDLE),
    toHandle: Math.min(maxHandle, endBackToIntersection * BEZIER_TURN_HANDLE),
    construction: 'tangent-intersection',
  }
}

function bezierSection({ from, to, fromAxis, toAxis, movingM, includeStart = true, collisionAtEnd = false }) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  if (distance < 0.0001) {
    return includeStart ? [{ position: { ...from }, axisId: fromAxis ?? toAxis ?? null, momentumLevel: movingM }] : []
  }
  const fromHeading = axisAngle(fromAxis ?? toAxis ?? 'E')
  const toHeading = axisAngle(toAxis ?? fromAxis ?? 'E')
  const handles = tangentHandleLengths(from, to, fromHeading, toHeading)
  const p0 = { ...from }
  const p3 = { ...to }
  const p1 = {
    x: p0.x + Math.cos(fromHeading) * handles.fromHandle,
    z: p0.z + Math.sin(fromHeading) * handles.fromHandle,
  }
  const p2 = {
    x: p3.x - Math.cos(toHeading) * handles.toHandle,
    z: p3.z - Math.sin(toHeading) * handles.toHandle,
  }
  const count = Math.max(12, Math.round(VISUAL_CURVE_SAMPLES * Math.max(0.45, Math.min(1, distance / 3))))
  const samples = []
  for (let index = includeStart ? 0 : 1; index <= count; index += 1) {
    const local = index / count
    const position = cubicBezierPoint(p0, p1, p2, p3, local)
    const derivative = cubicBezierDerivative(p0, p1, p2, p3, local)
    const heading = Math.hypot(derivative.x, derivative.z) > 0.0001 ? Math.atan2(derivative.z, derivative.x) : toHeading
    samples.push({
      position,
      velocity: velocityForHeading(heading, movingM),
      axisId: nearestAxisIdFromAngle(heading),
      momentumLevel: movingM,
      curveConstruction: handles.construction,
      collision: collisionAtEnd && index === count,
    })
  }
  return samples
}
'''
if old not in text:
    raise RuntimeError('bezierSection source not found')
text = text.replace(old, new, 1)
p.write_text(text)

p = Path('src/labs/trajectory/trajectory-rules.test.js')
text = p.read_text()
marker = "  it('keeps M0 straight preview straight and appends a readable final-Axis stub', () => {"
insert = r'''  it('keeps late-turn curves on the intended side instead of producing an S-bend', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const lateNe = plan(state, 'steer', { q: 3, r: -1 })
    expect(lateNe.segmentAxes).toEqual(['E', 'E', 'NE'])
    expect(lateNe.samples.some((sample) => sample.curveConstruction === 'tangent-intersection')).toBe(true)
    expect(Math.max(...lateNe.samples.map((sample) => sample.position.z))).toBeLessThanOrEqual(0.000001)

    const lateSe = plan(state, 'steer', { q: 2, r: 1 })
    expect(lateSe.segmentAxes).toEqual(['E', 'E', 'SE'])
    expect(Math.min(...lateSe.samples.map((sample) => sample.position.z))).toBeGreaterThanOrEqual(-0.000001)
  })

'''
if marker not in text:
    raise RuntimeError('test insertion marker missing')
text = text.replace(marker, insert + marker, 1)
p.write_text(text)
print('Trajectory v4b tangent geometry applied')
