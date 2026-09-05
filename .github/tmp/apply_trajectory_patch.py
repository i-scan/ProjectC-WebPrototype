from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual < count:
        raise SystemExit(f'{path}: expected at least {count} occurrences, found {actual}: {old[:120]!r}')
    text = text.replace(old, new, count)
    p.write_text(text)


rules = 'src/labs/trajectory/trajectory-rules.js'
replace(rules,
    "import { runCellMotion } from '../../sim/cell-motion.js'\n",
    "import { runCellMotion } from '../../sim/cell-motion.js'\nimport { createConflictActors, resolveCellConflicts } from '../../sim/conflict.js'\n")
replace(rules,
    "export const TRAJECTORY_REFLECTION_RULE = 'driving-lab-wall-pivot-reflection-v1'\n",
    "export const TRAJECTORY_REFLECTION_RULE = 'driving-lab-wall-pivot-reflection-v1'\nexport const TRAJECTORY_COAST_REFLECTION_INTENT_RULE = 'coast-reflection-path-selectable-intent-v1'\nexport const TRAJECTORY_TARGET_RULE = 'trajectory-target-contact-existing-strike-v1'\n")
replace(rules,
    "const clamp = (value, min, max) => Math.max(min, Math.min(max, value))\n",
    "const clamp = (value, min, max) => Math.max(min, Math.min(max, value))\nconst sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)\n")
replace(rules,
    "export function steeringBearingFromCell(state, selectedHex) {\n",
    "export function createTrajectoryTargets(boardRadius = TRAJECTORY_DEFAULT_RADIUS) {\n  return createConflictActors('chain')\n    .filter((actor) => axialDistance(actor.hex) <= boardRadius)\n    .map((actor) => ({ ...actor, hex: { ...actor.hex }, velocity: { ...(actor.velocity ?? { x: 0, z: 0 }) }, momentumLevel: 0 }))\n}\n\nexport function trajectoryCoastIntentMatches(coastPlan, hex) {\n  if (!coastPlan?.valid || (coastPlan.reflectionCount ?? 0) <= 0 || !hex) return false\n  return (coastPlan.pathCells ?? []).slice(1).some((cell) => sameHex(cell, hex))\n}\n\nexport function steeringBearingFromCell(state, selectedHex) {\n")
replace(rules,
    "  obstacles = [],\n} = {}) {\n  const profile = profileFor(actionId)\n  const canonicalActionId = profile.id\n  const startM = trajectoryMomentum(state)\n  const targetHeading = profile.needsDirection && selectedHex ? steeringBearingFromCell(state, selectedHex) : null\n",
    "  obstacles = [],\n  intentAxisId = null,\n} = {}) {\n  const profile = profileFor(actionId)\n  const canonicalActionId = profile.id\n  const startM = trajectoryMomentum(state)\n  const targetHeading = profile.needsDirection\n    ? (intentAxisId ? axisAngle(intentAxisId) : selectedHex ? steeringBearingFromCell(state, selectedHex) : null)\n    : null\n")
replace(rules,
    "    targetHex: selectedHex,\n",
    "    targetHex: intentAxisId ? null : selectedHex,\n")
replace(rules,
    "    reflectionRule: TRAJECTORY_REFLECTION_RULE,\n    reflectionCount: motion.reflectionCount,\n",
    "    reflectionRule: TRAJECTORY_REFLECTION_RULE,\n    coastIntentRule: TRAJECTORY_COAST_REFLECTION_INTENT_RULE,\n    intentAxisId: intentAxisId ?? null,\n    reflectionCount: motion.reflectionCount,\n")

