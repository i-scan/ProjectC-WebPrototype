from pathlib import Path
import re


def sub_once(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 replacement, got {count}')
    return updated


# Rules: make discrete route result canonical first, then derive motion/preview geometry from it.
p = Path('src/labs/trajectory/trajectory-rules.js')
text = p.read_text()
text = text.replace("export const TRAJECTORY_PATH_RULE = 'cell-center-anchored-steering-curve-v2'", "export const TRAJECTORY_PATH_RULE = 'canonical-turn-timing-path-v3'")
text = text.replace("export const TRAJECTORY_PREVIEW_RULE = 'visited-cell-corridor-curve-v2'", "export const TRAJECTORY_PREVIEW_RULE = 'canonical-result-corridor-curve-v3'")
text = text.replace('const PREVIEW_END_EXTENSION = 0.18', 'const PREVIEW_END_EXTENSION = 0.42')
text = text.replace('const PREVIEW_CORNER_INSET = 0.38', 'const PREVIEW_CORNER_INSET = 0.42')
text = text.replace('const PREVIEW_BOW_MAX = 0.18', 'const PREVIEW_BOW_MAX = 0.34')
text = text.replace('const PREVIEW_DENSITY = 10', 'const PREVIEW_DENSITY = 12')

build_block = r'''function rotatedAxisId(axisId, offset) {
  const index = HEX_DIRECTIONS.findIndex((entry) => entry.id === axisId)
  if (index < 0) return axisId ?? 'E'
  const count = HEX_DIRECTIONS.length
  return HEX_DIRECTIONS[(index + offset + count) % count].id
}

function routeForAxes(startHex, axes, boardRadius, turnAt = null, turnAxis = null) {
  const path = [{ ...startHex }]
  const segmentAxes = []
  let current = { ...startHex }
  for (const axisId of axes) {
    const next = addStep(current, axisId)
    if (axialDistance(next) > boardRadius) break
    current = next
    path.push({ ...current })
    segmentAxes.push(axisId)
  }
  return { path, segmentAxes, turnAt, turnAxis }
}

function routeTargetScore(route, selectedHex, requestedSteps) {
  const missingSteps = Math.max(0, requestedSteps - route.segmentAxes.length)
  if (!selectedHex) return missingSteps * 100
  const finalHex = route.path.at(-1)
  const finalWorld = axialToWorld(finalHex)
  const targetWorld = axialToWorld(selectedHex)
  const worldDistance = Math.hypot(finalWorld.x - targetWorld.x, finalWorld.z - targetWorld.z)
  return missingSteps * 100 + axialDistance(finalHex, selectedHex) * 10 + worldDistance
}

function buildCenterPath({ state, targetHeading, targetHex, travelSteps, steeringEnabled, responseCurve, boardRadius, freeM0Direction }) {
  const startHex = worldToAxial(state.position)
  const startAxis = state.axisId ?? (Number.isFinite(targetHeading) ? nearestAxisIdFromAngle(targetHeading) : null)
  const targetAxis = Number.isFinite(targetHeading) ? nearestAxisIdFromAngle(targetHeading) : startAxis
  const initialAxis = startAxis ?? targetAxis ?? 'E'
  const startHeading = axisAngle(initialAxis)
  let cappedDelta = 0
  if (steeringEnabled && Number.isFinite(targetHeading)) {
    const rawDelta = shortestDelta(startHeading, targetHeading)
    cappedDelta = freeM0Direction
      ? rawDelta
      : clamp(rawDelta, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
  }

  let chosenRoute
  if (freeM0Direction) {
    const freeAxis = targetAxis ?? initialAxis
    chosenRoute = routeForAxes(startHex, Array.from({ length: travelSteps }, () => freeAxis), boardRadius)
  } else {
    const candidates = [
      routeForAxes(startHex, Array.from({ length: travelSteps }, () => initialAxis), boardRadius),
    ]
    if (steeringEnabled && travelSteps >= 2) {
      for (const offset of [-1, 1]) {
        const turnAxis = rotatedAxisId(initialAxis, offset)
        for (let turnAt = 2; turnAt <= travelSteps; turnAt += 1) {
          const axes = Array.from({ length: travelSteps }, (_, index) => (index + 1 < turnAt ? initialAxis : turnAxis))
          candidates.push(routeForAxes(startHex, axes, boardRadius, turnAt, turnAxis))
        }
      }
    }
    candidates.sort((a, b) => routeTargetScore(a, targetHex, travelSteps) - routeTargetScore(b, targetHex, travelSteps))
    chosenRoute = candidates[0]
  }

  return {
    path: chosenRoute.path,
    segmentAxes: chosenRoute.segmentAxes,
    targetAxis: targetAxis ?? initialAxis,
    startAxis: initialAxis,
    startHeading,
    cappedDelta,
    steeringEnabled,
    turnAt: chosenRoute.turnAt,
    turnAxis: chosenRoute.turnAxis,
    responseCurve,
    finalTravelAxis: chosenRoute.segmentAxes.at(-1) ?? initialAxis,
  }
}'''
text = sub_once(text, r'function buildCenterPath\(\{.*?\n\}\n\nfunction hermitePoint', build_block + '\n\nfunction hermitePoint', 'buildCenterPath')

samples_block = r'''function samplesForCenterPath(path, pathResult, movingM, finalM, finalAxis) {
  const segmentCount = Math.max(0, path.length - 1)
  if (segmentCount === 0) {
    const center = axialToWorld(path[0])
    return [
      { t: 0, position: center, velocity: velocityFor(finalAxis, finalM), axisId: finalAxis, momentumLevel: finalM },
      { t: 1, position: { ...center }, velocity: velocityFor(finalAxis, finalM), axisId: finalAxis, momentumLevel: finalM },
    ]
  }

  const headingAtAnchor = (anchorIndex) => {
    if (anchorIndex <= 0) return pathResult.startHeading
    if (anchorIndex >= segmentCount) return finalAxis ? axisAngle(finalAxis) : axisAngle(pathResult.segmentAxes.at(-1) ?? pathResult.startAxis)
    const incomingAxis = pathResult.segmentAxes[anchorIndex - 1] ?? pathResult.startAxis
    const outgoingAxis = pathResult.segmentAxes[anchorIndex] ?? incomingAxis
    const incomingHeading = axisAngle(incomingAxis)
    const outgoingHeading = axisAngle(outgoingAxis)
    return incomingHeading + shortestDelta(incomingHeading, outgoingHeading) * 0.5
  }

  const samples = []
  samples.push({
    t: 0,
    position: axialToWorld(path[0]),
    velocity: velocityForHeading(headingAtAnchor(0), movingM),
    axisId: pathResult.startAxis,
    momentumLevel: movingM,
    cellCenterAnchor: true,
  })

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const from = axialToWorld(path[segmentIndex])
    const to = axialToWorld(path[segmentIndex + 1])
    const fromHeading = headingAtAnchor(segmentIndex)
    const toHeading = headingAtAnchor(segmentIndex + 1)
    for (let sub = 1; sub <= SUBSTEPS_PER_CELL; sub += 1) {
      const local = sub / SUBSTEPS_PER_CELL
      const global = (segmentIndex + local) / segmentCount
      const atFinalCenter = segmentIndex === segmentCount - 1 && sub === SUBSTEPS_PER_CELL
      const atCellCenter = sub === SUBSTEPS_PER_CELL
      const curve = hermitePoint(from, to, fromHeading, toHeading, local)
      const sampleAxis = atFinalCenter ? finalAxis : nearestAxisIdFromAngle(curve.heading)
      samples.push({
        t: global,
        position: curve.position,
        velocity: atFinalCenter ? velocityFor(finalAxis, finalM) : velocityForHeading(curve.heading, movingM),
        axisId: sampleAxis,
        momentumLevel: atFinalCenter ? finalM : movingM,
        cellCenterAnchor: atCellCenter,
      })
    }
  }
  return samples
}'''
text = sub_once(text, r'function samplesForCenterPath\(.*?\n\}\n\nfunction pointLerp', samples_block + '\n\nfunction pointLerp', 'samplesForCenterPath')

preview_block = r'''function relaxedPreviewSamples(plan) {
  if (!plan?.valid || !plan.pathCells?.length) return plan?.samples ?? []
  const centers = plan.pathCells.map((hex) => axialToWorld(hex))
  const visitedKeys = new Set(plan.pathCells.map((hex) => `${hex.q},${hex.r}`))
  const finalCenter = centers.at(-1)
  const finalAxis = plan.finalState?.axisId ?? plan.segmentAxes?.at(-1) ?? null
  const finalDirection = finalAxis ? directionVector(finalAxis) : { x: 0, z: 0 }
  const rawEnd = {
    x: finalCenter.x + finalDirection.x * PREVIEW_END_EXTENSION,
    z: finalCenter.z + finalDirection.z * PREVIEW_END_EXTENSION,
  }
  const finalVisited = new Set([`${plan.finalHex.q},${plan.finalHex.r}`])
  const safeEnd = clampPreviewPointToVisitedCells(rawEnd, [finalCenter], finalVisited)

  const startAxis = plan.segmentAxes?.[0] ?? finalAxis
  const startDirection = startAxis ? directionVector(startAxis) : { x: 1, z: 0 }
  const startHeading = startAxis ? axisAngle(startAxis) : 0
  const finalHeading = finalAxis ? axisAngle(finalAxis) : startHeading
  const canonicalTurnDeg = shortestDelta(startHeading, finalHeading) * RAD
  const turnSign = Math.sign(canonicalTurnDeg)
  const meaningfulTurn = Math.abs(canonicalTurnDeg) > 1
  const firstTurnSegment = startAxis ? (plan.segmentAxes ?? []).findIndex((axisId) => axisId !== startAxis) : -1
  const segmentCount = Math.max(1, plan.pathCells.length - 1)
  const turnProgress = firstTurnSegment >= 0
    ? clamp((firstTurnSegment + 0.35) / segmentCount, 0.2, 0.86)
    : 0.82
  const turnNormal = { x: -startDirection.z * turnSign, z: startDirection.x * turnSign }

  let guide = centers.map((point) => ({ ...point }))
  if (meaningfulTurn) {
    for (let pass = 0; pass < PREVIEW_CORNER_PASSES; pass += 1) guide = chaikinPass(guide)
  }

  const dense = []
  const guideSegments = Math.max(1, guide.length - 1)
  for (let index = 0; index < guide.length - 1; index += 1) {
    const from = guide[index]
    const to = guide[index + 1]
    for (let step = 0; step < PREVIEW_DENSITY; step += 1) {
      if (index > 0 && step === 0) continue
      const local = step / PREVIEW_DENSITY
      const progress = (index + local) / guideSegments
      const basePoint = pointLerp(from, to, local)
      let curvedPoint = basePoint
      if (meaningfulTurn) {
        const envelope = Math.pow(Math.max(0, Math.sin(Math.PI * progress)), 0.72)
        const focus = Math.exp(-Math.pow((progress - turnProgress) / 0.34, 2))
        const bow = PREVIEW_BOW_MAX * envelope * (0.35 + 0.65 * focus)
        curvedPoint = {
          x: basePoint.x + turnNormal.x * bow,
          z: basePoint.z + turnNormal.z * bow,
        }
      }
      dense.push(clampPreviewPointToVisitedCells(curvedPoint, centers, visitedKeys))
    }
  }
  dense.push({ ...finalCenter })

  if (finalAxis) {
    for (let step = 1; step <= 5; step += 1) {
      dense.push(clampPreviewPointToVisitedCells(pointLerp(finalCenter, safeEnd, step / 5), [finalCenter], finalVisited))
    }
  }

  return dense.map((position, index) => {
    const next = dense[Math.min(dense.length - 1, index + 1)]
    const previous = dense[Math.max(0, index - 1)]
    const dx = next.x - previous.x
    const dz = next.z - previous.z
    const heading = Math.hypot(dx, dz) > 0.0001 ? Math.atan2(dz, dx) : finalHeading
    const atEnd = index === dense.length - 1
    return {
      t: dense.length <= 1 ? 1 : index / (dense.length - 1),
      position,
      velocity: atEnd ? { ...plan.finalState.velocity } : velocityForHeading(heading, Math.max(1, plan.beforeM, plan.builtM)),
      axisId: atEnd ? finalAxis : nearestAxisIdFromAngle(heading),
      momentumLevel: atEnd ? plan.finalM : Math.max(1, plan.beforeM, plan.builtM),
      previewCorridorSample: true,
      previewEnd: atEnd,
    }
  })
}'''
text = sub_once(text, r'function relaxedPreviewSamples\(plan\) \{.*?\n\}\n\nexport function trajectoryActionPlan', preview_block + '\n\nexport function trajectoryActionPlan', 'relaxedPreviewSamples')

text = text.replace('    targetHeading,\n    travelSteps: requestedTravelSteps,', '    targetHeading,\n    targetHex: selectedHex,\n    travelSteps: requestedTravelSteps,')
text = text.replace('  const samples = samplesForCenterPath(pathResult.path, pathResult, movingM, finalM, finalAxis, responseCurve)', '  const samples = samplesForCenterPath(pathResult.path, pathResult, movingM, finalM, finalAxis)')
text = text.replace('    previewAxisStub: controlledPlan.finalState?.axisId ?? null,', '    previewAxisStub: controlledPlan.finalState?.axisId ?? null,\n    previewAxisStubLength: PREVIEW_END_EXTENSION,')
p.write_text(text)


# Tests: cover symmetric M3 turn timing, canonical same-result geometry, M0 straightness and terminal Axis stub.
p = Path('src/labs/trajectory/trajectory-rules.test.js')
text = p.read_text()
text = text.replace("import { axialDistance, axialToWorld, directionIdBetween, worldToAxial } from '../../sim/hex.js'", "import { axialDistance, axialToWorld, directionIdBetween, directionVector, worldToAxial } from '../../sim/hex.js'")
last_tests = r'''  it('exposes both M3 turn timings on both sides of the current Axis', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const earlyNe = plan(state, 'steer', { q: 3, r: -2 })
    const lateNe = plan(state, 'steer', { q: 3, r: -1 })
    const lateSe = plan(state, 'steer', { q: 2, r: 1 })
    const earlySe = plan(state, 'steer', { q: 1, r: 2 })

    expect(earlyNe.segmentAxes).toEqual(['E', 'NE', 'NE'])
    expect(lateNe.segmentAxes).toEqual(['E', 'E', 'NE'])
    expect(lateSe.segmentAxes).toEqual(['E', 'E', 'SE'])
    expect(earlySe.segmentAxes).toEqual(['E', 'SE', 'SE'])
    expect(earlyNe.finalHex).toEqual({ q: 3, r: -2 })
    expect(lateNe.finalHex).toEqual({ q: 3, r: -1 })
    expect(lateSe.finalHex).toEqual({ q: 2, r: 1 })
    expect(earlySe.finalHex).toEqual({ q: 1, r: 2 })
  })

  it('canonicalizes the blue preview by discrete path plus final Axis', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const coast = plan(state, 'skip')
    const a = plan(state, 'steer', { q: 3, r: -2 })
    const b = plan(state, 'steer', { q: 4, r: -3 })
    expect(b.pathCells).toEqual(a.pathCells)
    expect(b.finalState.axisId).toBe(a.finalState.axisId)

    const previewA = withCoastProjection(a, coast)
    const previewB = withCoastProjection(b, coast)
    const positionsA = previewA.samples.map((sample) => [Number(sample.position.x.toFixed(6)), Number(sample.position.z.toFixed(6))])
    const positionsB = previewB.samples.map((sample) => [Number(sample.position.x.toFixed(6)), Number(sample.position.z.toFixed(6))])
    expect(positionsB).toEqual(positionsA)
  })

  it('keeps M0 straight movement straight and makes the terminal Axis stub readable', () => {
    const state = makeTrajectoryState({ axisId: null, momentum: 0 })
    const controlled = plan(state, 'steer', { q: 2, r: 0 })
    const coast = plan(state, 'skip')
    const preview = withCoastProjection(controlled, coast)
    expect(controlled.pathCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expect(controlled.finalState.axisId).toBe('E')
    expect(preview.samples.every((sample) => Math.abs(sample.position.z) < 0.000001)).toBe(true)

    const finalCenter = axialToWorld(controlled.finalHex)
    const end = preview.samples.at(-1).position
    const endDistance = Math.hypot(end.x - finalCenter.x, end.z - finalCenter.z)
    expect(endDistance).toBeGreaterThan(0.32)
    expect(endDistance).toBeLessThan(0.46)
    expect(worldToAxial(end)).toEqual(controlled.finalHex)
  })

  it('uses a stronger canonical turn curve while staying inside visited Cells and ending along final Axis', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const controlled = plan(state, 'steer', { q: 3, r: -2 })
    const coast = plan(state, 'skip')
    const preview = withCoastProjection(controlled, coast)
    expect(preview.previewRule).toBe(TRAJECTORY_PREVIEW_RULE)
    expect(preview.previewAxisStub).toBe(controlled.finalState.axisId)
    expectCenter(controlled.finalState.position, controlled.finalHex)

    const visited = new Set(controlled.pathCells.map((hex) => `${hex.q},${hex.r}`))
    for (const sample of preview.samples) {
      const hex = worldToAxial(sample.position)
      expect(visited.has(`${hex.q},${hex.r}`)).toBe(true)
    }

    const firstCellSamples = preview.samples.filter((sample) => {
      const hex = worldToAxial(sample.position)
      return (hex.q === 0 && hex.r === 0) || (hex.q === 1 && hex.r === 0)
    })
    expect(firstCellSamples.some((sample) => Math.abs(sample.position.z) > 0.055)).toBe(true)

    const finalDirection = directionVector(controlled.finalState.axisId)
    const end = preview.samples.at(-1).position
    const previous = preview.samples.at(-2).position
    const dx = end.x - previous.x
    const dz = end.z - previous.z
    const length = Math.hypot(dx, dz)
    expect((dx * finalDirection.x + dz * finalDirection.z) / length).toBeGreaterThan(0.995)
  })
})'''
text = sub_once(text, r"  it\('relaxes the blue preview.*?\n  \}\)\n\}\)\s*$", last_tests, 'trajectory preview tests')
p.write_text(text)


# UI: remove obsolete response-shape controls and make action cards match Driving Lab density.
p = Path('src/labs/trajectory/TrajectoryLab.jsx')
text = p.read_text()
text = sub_once(text, r"const RESPONSE_CURVES = \[.*?\]\n\n", '', 'RESPONSE_CURVES')
text = sub_once(text, r"\n          <section className=\"panel-card\">\n            <div className=\"section-heading\"><h3>Steering Response</h3>.*?</section>\n", '\n', 'Steering Response panel')
text = text.replace('<div className="action-row trajectory-action-row">', '<div className="action-row trajectory-action-row" data-action-layout="driving-row">')
text = text.replace('Select a directional card, hover to preview, then click one Cell direction to execute immediately. Skip executes from the card.', 'Select action → hover → click Cell. Skip executes directly.')
text = text.replace("<p>{momentum > 0 ? 'No extra M. Apply up to 60° total Steering while the Action traverses its M Cell-center path; unsustained M dissipates at Action end.' : 'Fully six-directional at M0. Move exactly one adjacent Cell center and establish the chosen Axis.'}</p>", "<p>{momentum > 0 ? 'No extra M · steer ≤60° · M dissipates.' : 'Free Hex6 Move · 1 Cell · establish Axis.'}</p>")
text = text.replace('<p>Testing candidate: Build/Sustain +1M before resolving the 1AT Cell-center trajectory. Uses the same Steering authority, making M1/M2/M3 comparisons easy in normal play.</p>', '<p>+1M · sustain · same Steering rules.</p>')
text = text.replace('<p>Testing candidate: Build/Sustain +2M (stable cap M3), then resolve the higher-M Cell-center path in the same 1AT. Intended for stress-testing inertia readability.</p>', '<p>+2M · sustain · cap M3.</p>')
text = text.replace("<p>{momentum > 0 ? 'Make the deliberate choice not to steer. Current Horizontal Motion traverses its Cell-center path and then loses 1M at Action end.' : 'Deliberately spend 1 AT without locomotion. No misleading separate Wait card is created.'}</p>", "<p>{momentum > 0 ? 'Coast · no Steering · M-1.' : 'Spend 1 AT · stay in place.'}</p>")
p.write_text(text)


p = Path('src/labs/trajectory/trajectory.css')
text = p.read_text()
text = text.replace('''  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
}

.trajectory-lab .trajectory-action-row .action-card {
  min-width: 0;
  width: 100%;
  min-height: 124px;
  overflow: hidden;
}

.trajectory-lab .trajectory-action-row .action-card p {
  min-height: 62px;
  overflow-wrap: anywhere;
}''', '''  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: stretch;
}

.trajectory-lab .trajectory-action-row .action-card {
  min-width: 0;
  width: 100%;
  min-height: 92px;
}

.trajectory-lab .trajectory-action-row .action-card p {
  min-height: 0;
}''')
p.write_text(text)


# Browser gate markers.
p = Path('scripts/verify-trajectory-lab.mjs')
text = p.read_text()
text = text.replace('data-trajectory-path="cell-center-anchored-steering-curve-v2"', 'data-trajectory-path="canonical-turn-timing-path-v3"')
text = text.replace('data-trajectory-preview="visited-cell-corridor-curve-v2"', 'data-trajectory-preview="canonical-result-corridor-curve-v3"')
text = re.sub(r"\n  assert\(dom\.includes\('data-response-curve=.*?Response curve debug A/B missing'\)\n", '\n', text)
anchor = "  assert(dom.includes('data-trajectory-action=\"skip\"'), 'Skip action missing')\n"
if anchor not in text:
    raise RuntimeError('browser action marker anchor missing')
text = text.replace(anchor, anchor + "  assert(dom.includes('data-action-layout=\"driving-row\"'), 'Trajectory action cards must use compact Driving Lab row layout')\n  assert(!dom.includes('Steering Response'), 'Obsolete response-shape UI must not remain visible')\n")
p.write_text(text)

print('Trajectory v3 patch applied')
