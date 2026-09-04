from pathlib import Path

rules_path = Path('src/labs/trajectory/trajectory-rules.js')
rules = rules_path.read_text()
rules = rules.replace(
"export const TRAJECTORY_PATH_RULE = 'cell-center-anchored-steering-curve-v2'\n",
"export const TRAJECTORY_PATH_RULE = 'cell-center-anchored-steering-curve-v2'\nexport const TRAJECTORY_PREVIEW_RULE = 'visited-cell-corridor-curve-v1'\n",
1,
)
rules = rules.replace(
"const PREVIEW_AXIS_STUB = 0.48\nconst CURVE_TANGENT_SCALE = 0.78\n",
"const PREVIEW_END_EXTENSION = 0.18\nconst PREVIEW_CORNER_PASSES = 2\nconst PREVIEW_DENSITY = 8\nconst CURVE_TANGENT_SCALE = 0.78\n",
1,
)
old = '''function previewAxisStubSamples(plan) {
  if (!plan?.valid || !plan.finalState?.axisId || !plan.samples?.length) return plan?.samples ?? []
  const samples = plan.samples.map((sample) => ({
    ...sample,
    position: { ...sample.position },
    velocity: { ...sample.velocity },
  }))
  const center = axialToWorld(plan.finalHex)
  const direction = directionVector(plan.finalState.axisId)
  samples.push({
    t: 1.05,
    position: { x: center.x + direction.x * PREVIEW_AXIS_STUB, z: center.z + direction.z * PREVIEW_AXIS_STUB },
    velocity: { ...plan.finalState.velocity },
    axisId: plan.finalState.axisId,
    momentumLevel: plan.finalM,
    previewAxisStub: true,
  })
  return samples
}
'''
new = '''function pointLerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}

function pointHexKey(point) {
  const hex = worldToAxial(point)
  return `${hex.q},${hex.r}`
}

function chaikinPass(points) {
  if (points.length <= 2) return points.map((point) => ({ ...point }))
  const result = [{ ...points[0] }]
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    result.push(pointLerp(a, b, 0.25), pointLerp(a, b, 0.75))
  }
  result.push({ ...points.at(-1) })
  return result
}

function nearestVisitedCenter(point, centers) {
  let nearest = centers[0]
  let best = Infinity
  for (const center of centers) {
    const distance = Math.hypot(point.x - center.x, point.z - center.z)
    if (distance < best) {
      best = distance
      nearest = center
    }
  }
  return nearest
}

function clampPreviewPointToVisitedCells(point, centers, visitedKeys) {
  if (visitedKeys.has(pointHexKey(point))) return { ...point }
  const center = nearestVisitedCenter(point, centers)
  let low = 0
  let high = 1
  for (let index = 0; index < 18; index += 1) {
    const mid = (low + high) * 0.5
    const candidate = pointLerp(center, point, mid)
    if (visitedKeys.has(pointHexKey(candidate))) low = mid
    else high = mid
  }
  return pointLerp(center, point, Math.max(0, low - 0.002))
}

function relaxedPreviewSamples(plan) {
  if (!plan?.valid || !plan.pathCells?.length) return plan?.samples ?? []
  const centers = plan.pathCells.map((hex) => axialToWorld(hex))
  const visitedKeys = new Set(plan.pathCells.map((hex) => `${hex.q},${hex.r}`))
  const finalCenter = centers.at(-1)
  const finalDirection = plan.finalState?.axisId ? directionVector(plan.finalState.axisId) : { x: 0, z: 0 }
  const rawEnd = {
    x: finalCenter.x + finalDirection.x * PREVIEW_END_EXTENSION,
    z: finalCenter.z + finalDirection.z * PREVIEW_END_EXTENSION,
  }
  const safeEnd = clampPreviewPointToVisitedCells(rawEnd, [finalCenter], new Set([`${plan.finalHex.q},${plan.finalHex.r}`]))

  let guide = [...centers.map((point) => ({ ...point })), safeEnd]
  for (let pass = 0; pass < PREVIEW_CORNER_PASSES; pass += 1) guide = chaikinPass(guide)

  const dense = []
  for (let index = 0; index < guide.length - 1; index += 1) {
    const from = guide[index]
    const to = guide[index + 1]
    for (let step = 0; step < PREVIEW_DENSITY; step += 1) {
      if (index > 0 && step === 0) continue
      dense.push(clampPreviewPointToVisitedCells(pointLerp(from, to, step / PREVIEW_DENSITY), centers, visitedKeys))
    }
  }
  dense.push(clampPreviewPointToVisitedCells(guide.at(-1), centers, visitedKeys))

  return dense.map((position, index) => {
    const next = dense[Math.min(dense.length - 1, index + 1)]
    const previous = dense[Math.max(0, index - 1)]
    const dx = next.x - previous.x
    const dz = next.z - previous.z
    const heading = Math.hypot(dx, dz) > 0.0001
      ? Math.atan2(dz, dx)
      : (plan.finalState?.axisId ? axisAngle(plan.finalState.axisId) : 0)
    const atEnd = index === dense.length - 1
    return {
      t: dense.length <= 1 ? 1 : index / (dense.length - 1),
      position,
      velocity: atEnd ? { ...plan.finalState.velocity } : velocityForHeading(heading, Math.max(1, plan.beforeM, plan.builtM)),
      axisId: atEnd ? plan.finalState.axisId : nearestAxisIdFromAngle(heading),
      momentumLevel: atEnd ? plan.finalM : Math.max(1, plan.beforeM, plan.builtM),
      previewCorridorSample: true,
      previewEnd: atEnd,
    }
  })
}
'''
if old not in rules:
    raise RuntimeError('previewAxisStubSamples anchor missing')