insertion = r'''
function contactCurveSamples(plan, resolved) {
  if (!resolved?.cellConflict || !plan?.samples?.length) return plan?.samples ?? []
  const contactHex = resolved.cellConflict.playerCell
  const logicalIndex = Math.max(0, (plan.pathCells ?? []).findIndex((cell) => sameHex(cell, contactHex)))
  const crossing = plan.crossings?.[logicalIndex]
  const sampleIndex = clamp(
    Number.isFinite(crossing?.sampleIndex) ? crossing.sampleIndex : Math.round((logicalIndex / Math.max(1, (plan.pathCells?.length ?? 1) - 1)) * (plan.samples.length - 1)),
    0,
    Math.max(0, plan.samples.length - 1),
  )
  const samples = plan.samples.slice(0, Math.max(1, sampleIndex + 1)).map((sample) => ({
    ...sample,
    position: { ...sample.position },
    velocity: { ...(sample.velocity ?? { x: 0, z: 0 }) },
  }))
  const finalPosition = resolved.finalState.position
  const last = samples.at(-1) ?? plan.samples[0]
  const endSample = {
    ...last,
    position: { ...finalPosition },
    velocity: { ...(resolved.finalState.velocity ?? { x: 0, z: 0 }) },
    axisId: resolved.finalState.axisId ?? last?.axisId ?? null,
    momentumLevel: resolved.finalM ?? 0,
    collision: true,
  }
  const prior = samples.at(-1)
  if (!prior || Math.hypot(prior.position.x - finalPosition.x, prior.position.z - finalPosition.z) > 0.001) samples.push(endSample)
  else samples[samples.length - 1] = endSample
  return retimeVisualSamples(samples, { ...resolved.finalState, momentumLevel: resolved.finalM ?? 0 })
}

export function resolveTrajectoryTargetContacts(plan, {
  actors = [],
  obstacles = [],
  boardRadius = TRAJECTORY_DEFAULT_RADIUS,
} = {}) {
  if (!plan?.valid) return plan
  if (!actors.length) return plan
  const activeM = Math.max(0, plan.beforeM ?? 0, plan.builtM ?? 0)
  const collisionPlan = {
    ...plan,
    spatialMode: 'discrete',
    traversedCells: (plan.pathCells ?? []).map((hex) => ({ ...hex })),
    beforeM: activeM,
    axisBefore: plan.samples?.[0]?.axisId ?? plan.travelEndAxis ?? plan.finalState?.axisId ?? null,
    axisAfter: plan.finalState?.axisId ?? plan.travelEndAxis ?? null,
    actionTransaction: {
      rule: 'trajectory-active-m-until-action-end-v1',
      fromM: activeM,
      toM: activeM,
      cause: 'Active M',
      status: 'pending',
    },
  }
  const resolved = resolveCellConflicts({ plan: collisionPlan, actors, obstacles, boardRadius })
  const finalM = resolved.cellConflict ? (resolved.finalM ?? 0) : plan.finalM
  const finalState = {
    ...resolved.finalState,
    momentumLevel: finalM,
    heading: resolved.finalState?.axisId ? axisAngle(resolved.finalState.axisId) : null,
  }
  return {
    ...resolved,
    samples: resolved.cellConflict ? contactCurveSamples(plan, { ...resolved, finalState }) : plan.samples,
    pathCells: (resolved.traversedCells ?? plan.pathCells ?? []).map((hex) => ({ ...hex })),
    finalHex: worldToAxial(finalState.position),
    finalState,
    finalM,
    spatialMode: 'hybrid',
    visualCurveAuthoritative: true,
    targetRule: TRAJECTORY_TARGET_RULE,
    conflictEvents: [...(plan.conflictEvents ?? []), ...(resolved.conflictEvents ?? [])],
  }
}

'''
replace(rules,
    "export function trajectoryProjectionPair(options = {}) {\n",
    insertion + "export function trajectoryProjectionPair(options = {}) {\n")
replace(rules,
    "    actorTrajectories: coastPlan?.valid ? { coastProjection: coastPlan.pathCells } : {},\n",
    "    actorTrajectories: {\n      ...(controlledPlan.actorTrajectories ?? {}),\n      ...(coastPlan?.valid ? { coastProjection: coastPlan.pathCells } : {}),\n    },\n    actorPlaybackWindows: controlledPlan.actorPlaybackWindows ?? {},\n    actorTrajectoryPolylineIds: [\n      ...(controlledPlan.actorTrajectoryPolylineIds ?? []),\n      ...((coastPlan?.reflectionCount ?? 0) > 0 ? ['coastProjection'] : []),\n    ],\n    coastProjectionReflectionCount: coastPlan?.reflectionCount ?? 0,\n")

