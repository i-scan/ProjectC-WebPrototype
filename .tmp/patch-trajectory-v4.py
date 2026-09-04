from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f'{label}: source text not found')
    return text.replace(old, new, 1)


def splice(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start + 1)
    if start < 0 or end < 0:
        raise RuntimeError(f'{label}: markers not found')
    return text[:start] + replacement + text[end:]


# trajectory-rules.js: discrete route remains authoritative, but visual motion becomes one global
# tangent-controlled Bezier per uninterrupted leg. Reflection reuses Driving Lab runCellMotion.
p = Path('src/labs/trajectory/trajectory-rules.js')
text = p.read_text()
text = replace_once(
    text,
    "import { HEX_DIRECTIONS, axialDistance, axialToWorld, directionVector, worldToAxial } from '../../sim/hex.js'",
    "import { HEX_DIRECTIONS, axialDistance, axialToWorld, directionIdBetween, directionVector, worldToAxial } from '../../sim/hex.js'\nimport { runCellMotion } from '../../sim/cell-motion.js'",
    'trajectory imports',
)
text = replace_once(text, "export const TRAJECTORY_PREVIEW_RULE = 'canonical-result-corridor-curve-v3'", "export const TRAJECTORY_PREVIEW_RULE = 'global-tangent-bezier-preview-v4'\nexport const TRAJECTORY_REFLECTION_RULE = 'driving-lab-wall-pivot-reflection-v1'", 'preview rule')
text = re.sub(
    r"const SUBSTEPS_PER_CELL = 8\nconst PREVIEW_END_EXTENSION = 0\.42\nconst PREVIEW_CORNER_PASSES = 2\nconst PREVIEW_CORNER_INSET = 0\.42\nconst PREVIEW_BOW_MAX = 0\.34\nconst PREVIEW_DENSITY = 12\nconst CURVE_TANGENT_SCALE = 0\.78",
    "const VISUAL_CURVE_SAMPLES = 40\nconst PREVIEW_END_EXTENSION = 0.34\nconst BEZIER_TURN_HANDLE = 0.72\nconst BEZIER_STRAIGHT_HANDLE = 0.34",
    text,
    count=1,
)

visual_helpers = r'''function pointLerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}

function cubicBezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    z: uu * u * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + tt * t * p3.z,
  }
}

function cubicBezierDerivative(p0, p1, p2, p3, t) {
  const u = 1 - t
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    z: 3 * u * u * (p1.z - p0.z) + 6 * u * t * (p2.z - p1.z) + 3 * t * t * (p3.z - p2.z),
  }
}

function bezierSection({ from, to, fromAxis, toAxis, movingM, includeStart = true, collisionAtEnd = false }) {
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

function retimeVisualSamples(samples, finalState) {
  if (!samples.length) return []
  const distances = [0]
  let total = 0
  for (let index = 1; index < samples.length; index += 1) {
    total += Math.hypot(
      samples[index].position.x - samples[index - 1].position.x,
      samples[index].position.z - samples[index - 1].position.z,
    )
    distances.push(total)
  }
  return samples.map((sample, index) => {
    const atEnd = index === samples.length - 1
    return {
      ...sample,
      t: total > 0.0001 ? distances[index] / total : index / Math.max(1, samples.length - 1),
      velocity: atEnd ? { ...finalState.velocity } : sample.velocity,
      axisId: atEnd ? finalState.axisId : sample.axisId,
      momentumLevel: atEnd ? finalState.momentumLevel : sample.momentumLevel,
    }
  })
}

function visualSamplesForMotion({ state, motion, pathResult, movingM, finalState, travelEndAxis }) {
  const finalPosition = finalState.position
  const collisions = motion?.collisions ?? []
  const samples = []
  let from = { ...state.position }
  let fromAxis = pathResult.startAxis ?? state.axisId ?? travelEndAxis
  let first = true

  for (const collision of collisions) {
    if (!collision?.position) continue
    const section = bezierSection({
      from,
      to: collision.position,
      fromAxis,
      toAxis: collision.axisBefore ?? fromAxis,
      movingM,
      includeStart: first,
      collisionAtEnd: true,
    })
    samples.push(...section)
    first = false
    from = { ...collision.position }
    fromAxis = collision.axisAfter ?? fromAxis
  }

  const tail = bezierSection({
    from,
    to: finalPosition,
    fromAxis,
    toAxis: travelEndAxis ?? fromAxis,
    movingM,
    includeStart: first,
  })
  samples.push(...tail)

  if (!samples.length) {
    samples.push({
      position: { ...state.position }, velocity: { ...state.velocity }, axisId: state.axisId ?? null,
      momentumLevel: trajectoryMomentum(state),
    })
    if (Math.hypot(finalPosition.x - state.position.x, finalPosition.z - state.position.z) > 0.0001) {
      samples.push({
        position: { ...finalPosition }, velocity: { ...finalState.velocity }, axisId: finalState.axisId,
        momentumLevel: finalState.momentumLevel,
      })
    }
  }
  return retimeVisualSamples(samples, finalState)
}

function previewSamplesForPlan(plan) {
  if (!plan?.valid || !plan.samples?.length) return plan?.samples ?? []
  const samples = plan.samples.map((sample) => ({
    ...sample,
    position: { ...sample.position },
    velocity: { ...(sample.velocity ?? { x: 0, z: 0 }) },
  }))
  const finalAxis = plan.finalState?.axisId ?? null
  if (!finalAxis) return samples
  const finalCenter = plan.finalState.position
  const direction = directionVector(finalAxis)
  const speed = Math.max(1, plan.beforeM, plan.builtM)
  for (let step = 1; step <= 6; step += 1) {
    const distance = PREVIEW_END_EXTENSION * (step / 6)
    samples.push({
      t: 1,
      position: { x: finalCenter.x + direction.x * distance, z: finalCenter.z + direction.z * distance },
      velocity: velocityForHeading(axisAngle(finalAxis), speed),
      axisId: finalAxis,
      momentumLevel: plan.finalM,
      previewAxisStub: true,
      previewEnd: step === 6,
    })
  }
  return samples
}

'''
text = splice(text, 'function hermitePoint', 'export function trajectoryActionPlan', visual_helpers, 'visual helper replacement')