rules = rules.replace(old, new, 1)
rules = rules.replace(
"    samples: previewAxisStubSamples(controlledPlan),\n",
"    samples: relaxedPreviewSamples(controlledPlan),\n",
1,
)
rules = rules.replace(
"    previewAxisStub: controlledPlan.finalState?.axisId ?? null,\n",
"    previewAxisStub: controlledPlan.finalState?.axisId ?? null,\n    previewRule: TRAJECTORY_PREVIEW_RULE,\n",
1,
)
rules_path.write_text(rules)

test_path = Path('src/labs/trajectory/trajectory-rules.test.js')
tests = test_path.read_text()
tests = tests.replace(
"import { axialDistance, axialToWorld, directionIdBetween } from '../../sim/hex.js'",
"import { axialDistance, axialToWorld, directionIdBetween, worldToAxial } from '../../sim/hex.js'",
1,
)
tests = tests.replace(
"  TRAJECTORY_PATH_RULE,\n",
"  TRAJECTORY_PATH_RULE,\n  TRAJECTORY_PREVIEW_RULE,\n",
1,
)
old_test = '''  it('adds a preview-only terminal Axis stub without changing authoritative Landing', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 2 })
    const { controlled, coast } = trajectoryProjectionPair({
      state,
      actionId: 'steer',
      selectedHex: { q: 1, r: -2 },
      boardRadius: TRAJECTORY_DEFAULT_RADIUS,
      responseCurve: 'linear',
    })
    const preview = withCoastProjection(controlled, coast)
    expect(preview.samples.length).toBe(controlled.samples.length + 1)
    expect(preview.previewAxisStub).toBe(controlled.finalState.axisId)
    expect(preview.actorTrajectories.coastProjection).toEqual(coast.pathCells)
    expectCenter(controlled.finalState.position, controlled.finalHex)
  })
'''
new_test = '''  it('relaxes the blue preview inside visited Cells and ends near the final Cell center', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const { controlled, coast } = trajectoryProjectionPair({
      state,
      actionId: 'steer',
      selectedHex: { q: -3, r: 0 },
      boardRadius: TRAJECTORY_DEFAULT_RADIUS,
      responseCurve: 'linear',
    })
    const preview = withCoastProjection(controlled, coast)
    expect(preview.previewRule).toBe(TRAJECTORY_PREVIEW_RULE)
    expect(preview.previewAxisStub).toBe(controlled.finalState.axisId)
    expect(preview.actorTrajectories.coastProjection).toEqual(coast.pathCells)
    expectCenter(controlled.finalState.position, controlled.finalHex)

    const visited = new Set(controlled.pathCells.map((hex) => `${hex.q},${hex.r}`))
    for (const sample of preview.samples) {
      const hex = worldToAxial(sample.position)
      expect(visited.has(`${hex.q},${hex.r}`)).toBe(true)
    }

    const interiorCenters = controlled.pathCells.slice(1, -1).map(axialToWorld)
    expect(preview.samples.some((sample) => interiorCenters.every((center) => Math.hypot(sample.position.x - center.x, sample.position.z - center.z) > 0.025))).toBe(true)

    const finalCenter = axialToWorld(controlled.finalHex)
    const end = preview.samples.at(-1).position
    const endDistance = Math.hypot(end.x - finalCenter.x, end.z - finalCenter.z)
    expect(endDistance).toBeGreaterThan(0.04)
    expect(endDistance).toBeLessThan(0.24)
    expect(worldToAxial(end)).toEqual(controlled.finalHex)
  })
'''
if old_test not in tests:
    raise RuntimeError('preview test anchor missing')