board = 'src/ui/Board3D.jsx'
replace(board,
    "    const wallActors = wallPivotActorIds(previewPlan.conflictEvents ?? [])\n    const wallPolyline = playerUsesWallPivot(previewPlan) || wallActors.size > 0\n",
    "    const wallActors = wallPivotActorIds(previewPlan.conflictEvents ?? [])\n    const actorPolylineIds = new Set(previewPlan.actorTrajectoryPolylineIds ?? [])\n    const wallPolyline = playerUsesWallPivot(previewPlan) || wallActors.size > 0 || actorPolylineIds.size > 0\n")
replace(board,
    "      const points = trajectoryPathPoints(path, 0.34, wallActors.has(id))\n",
    "      const points = trajectoryPathPoints(path, 0.34, wallActors.has(id) || actorPolylineIds.has(id))\n")

lab = 'src/labs/trajectory/TrajectoryLab.jsx'
replace(lab,
    "  makeTrajectoryState,\n  trajectoryActionPlan,\n  trajectoryHeading,\n  trajectoryMomentum,\n  trajectoryProjectionPair,\n  withCoastProjection,\n",
    "  createTrajectoryTargets,\n  makeTrajectoryState,\n  resolveTrajectoryTargetContacts,\n  trajectoryActionPlan,\n  trajectoryCoastIntentMatches,\n  trajectoryHeading,\n  trajectoryMomentum,\n  withCoastProjection,\n")
replace(lab,
    "    actorTrajectories: {},\n    actorPlaybackWindows: {},\n    actorStates: [],\n    playerPlaybackEnd: 1,\n",
    "    actorTrajectories: plan.actorTrajectories ?? {},\n    actorPlaybackWindows: plan.actorPlaybackWindows ?? {},\n    actorStates: plan.actorStates ?? [],\n    playerPlaybackEnd: plan.playerPlaybackEnd ?? 1,\n")
replace(lab,
    "    actorTrajectories: { coastProjection: coastPlan.pathCells ?? [] },\n",
    "    actorTrajectories: { ...(coastPlan.actorTrajectories ?? {}), coastProjection: coastPlan.pathCells ?? [] },\n    actorPlaybackWindows: coastPlan.actorPlaybackWindows ?? {},\n    actorTrajectoryPolylineIds: [\n      ...(coastPlan.actorTrajectoryPolylineIds ?? []),\n      ...((coastPlan.reflectionCount ?? 0) > 0 ? ['coastProjection'] : []),\n    ],\n")
replace(lab,
    "  const [boardRadius, setBoardRadius] = useState(TRAJECTORY_DEFAULT_RADIUS)\n  const [obstaclesEnabled, setObstaclesEnabled] = useState(true)\n",
    "  const [boardRadius, setBoardRadius] = useState(TRAJECTORY_DEFAULT_RADIUS)\n  const [wallsEnabled, setWallsEnabled] = useState(true)\n  const [targetsEnabled, setTargetsEnabled] = useState(true)\n  const [actors, setActors] = useState(() => createTrajectoryTargets(TRAJECTORY_DEFAULT_RADIUS))\n")
replace(lab,
    "  const obstacles = useMemo(() => obstaclesEnabled ? collisionObstaclesFromCells(cells) : [], [cells, obstaclesEnabled])\n",
    "  const obstacles = useMemo(() => wallsEnabled ? collisionObstaclesFromCells(cells).filter((entry) => entry.wallAxis) : [], [cells, wallsEnabled])\n")