action_tail = r'''export function trajectoryActionPlan({
  state,
  actionId = 'steer',
  selectedHex = null,
  boardRadius = TRAJECTORY_DEFAULT_RADIUS,
  responseCurve = 'linear',
  baseDissipationPerAction = TRAJECTORY_BASE_DISSIPATION,
  obstacles = [],
} = {}) {
  const profile = profileFor(actionId)
  const canonicalActionId = profile.id
  const startM = trajectoryMomentum(state)
  const targetHeading = profile.needsDirection && selectedHex ? steeringBearingFromCell(state, selectedHex) : null
  if (profile.needsDirection && !Number.isFinite(targetHeading)) {
    return { valid: false, reason: 'Hover or click a direction Cell.' }
  }

  const buildM = profile.buildM ?? 0
  const builtM = clamp(startM + buildM, 0, 3)
  const freeM0Direction = startM === 0
  const steeringEnabled = profile.needsDirection

  let requestedTravelSteps = 0
  if (canonicalActionId === 'skip') requestedTravelSteps = startM
  else if (buildM > 0) requestedTravelSteps = Math.max(1, builtM)
  else requestedTravelSteps = startM > 0 ? startM : 1

  const pathResult = buildCenterPath({
    state,
    targetHeading,
    targetHex: selectedHex,
    travelSteps: requestedTravelSteps,
    steeringEnabled,
    responseCurve,
    boardRadius,
    freeM0Direction,
  })

  const startHex = worldToAxial(state.position)
  const movingM = Math.max(1, startM, builtM)
  const motion = runCellMotion({
    startHex,
    initialAxisId: pathResult.startAxis ?? state.axisId ?? pathResult.finalTravelAxis,
    initialMomentum: Math.max(startM, builtM),
    travelBudget: requestedTravelSteps,
    authoredPathCells: pathResult.path.slice(1),
    obstacles,
    boardRadius,
    capRemainingByMomentum: false,
    // Match Driving Lab / Spatial Inertia v1: surface redirects Axis; reflection itself is not an M tax.
    reflectionMomentum: ({ momentum }) => ({ momentum, restitution: null }),
  })

  if (startM === 0 && buildM === 0 && motion.collisions.length > 0) {
    return {
      valid: false,
      reason: 'M0 Move cannot initiate a Wall / Surface reflection.',
      kind: canonicalActionId,
      actionId: canonicalActionId,
      beforeM: startM,
      finalM: startM,
      collisions: motion.collisions,
      reflectionRule: TRAJECTORY_REFLECTION_RULE,
    }
  }

  let generatedM = 0
  let startupCompatible = false
  let finalM = startM
  if (profile.sustain) {
    finalM = builtM
  } else if (startM === 0) {
    if (canonicalActionId === 'steer') {
      startupCompatible = Boolean(state.axisId) && compatibleStartupMove(state, selectedHex)
      generatedM = startupCompatible ? 1 : 0
      finalM = generatedM
    } else {
      finalM = 0
    }
  } else {
    finalM = Math.max(0, startM - Math.max(0, baseDissipationPerAction))
  }

  const actualPathCells = [startHex, ...(motion.actualPath ?? [])].map((hex) => ({ ...hex }))
  const resolvedSegmentAxes = []
  for (let index = 1; index < actualPathCells.length; index += 1) {
    const axisId = directionIdBetween(actualPathCells[index - 1], actualPathCells[index])
    if (axisId) resolvedSegmentAxes.push(axisId)
  }
  const travelEndAxis = motion.reflected
    ? (motion.axisAfter ?? resolvedSegmentAxes.at(-1) ?? pathResult.finalTravelAxis)
    : (pathResult.finalTravelAxis ?? resolvedSegmentAxes.at(-1) ?? state.axisId ?? pathResult.targetAxis)

  let finalAxis = travelEndAxis
  let zeroMSettlementDeg = 0
  if (!motion.reflected && startM > 0 && finalM === 0 && canonicalActionId === 'steer' && Number.isFinite(targetHeading)) {
    const currentAxisHeading = axisAngle(finalAxis)
    const remaining = shortestDelta(currentAxisHeading, targetHeading)
    if (Math.abs(remaining) > 0.001) {
      const settlement = clamp(remaining, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
      finalAxis = nearestAxisIdFromAngle(currentAxisHeading + settlement)
      zeroMSettlementDeg = settlement * RAD
    }
  }
  if (startM === 0 && profile.needsDirection && Number.isFinite(targetHeading) && !motion.reflected) {
    finalAxis = nearestAxisIdFromAngle(targetHeading)
  }
  if (canonicalActionId === 'skip' && startM === 0 && !state.axisId) finalAxis = null

  const finalHex = { ...motion.finalHex }
  const finalPosition = axialToWorld(finalHex)
  const finalState = {
    ...state,
    position: finalPosition,
    velocity: velocityFor(finalAxis, finalM),
    axisId: finalAxis,
    momentumLevel: finalM,
    heading: finalAxis ? axisAngle(finalAxis) : null,
    worldAt: Number(state.worldAt ?? 0) + 1,
  }
  const samples = visualSamplesForMotion({ state, motion, pathResult, movingM, finalState, travelEndAxis })
  const actualSteps = motion.spentTravel
  const crossings = actualPathCells.map((hex, index) => ({
    hex: { ...hex },
    sampleIndex: Math.round((index / Math.max(1, actualPathCells.length - 1)) * Math.max(0, samples.length - 1)),
    t: index / Math.max(1, actualPathCells.length - 1),
    logicalOnly: true,
  }))

  const targetDeltaDeg = Number.isFinite(targetHeading) && state.axisId
    ? shortestDelta(axisAngle(state.axisId), targetHeading) * RAD
    : null
  const steeringAppliedDeg = pathResult.cappedDelta * RAD
  const reachedBoardEdge = actualSteps < requestedTravelSteps && motion.collisions.length === 0
  const verb = canonicalActionId === 'skip'
    ? 'Skip'
    : canonicalActionId === 'drive'
      ? 'Drive'
      : canonicalActionId === 'heavy-drive'
        ? 'Heavy Drive'
        : (startM > 0 ? 'Steer' : 'Move')
  const reflectionText = motion.reflectionCount > 0 ? ` · Reflect×${motion.reflectionCount}` : ''
  const summary = `${verb} · ${actualSteps} Travel / 1 AT · M${startM}→M${finalM} · Axis ${state.axisId ?? 'none'}→${finalAxis ?? 'none'}${reflectionText}`
  const conflictEvents = motion.collisions.map((collision) => ({
    kind: 'surface-reflection',
    actorId: 'player',
    ...collision,
  }))

  return {
    valid: true,
    kind: canonicalActionId,
    actionId: canonicalActionId,
    samples,
    crossings,
    pathCells: actualPathCells,
    nominalPathCells: pathResult.path.map((hex) => ({ ...hex })),
    segmentAxes: motion.reflected ? resolvedSegmentAxes : [...pathResult.segmentAxes],
    finalState,
    finalHex,
    beforeM: startM,
    builtM,
    buildM,
    finalM,
    generatedM,
    startupCompatible,
    travelDistance: actualSteps,
    travelSteps: actualSteps,
    requestedTravelSteps,
    steeringAppliedDeg,
    targetDeltaDeg,
    zeroMSettlementDeg,
    responseCurve,
    reachedBoardEdge,
    cellAuthorityRule: TRAJECTORY_CELL_AUTHORITY_RULE,
    pathRule: TRAJECTORY_PATH_RULE,
    previewRule: TRAJECTORY_PREVIEW_RULE,
    reflectionRule: TRAJECTORY_REFLECTION_RULE,
    reflectionCount: motion.reflectionCount,
    motionTrace: motion.trace,
    travelEndAxis,
    atCost: 1,
    spatialMode: 'hybrid',
    destinationDriven: false,
    visualCurveAuthoritative: true,
    collisions: motion.collisions,
    conflictEvents,
    actorTrajectories: {},
    actorPlaybackWindows: {},
    actorStates: [],
    summary,
  }
}

export function trajectoryProjectionPair(options = {}) {
  const controlled = trajectoryActionPlan(options)
  const coast = trajectoryActionPlan({ ...options, actionId: 'skip', selectedHex: null })
  return { controlled, coast }
}

export function withCoastProjection(controlledPlan, coastPlan) {
  if (!controlledPlan?.valid) return controlledPlan
  return {
    ...controlledPlan,
    samples: previewSamplesForPlan(controlledPlan),
    actorTrajectories: coastPlan?.valid ? { coastProjection: coastPlan.pathCells } : {},
    previewAxisStub: controlledPlan.finalState?.axisId ?? null,
    previewAxisStubLength: PREVIEW_END_EXTENSION,
    previewRule: TRAJECTORY_PREVIEW_RULE,
    coastPreviewAxis: coastPlan?.finalState?.axisId ?? null,
    visualCurveAuthoritative: true,
  }
}
'''
start = text.find('export function trajectoryActionPlan')
if start < 0:
    raise RuntimeError('trajectory action tail marker missing')