tests = tests.replace(old_test, new_test, 1)
test_path.write_text(tests)

lab_path = Path('src/labs/trajectory/TrajectoryLab.jsx')
lab = lab_path.read_text()
lab = lab.replace(
"  TRAJECTORY_PATH_RULE,\n",
"  TRAJECTORY_PATH_RULE,\n  TRAJECTORY_PREVIEW_RULE,\n",
1,
)
lab = lab.replace(
"      data-trajectory-path={TRAJECTORY_PATH_RULE}\n",
"      data-trajectory-path={TRAJECTORY_PATH_RULE}\n      data-trajectory-preview={TRAJECTORY_PREVIEW_RULE}\n",
1,
)
lab = lab.replace(
"<div className=\"section-heading\"><h3>Projection</h3><span>Cell-center polyline</span></div>",
"<div className=\"section-heading\"><h3>Projection</h3><span>visited-Cell corridor curve</span></div>",
1,
)
lab = lab.replace(
"              <span><i className=\"trajectory\" />Blue = chosen Action center-path</span>\n              <span><i className=\"momentum-axis\" />Yellow = Skip/Coast center-path</span>\n              <span>Every path bend occurs at a Cell center</span>\n              <span>Short terminal segment = predicted Ready Axis</span>",
"              <span><i className=\"trajectory\" />Blue = smoothed preview inside visited Cells</span>\n              <span><i className=\"momentum-axis\" />Yellow = Skip/Coast authority path</span>\n              <span>Blue may miss intermediate centers but never enters an unvisited Cell</span>\n              <span>Preview ends near final Cell center, biased toward Ready Axis</span>",
1,
)
lab_path.write_text(lab)

smoke_path = Path('scripts/verify-trajectory-lab.mjs')
smoke = smoke_path.read_text()
smoke = smoke.replace(
"  assert(dom.includes('data-trajectory-path=\"cell-center-anchored-steering-curve-v2\"'), 'Cell-center anchored steering curve marker missing')\n",
"  assert(dom.includes('data-trajectory-path=\"cell-center-anchored-steering-curve-v2\"'), 'Cell-center anchored authority curve marker missing')\n  assert(dom.includes('data-trajectory-preview=\"visited-cell-corridor-curve-v1\"'), 'Visited-Cell corridor preview marker missing')\n",
1,
)
smoke = smoke.replace(
"  assert(dom.includes('Every path bend occurs at a Cell center'), 'Cell-center authority legend missing')\n  assert(dom.includes('Short terminal segment = predicted Ready Axis'), 'Preview Ready Axis terminal marker explanation missing')\n",
"  assert(dom.includes('Blue may miss intermediate centers but never enters an unvisited Cell'), 'Relaxed safe-corridor preview legend missing')\n  assert(dom.includes('Preview ends near final Cell center, biased toward Ready Axis'), 'Near-center preview ending legend missing')\n",
1,
)
smoke_path.write_text(smoke)