replace(lab,
    "  const skipPlan = useMemo(() => trajectoryActionPlan({\n    state,\n    actionId: 'skip',\n    boardRadius,\n    responseCurve,\n    baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n    obstacles,\n  }), [state, boardRadius, responseCurve, obstacles])\n\n  const intentHex = directionalAction ? (hoverHex ?? selectedHex) : null\n  const pair = useMemo(() => {\n    if (!intentHex) return { controlled: null, coast: skipPlan }\n    return trajectoryProjectionPair({\n      state,\n      actionId,\n      selectedHex: intentHex,\n      boardRadius,\n      responseCurve,\n      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n      obstacles,\n    })\n  }, [state, actionId, intentHex?.q, intentHex?.r, boardRadius, responseCurve, skipPlan, obstacles])\n\n  const controlledPlan = pair.controlled\n",
    "  const skipPlan = useMemo(() => {\n    const base = trajectoryActionPlan({\n      state,\n      actionId: 'skip',\n      boardRadius,\n      responseCurve,\n      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n      obstacles,\n    })\n    return targetsEnabled ? resolveTrajectoryTargetContacts(base, { actors, obstacles, boardRadius }) : base\n  }, [state, boardRadius, responseCurve, obstacles, targetsEnabled, actors])\n\n  const intentHex = directionalAction ? (hoverHex ?? selectedHex) : null\n  const coastIntentAxis = intentHex && trajectoryCoastIntentMatches(skipPlan, intentHex) ? state.axisId : null\n  const controlledPlan = useMemo(() => {\n    if (!intentHex) return null\n    const base = trajectoryActionPlan({\n      state,\n      actionId,\n      selectedHex: intentHex,\n      intentAxisId: coastIntentAxis,\n      boardRadius,\n      responseCurve,\n      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n      obstacles,\n    })\n    return targetsEnabled ? resolveTrajectoryTargetContacts(base, { actors, obstacles, boardRadius }) : base\n  }, [state, actionId, intentHex?.q, intentHex?.r, coastIntentAxis, boardRadius, responseCurve, obstacles, targetsEnabled, actors])\n")
replace(lab,
    "      boardRadius,\n      obstaclesEnabled,\n      lastEvent,\n",
    "      boardRadius,\n      wallsEnabled,\n      targetsEnabled,\n      actors: structuredClone(actors),\n      lastEvent,\n")
replace(lab,
    "      setState(playback.finalState)\n      setLastPlan(playback)\n",
    "      setState(playback.finalState)\n      if (targetsEnabled) setActors(structuredClone(playback.actorStates ?? actors))\n      setLastPlan(playback)\n")
replace(lab,
    "    const plan = trajectoryActionPlan({\n      state,\n      actionId: forcedActionId,\n      selectedHex: hex,\n      boardRadius,\n      responseCurve,\n      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n      obstacles,\n    })\n    if (!plan.valid) return false\n",
    "    const intentAxisId = trajectoryCoastIntentMatches(skipPlan, hex) ? state.axisId : null\n    const base = trajectoryActionPlan({\n      state,\n      actionId: forcedActionId,\n      selectedHex: hex,\n      intentAxisId,\n      boardRadius,\n      responseCurve,\n      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,\n      obstacles,\n    })\n    const plan = targetsEnabled ? resolveTrajectoryTargetContacts(base, { actors, obstacles, boardRadius }) : base\n    if (!plan.valid) return false\n")
replace(lab,
    "    setBoardRadius(TRAJECTORY_DEFAULT_RADIUS)\n    setObstaclesEnabled(true)\n",
    "    setBoardRadius(TRAJECTORY_DEFAULT_RADIUS)\n    setWallsEnabled(true)\n    setTargetsEnabled(true)\n    setActors(createTrajectoryTargets(TRAJECTORY_DEFAULT_RADIUS))\n")
replace(lab,
    "    setLastPlan(null)\n    setHistory([])\n    setLastEvent(level === 0 && !axisId\n",
    "    setLastPlan(null)\n    if (targetsEnabled) setActors(createTrajectoryTargets(boardRadius))\n    setHistory([])\n    setLastEvent(level === 0 && !axisId\n")
replace(lab,
    "    setLastPlan(null)\n    setHistory([])\n    setCameraResetToken((value) => value + 1)\n    setLastEvent(`Board Radius changed to ${next}. Scene reset to E / M2.`)\n",
    "    setLastPlan(null)\n    if (targetsEnabled) setActors(createTrajectoryTargets(next))\n    setHistory([])\n    setCameraResetToken((value) => value + 1)\n    setLastEvent(`Board Radius changed to ${next}. Scene reset to E / M2.`)\n")
replace(lab,
    "    setBoardRadius(previous.boardRadius)\n    setObstaclesEnabled(previous.obstaclesEnabled ?? true)\n    setLastEvent(previous.lastEvent)\n",
    "    setBoardRadius(previous.boardRadius)\n    setWallsEnabled(previous.wallsEnabled ?? true)\n    setTargetsEnabled(previous.targetsEnabled ?? true)\n    setActors(structuredClone(previous.actors ?? createTrajectoryTargets(previous.boardRadius)))\n    setLastEvent(previous.lastEvent)\n")