text = text[:start] + action_tail
p.write_text(text)


# Board3D: Trajectory supplies already-sampled curve geometry; do not Catmull-Rom it again.
p = Path('src/ui/Board3D.jsx')
text = p.read_text()
text = replace_once(
    text,
    "  const source = uniqueWorldPoints(plan.samples, y)\n  if (playerUsesWallPivot(plan)) return source",
    "  const source = uniqueWorldPoints(plan.samples, y)\n  if (plan.visualCurveAuthoritative) return source\n  if (playerUsesWallPivot(plan)) return source",
    'Board3D authoritative sample geometry',
)
p.write_text(text)


# Trajectory Lab: mount Driving-Lab wall set and pass it into preview/execute planning.
p = Path('src/labs/trajectory/TrajectoryLab.jsx')
text = p.read_text()
text = replace_once(text, "import { createCellWorld } from '../../sim/world.js'", "import { collisionObstaclesFromCells, createCellWorld } from '../../sim/world.js'", 'world import')
text = replace_once(text, "  TRAJECTORY_READY_RULE,\n  TRAJECTORY_RULE,", "  TRAJECTORY_READY_RULE,\n  TRAJECTORY_REFLECTION_RULE,\n  TRAJECTORY_RULE,", 'reflection import')
text = replace_once(text, "  const [boardRadius, setBoardRadius] = useState(TRAJECTORY_DEFAULT_RADIUS)", "  const [boardRadius, setBoardRadius] = useState(TRAJECTORY_DEFAULT_RADIUS)\n  const [obstaclesEnabled, setObstaclesEnabled] = useState(true)", 'obstacle state')
text = replace_once(text, "  const obstacles = useMemo(() => [], [])", "  const obstacles = useMemo(() => obstaclesEnabled ? collisionObstaclesFromCells(cells) : [], [cells, obstaclesEnabled])", 'obstacle world')
text = replace_once(text, "    baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n  }), [state, boardRadius, responseCurve])", "    baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n    obstacles,\n  }), [state, boardRadius, responseCurve, obstacles])", 'skip obstacles')
text = replace_once(text, "      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n    })\n    if (!plan.valid)", "      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n      obstacles,\n    })\n    if (!plan.valid)", 'execute obstacles')
text = replace_once(text, "      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n    })\n  }, [state, actionId, intentHex?.q, intentHex?.r, boardRadius, responseCurve, skipPlan])", "      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n      obstacles,\n    })\n  }, [state, actionId, intentHex?.q, intentHex?.r, boardRadius, responseCurve, skipPlan, obstacles])", 'preview obstacles')
text = replace_once(text, "      boardRadius,\n      lastEvent,", "      boardRadius,\n      obstaclesEnabled,\n      lastEvent,", 'history obstacles')
text = replace_once(text, "    setBoardRadius(TRAJECTORY_DEFAULT_RADIUS)\n    setHistory([])", "    setBoardRadius(TRAJECTORY_DEFAULT_RADIUS)\n    setObstaclesEnabled(true)\n    setHistory([])", 'reset obstacles')
text = replace_once(text, "    setBoardRadius(previous.boardRadius)\n    setLastEvent(previous.lastEvent)", "    setBoardRadius(previous.boardRadius)\n    setObstaclesEnabled(previous.obstaclesEnabled ?? true)\n    setLastEvent(previous.lastEvent)", 'undo obstacles')
text = replace_once(text, "        pathRule: TRAJECTORY_PATH_RULE,\n        steerInput", "        pathRule: TRAJECTORY_PATH_RULE,\n        reflectionRule: TRAJECTORY_REFLECTION_RULE,\n        obstaclesEnabled,\n        steerInput", 'snapshot reflection')
text = replace_once(text, "        controlledFinal: controlledPlan?.valid ? { cell: controlledPlan.finalHex, axis: controlledPlan.finalState.axisId, m: controlledPlan.finalM, path: controlledPlan.pathCells } : null,", "        controlledFinal: controlledPlan?.valid ? { cell: controlledPlan.finalHex, axis: controlledPlan.finalState.axisId, m: controlledPlan.finalM, path: controlledPlan.pathCells, reflections: controlledPlan.reflectionCount ?? 0 } : null,", 'snapshot reflection count')
text = replace_once(text, "      data-trajectory-preview={TRAJECTORY_PREVIEW_RULE}\n      data-steer-input", "      data-trajectory-preview={TRAJECTORY_PREVIEW_RULE}\n      data-trajectory-reflection={TRAJECTORY_REFLECTION_RULE}\n      data-obstacles={obstaclesEnabled ? 'on' : 'off'}\n      data-steer-input", 'data markers')
text = replace_once(text, "<span className=\"actor-sub\">Cell centers define the path · playback interpolates between them</span>", "<span className=\"actor-sub\">Cells define rule occupancy · one global curve defines visual motion</span>", 'actor copy')
text = replace_once(text, "<div className=\"section-heading\"><h3>Projection</h3><span>visited-Cell corridor curve</span></div>", "<div className=\"section-heading\"><h3>Projection</h3><span>global tangent curve</span></div>", 'projection copy')
text = replace_once(text, "              showThermal={false}\n              onHoverHex", "              showThermal={false}\n              showDebugCollisionFx={true}\n              onHoverHex", 'debug reflection fx')
text = replace_once(text, "              <span><i className=\"trajectory\" />Blue = smoothed preview inside visited Cells</span>\n              <span><i className=\"momentum-axis\" />Yellow = Skip/Coast authority path</span>\n              <span>Blue may miss intermediate centers but never enters an unvisited Cell</span>\n              <span>Preview ends near final Cell center, biased toward Ready Axis</span>", "              <span><i className=\"trajectory\" />Blue = one global visual curve</span>\n              <span><i className=\"momentum-axis\" />Yellow = discrete Skip/Coast Cell authority</span>\n              <span>Blue is not clamped to Cell centers or Cell borders</span>\n              <span>Wall contact is a real geometric breakpoint; final stub shows Ready Axis</span>", 'legend copy')
text = replace_once(text, "{playback && <div className=\"playback-badge\">1 Action · +1 AT · interpolate center → center</div>}", "{playback && <div className=\"playback-badge\">1 Action · +1 AT · continuous visual curve over discrete Travel</div>}", 'playback copy')
text = replace_once(text, "            <label className=\"range-row\">\n              <span>Board Radius</span>", "            <button type=\"button\" data-trajectory-obstacles className={obstaclesEnabled ? 'active wide-button' : 'wide-button'} disabled={Boolean(playback)} onClick={() => setObstaclesEnabled((value) => !value)}>Driving Walls · {obstaclesEnabled ? 'ON' : 'OFF'}</button>\n            <label className=\"range-row\">\n              <span>Board Radius</span>", 'wall toggle')
text = replace_once(text, "              <div><dt>Path authority</dt><dd>Cell-center polyline</dd></div>", "              <div><dt>Path authority</dt><dd>discrete Cell route</dd></div>", 'gate path')
text = replace_once(text, "              <div><dt>Wall / Strike</dt><dd>deferred</dd></div>", "              <div><dt>Wall reflection</dt><dd>Driving v1</dd></div>\n              <div><dt>Strike</dt><dd>deferred</dd></div>", 'gate reflection')
text = replace_once(text, "            <small>1 Action remains exactly 1 logical AT. Visual interpolation only occurs between consecutive Cell centers.</small>", "            <small>1 Action remains exactly 1 logical AT. Cell route is logical authority; the actor follows the authored global curve until a reflection breakpoint.</small>", 'playback help')
p.write_text(text)