replace(lab,
    "  const switchToA = () => { window.location.hash = 'hex-prototype' }\n",
    "  const toggleWalls = () => {\n    if (playback) return false\n    setWallsEnabled((value) => !value)\n    setHoverHex(null)\n    setSelectedHex(null)\n    setLastPlan(null)\n    return true\n  }\n\n  const toggleTargets = () => {\n    if (playback) return false\n    const next = !targetsEnabled\n    setTargetsEnabled(next)\n    setActors(next ? createTrajectoryTargets(boardRadius) : [])\n    setHoverHex(null)\n    setSelectedHex(null)\n    setLastPlan(null)\n    return true\n  }\n\n  const switchToA = () => { window.location.hash = 'hex-prototype' }\n")
replace(lab,
    "        reflectionRule: TRAJECTORY_REFLECTION_RULE,\n        obstaclesEnabled,\n",
    "        reflectionRule: TRAJECTORY_REFLECTION_RULE,\n        wallsEnabled,\n        targetsEnabled,\n        targetCount: actors.length,\n")
replace(lab,
    "      setRadius: changeRadius,\n      setAction: chooseDirectional,\n",
    "      setRadius: changeRadius,\n      setWalls: (enabled) => { if (Boolean(enabled) !== wallsEnabled) return toggleWalls(); return true },\n      setTargets: (enabled) => { if (Boolean(enabled) !== targetsEnabled) return toggleTargets(); return true },\n      setAction: chooseDirectional,\n")
replace(lab,
    "      data-trajectory-reflection={TRAJECTORY_REFLECTION_RULE}\n      data-obstacles={obstaclesEnabled ? 'on' : 'off'}\n",
    "      data-trajectory-reflection={TRAJECTORY_REFLECTION_RULE}\n      data-walls={wallsEnabled ? 'on' : 'off'}\n      data-targets={targetsEnabled ? 'on' : 'off'}\n")
replace(lab,
    "              actors={[]}\n",
    "              actors={actors}\n")
replace(lab,
    "              <div className=\"vector-row yellow\"><i>➜</i><span>Yellow · Skip/Coast baseline</span></div>\n",
    "              <div className=\"vector-row yellow\"><i>➜</i><span>Yellow · Skip/Coast baseline{(skipPlan?.reflectionCount ?? 0) > 0 ? ' · reflected Cells selectable as forward intent' : ''}</span></div>\n")
replace(lab,
    "            <button type=\"button\" data-trajectory-obstacles className={obstaclesEnabled ? 'active wide-button' : 'wide-button'} disabled={Boolean(playback)} onClick={() => setObstaclesEnabled((value) => !value)}>Driving Walls · {obstaclesEnabled ? 'ON' : 'OFF'}</button>\n",
    "            <button type=\"button\" data-trajectory-walls className={wallsEnabled ? 'active wide-button' : 'wide-button'} disabled={Boolean(playback)} onClick={toggleWalls}>Walls · {wallsEnabled ? 'ON' : 'OFF'}</button>\n            <button type=\"button\" data-trajectory-targets className={targetsEnabled ? 'active wide-button' : 'wide-button'} disabled={Boolean(playback)} onClick={toggleTargets}>Targets · {targetsEnabled ? `ON · ${actors.length}` : 'OFF'}</button>\n")
replace(lab,
    "              <div><dt>Wall reflection</dt><dd>Driving v1</dd></div>\n              <div><dt>Strike</dt><dd>deferred</dd></div>\n",
    "              <div><dt>Wall reflection</dt><dd>Driving v1</dd></div>\n              <div><dt>Coast intent</dt><dd>reflected path selectable</dd></div>\n              <div><dt>Target Contact</dt><dd>existing Strike / Forced Move</dd></div>\n")

tests = 'src/labs/trajectory/trajectory-rules.test.js'
replace(tests,
    "  TRAJECTORY_REFLECTION_RULE,\n  compatibleStartupMove,\n  makeTrajectoryState,\n  trajectoryActionPlan,\n  withCoastProjection,\n",
    "  TRAJECTORY_REFLECTION_RULE,\n  compatibleStartupMove,\n  makeTrajectoryState,\n  resolveTrajectoryTargetContacts,\n  trajectoryActionPlan,\n  trajectoryCoastIntentMatches,\n  withCoastProjection,\n")
new_tests = r'''

  it('preserves the reflected yellow Coast projection as a polyline instead of smoothing through the wall pivot', () => {
    const state = makeTrajectoryState({ hex: { q: 4, r: 0 }, axisId: 'E', momentum: 2 })
    const coast = plan(state, 'skip', null, { boardRadius: 4 })
    expect(coast.reflectionCount).toBeGreaterThan(0)
    const controlled = plan(state, 'steer', { q: 3, r: 0 }, { boardRadius: 4, intentAxisId: 'E' })
    const preview = withCoastProjection(controlled, coast)
    expect(preview.actorTrajectoryPolylineIds).toContain('coastProjection')
    expect(preview.coastProjectionReflectionCount).toBe(coast.reflectionCount)
  })

  it('lets Move/Steer and Drive select a reflected Coast Cell as forward reflection intent', () => {
    const state = makeTrajectoryState({ hex: { q: 4, r: 0 }, axisId: 'E', momentum: 2 })
    const coast = plan(state, 'skip', null, { boardRadius: 4 })
    expect(coast.reflectionCount).toBeGreaterThan(0)
    expect(trajectoryCoastIntentMatches(coast, { q: 3, r: 0 })).toBe(true)

    const steer = plan(state, 'steer', { q: 3, r: 0 }, { boardRadius: 4, intentAxisId: 'E' })
    expect(steer.reflectionCount).toBeGreaterThan(0)
    expect(steer.collisions[0].axisBefore).toBe('E')

    const drive = plan(state, 'drive', { q: 3, r: 0 }, { boardRadius: 4, intentAxisId: 'E' })
    expect(drive.reflectionCount).toBeGreaterThan(0)
    expect(drive.collisions[0].axisBefore).toBe('E')
    expect(drive.requestedTravelSteps).toBe(3)
  })

  it('reuses existing Strike / Forced Move when an enabled Target occupies a logical Trajectory Cell', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 2 })
    const base = plan(state, 'steer', { q: 2, r: 0 })
    const target = { id: 'trajectory-test-target', label: 'T', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null, momentumLevel: 0 }
    const resolved = resolveTrajectoryTargetContacts(base, { actors: [target], boardRadius: 6, obstacles: [] })
    expect(resolved.targetRule).toBe('trajectory-target-contact-existing-strike-v1')
    expect(resolved.cellConflict?.targetActorId).toBe(target.id)
    expect(resolved.conflictEvents.some((event) => event.kind === 'cell-conflict')).toBe(true)
    expect(resolved.actorStates[0].hex).not.toEqual(target.hex)
    expect(resolved.finalM).toBe(0)
    expect(resolved.visualCurveAuthoritative).toBe(true)
  })
'''
replace(tests, "  it('reuses Driving Lab wall-pivot reflection without an extra M tax', () => {", new_tests + "\n  it('reuses Driving Lab wall-pivot reflection without an extra M tax', () => {")

smoke = 'scripts/verify-trajectory-lab.mjs'
replace(smoke,
    "  assert(dom.includes('data-trajectory-obstacles'), 'Trajectory Driving Walls toggle missing')\n",
    "  assert(dom.includes('data-trajectory-walls'), 'Trajectory Walls toggle missing')\n  assert(dom.includes('data-trajectory-targets'), 'Trajectory Targets toggle missing')\n  assert(dom.includes('data-walls=\"on\"') && dom.includes('data-targets=\"on\"'), 'Trajectory default test toggles must start enabled')\n  assert(dom.includes('reflected Cells selectable as forward intent') || dom.includes('Coast intent'), 'Selectable reflected Coast intent marker missing')\n")
replace(smoke,
    "  console.log('Trajectory Lab browser smoke verified: global tangent curve, discrete Cell authority, Driving wall reflection, free M0 Move, Drive/Heavy Drive and Skip are mounted.')\n",
    "  console.log('Trajectory Lab browser smoke verified: reflected Coast polyline, selectable reflection intent, Target/Wall toggles, global curve, Drive/Heavy Drive and Skip are mounted.')\n")