# Tests: preserve discrete route semantics while locking the new curve contract and Driving reflection reuse.
p = Path('src/labs/trajectory/trajectory-rules.test.js')
p.write_text(r'''import { describe, expect, it } from 'vitest'
import { axialDistance, axialToWorld, directionIdBetween, directionVector } from '../../sim/hex.js'
import {
  TRAJECTORY_DEFAULT_RADIUS,
  TRAJECTORY_MAX_STEER_DEG,
  TRAJECTORY_PATH_RULE,
  TRAJECTORY_PREVIEW_RULE,
  TRAJECTORY_REFLECTION_RULE,
  compatibleStartupMove,
  makeTrajectoryState,
  trajectoryActionPlan,
  withCoastProjection,
} from './trajectory-rules.js'

const plan = (state, actionId, selectedHex = null, extra = {}) => trajectoryActionPlan({
  state,
  actionId,
  selectedHex,
  boardRadius: TRAJECTORY_DEFAULT_RADIUS,
  responseCurve: 'linear',
  ...extra,
})

const expectCenter = (position, hex) => {
  const center = axialToWorld(hex)
  expect(position.x).toBeCloseTo(center.x, 6)
  expect(position.z).toBeCloseTo(center.z, 6)
}

const samplePositions = (result) => result.samples.map((sample) => [
  Number(sample.position.x.toFixed(6)), Number(sample.position.z.toFixed(6)),
])

describe('VAL-012 Process Steering global-curve candidate', () => {
  it('uses two compatible M0 Moves to establish persistent M1', () => {
    const first = plan(makeTrajectoryState({ axisId: null, momentum: 0 }), 'steer', { q: 1, r: 0 })
    expect(first.finalM).toBe(0)
    expect(first.finalState.axisId).toBe('E')
    expect(first.pathCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expectCenter(first.finalState.position, { q: 1, r: 0 })

    const second = plan(first.finalState, 'steer', { q: 2, r: 0 })
    expect(second.startupCompatible).toBe(true)
    expect(second.generatedM).toBe(1)
    expect(second.finalM).toBe(1)
    expect(second.finalState.axisId).toBe('E')
  })

  it('lets M0 freely Move behind and rewrite Axis without generating incompatible M', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 0 })
    expect(compatibleStartupMove(state, { q: -1, r: 0 })).toBe(false)
    const result = plan(state, 'steer', { q: -1, r: 0 })
    expect(result.finalM).toBe(0)
    expect(result.finalState.axisId).toBe('W')
    expectCenter(result.finalState.position, { q: -1, r: 0 })
  })

  it('keeps M1 travel straight when only the zero-M Ready Axis settles afterward', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 1 })
    const result = plan(state, 'steer', { q: 1, r: -1 })
    expect(result.pathCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expect(result.segmentAxes).toEqual(['E'])
    expect(result.travelEndAxis).toBe('E')
    expect(result.finalM).toBe(0)
    expect(result.finalState.axisId).toBe('NE')
    expect(result.samples.every((sample) => Math.abs(sample.position.z) < 0.000001)).toBe(true)
  })

  it('keeps discrete Cell route authoritative without forcing visual samples through intermediate centers', () => {
    const result = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: 2, r: 1 })
    expect(result.pathRule).toBe(TRAJECTORY_PATH_RULE)
    expect(result.pathCells.length).toBe(4)
    for (let index = 1; index < result.pathCells.length; index += 1) {
      expect(axialDistance(result.pathCells[index], result.pathCells[index - 1])).toBe(1)
      expect(directionIdBetween(result.pathCells[index - 1], result.pathCells[index])).not.toBeNull()
    }
    expect(result.segmentAxes).toEqual(['E', 'E', 'SE'])
    expect(result.finalState.axisId).toBe('SE')
    expect(result.visualCurveAuthoritative).toBe(true)
    expect(result.samples.some((sample) => sample.cellCenterAnchor)).toBe(false)
    expectCenter(result.samples.at(0).position, { q: 0, r: 0 })
    expectCenter(result.samples.at(-1).position, result.finalHex)
  })

  it('keeps 60 degrees per Action as inertia while high M crosses more logical Cells', () => {
    const m1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'steer', { q: -3, r: 0 })
    const m3 = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: -3, r: 0 })
    expect(Math.abs(m1.steeringAppliedDeg)).toBeCloseTo(TRAJECTORY_MAX_STEER_DEG, 4)
    expect(Math.abs(m3.steeringAppliedDeg)).toBeCloseTo(TRAJECTORY_MAX_STEER_DEG, 4)
    expect(m1.travelSteps).toBe(1)
    expect(m3.travelSteps).toBe(3)
  })

  it('treats Skip as deliberate Coast and Drive/Heavy Drive as isolated sustain profiles', () => {
    const moving = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'skip')
    expect(moving.travelSteps).toBe(3)
    expect(moving.finalM).toBe(2)
    expect(moving.segmentAxes).toEqual(['E', 'E', 'E'])

    const drive1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'drive', { q: 3, r: 0 })
    expect(drive1.finalM).toBe(2)
    expect(drive1.travelSteps).toBe(2)

    const heavy1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'heavy-drive', { q: 4, r: 0 })
    expect(heavy1.finalM).toBe(3)
    expect(heavy1.travelSteps).toBe(3)
  })

  it('exposes both M3 turn timings on both sides of the current Axis', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const earlyNe = plan(state, 'steer', { q: 3, r: -2 })
    const lateNe = plan(state, 'steer', { q: 3, r: -1 })
    const lateSe = plan(state, 'steer', { q: 2, r: 1 })
    const earlySe = plan(state, 'steer', { q: 1, r: 2 })
    expect(earlyNe.segmentAxes).toEqual(['E', 'NE', 'NE'])
    expect(lateNe.segmentAxes).toEqual(['E', 'E', 'NE'])
    expect(lateSe.segmentAxes).toEqual(['E', 'E', 'SE'])
    expect(earlySe.segmentAxes).toEqual(['E', 'SE', 'SE'])
  })

  it('canonicalizes identical rule results to identical global curves', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const coast = plan(state, 'skip')
    const a = plan(state, 'steer', { q: 3, r: -2 })
    const b = plan(state, 'steer', { q: 4, r: -3 })
    expect(b.pathCells).toEqual(a.pathCells)
    expect(b.finalState.axisId).toBe(a.finalState.axisId)
    expect(samplePositions(withCoastProjection(b, coast))).toEqual(samplePositions(withCoastProjection(a, coast)))
  })

  it('draws a broad smooth turn with exact start/end travel tangents instead of Cell-border clamping', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const controlled = plan(state, 'steer', { q: 3, r: -2 })
    const preview = withCoastProjection(controlled, plan(state, 'skip'))
    expect(preview.previewRule).toBe(TRAJECTORY_PREVIEW_RULE)
    expect(preview.visualCurveAuthoritative).toBe(true)

    const travel = controlled.samples
    const first = travel[0].position
    const second = travel[1].position
    const beforeEnd = travel.at(-2).position
    const end = travel.at(-1).position
    const startDirection = directionVector('E')
    const endDirection = directionVector('NE')
    const startDelta = { x: second.x - first.x, z: second.z - first.z }
    const endDelta = { x: end.x - beforeEnd.x, z: end.z - beforeEnd.z }
    const startLen = Math.hypot(startDelta.x, startDelta.z)
    const endLen = Math.hypot(endDelta.x, endDelta.z)
    expect((startDelta.x * startDirection.x + startDelta.z * startDirection.z) / startLen).toBeGreaterThan(0.995)
    expect((endDelta.x * endDirection.x + endDelta.z * endDirection.z) / endLen).toBeGreaterThan(0.995)

    const chordMid = pointLerpForTest(first, end, 0.5)
    const middle = travel[Math.floor(travel.length / 2)].position
    expect(Math.hypot(middle.x - chordMid.x, middle.z - chordMid.z)).toBeGreaterThan(0.18)
  })

  it('keeps M0 straight preview straight and appends a readable final-Axis stub', () => {
    const state = makeTrajectoryState({ axisId: null, momentum: 0 })
    const controlled = plan(state, 'steer', { q: 2, r: 0 })
    const preview = withCoastProjection(controlled, plan(state, 'skip'))
    expect(preview.samples.every((sample) => Math.abs(sample.position.z) < 0.000001)).toBe(true)
    const finalCenter = controlled.finalState.position
    const end = preview.samples.at(-1).position
    expect(Math.hypot(end.x - finalCenter.x, end.z - finalCenter.z)).toBeGreaterThan(0.3)
  })

  it('reuses Driving Lab wall-pivot reflection: redirect Axis, no reflection M tax, continue remaining Travel', () => {
    const wall = { id: 'trajectory-ns-wall', hex: { q: 2, r: 0 }, kind: 'hard', wallAxis: 'NS' }
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const result = plan(state, 'steer', { q: 3, r: 0 }, { obstacles: [wall] })
    expect(result.valid).toBe(true)
    expect(result.reflectionRule).toBe(TRAJECTORY_REFLECTION_RULE)
    expect(result.reflectionCount).toBe(1)
    expect(result.collisions[0]).toMatchObject({
      wallCellPivot: true,
      wallAxis: 'NS',
      axisBefore: 'E',
      axisAfter: 'W',
      beforeM: 3,
      afterM: 3,
      wallCellTravelCost: 1,
    })
    expect(result.finalM).toBe(2)
    expect(result.finalState.axisId).toBe('W')
    expect(result.finalHex).toEqual({ q: 0, r: 0 })
    expect(result.samples.some((sample) => sample.collision)).toBe(true)
  })
})

function pointLerpForTest(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}
''')


# Browser smoke markers/copy.
p = Path('scripts/verify-trajectory-lab.mjs')
text = p.read_text()
text = replace_once(text, "data-trajectory-preview=\"canonical-result-corridor-curve-v3\"", "data-trajectory-preview=\"global-tangent-bezier-preview-v4\"", 'browser preview marker')
text = replace_once(text, "assert(dom.includes('Blue may miss intermediate centers but never enters an unvisited Cell'), 'Relaxed safe-corridor preview legend missing')\n  assert(dom.includes('Preview ends near final Cell center, biased toward Ready Axis'), 'Near-center preview ending legend missing')", "assert(dom.includes('Blue is not clamped to Cell centers or Cell borders'), 'Global unclamped visual-curve legend missing')\n  assert(dom.includes('Wall contact is a real geometric breakpoint; final stub shows Ready Axis'), 'Reflection breakpoint legend missing')\n  assert(dom.includes('data-trajectory-reflection=\"driving-lab-wall-pivot-reflection-v1\"'), 'Driving Lab reflection marker missing')\n  assert(dom.includes('data-trajectory-obstacles'), 'Trajectory Driving Walls toggle missing')", 'browser legend markers')
text = replace_once(text, "Trajectory Lab browser smoke verified: first-segment inertia, center-anchored steering curve, free M0 Move, Drive/Heavy Drive and Skip are mounted.", "Trajectory Lab browser smoke verified: global tangent curve, discrete Cell authority, Driving wall reflection, free M0 Move, Drive/Heavy Drive and Skip are mounted.", 'browser log')
p.write_text(text)

print('Trajectory v4 patch applied')
