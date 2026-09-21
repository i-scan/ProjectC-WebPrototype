import { worldToAxial } from '../../sim/hex.js'
import {
  TRAJECTORY_BASE_DISSIPATION,
  TRAJECTORY_PATH_RULE,
  TRAJECTORY_REFLECTION_RULE,
  TRAJECTORY_RULE,
  makeTrajectoryState,
  resolveTrajectoryTargetContacts,
  trajectoryActionPlan,
} from '../trajectory/trajectory-rules.js'
import { actorSpatialState, createMomentumActor, isDownSide } from './gameplay-momentum-model.js'

export const GAMEPLAY_SPATIAL_AUTHORITY = TRAJECTORY_RULE
export const GAMEPLAY_SPATIAL_PATH_RULE = TRAJECTORY_PATH_RULE
export const GAMEPLAY_SPATIAL_REFLECTION_RULE = TRAJECTORY_REFLECTION_RULE

const HORIZONTAL_ACTION_MAP = Object.freeze({
  move: 'steer',
  drive: 'drive',
  skip: 'skip',
})

export function usesTrajectoryRuntime(actor, actionId) {
  if (!HORIZONTAL_ACTION_MAP[actionId] || isDownSide(actor)) return false
  if (actionId === 'skip') return Boolean(actor.axisId || actor.hM > 0)
  return true
}

export function gameplayActorToTrajectoryState(actor, worldAt = 0) {
  return makeTrajectoryState({
    hex: actor.hex,
    axisId: actor.axisId,
    momentum: actor.hM,
    worldAt,
  })
}

export function gameplayActorToTrajectoryTarget(actor) {
  const down = isDownSide(actor)
  const spatial = actorSpatialState(actor)
  return {
    id: actor.id,
    label: actor.id,
    hex: { ...actor.hex },
    velocity: down ? { x: 0, z: 0 } : { ...spatial.velocity },
    axisId: down ? 'down' : actor.axisId,
    momentumLevel: down ? actor.downM : actor.hM,
    hp: actor.hp,
  }
}

export function trajectoryTargetToGameplayActor(resolved, original) {
  if (!resolved) return createMomentumActor(original)
  const down = String(resolved.axisId ?? '').toLowerCase() === 'down'
  return createMomentumActor({
    ...original,
    hex: resolved.hex ?? original.hex,
    hM: down ? 0 : (resolved.momentumLevel ?? 0),
    axisId: down ? null : (resolved.axisId ?? null),
    downM: down ? (resolved.momentumLevel ?? 0) : 0,
    downPrepared: down && (resolved.momentumLevel ?? 0) >= 0,
  })
}

function transitionThermal(actionId, beforeM, finalM) {
  const delta = finalM - beforeM
  if (actionId === 'skip' || delta === 0) return []
  return [{
    source: delta > 0 ? 'Active H Build' : 'Active H Spend',
    amount: Math.abs(delta),
    polarity: delta > 0 ? 'hotward' : 'coldward',
    factorKind: 'momentum',
    scope: 'source',
  }]
}

function transitionCause(actionId, plan) {
  const delta = plan.finalM - plan.beforeM
  if (actionId === 'skip') return delta < 0 ? 'Passive Dissipation' : 'Trajectory Skip'
  if (delta > 0) return 'Active H Build'
  if (delta < 0) return 'Active H Spend'
  if ((plan.reflectionCount ?? 0) > 0) return 'Surface Reflection / Redirect'
  return 'Trajectory Runtime'
}

function gameplaySamples(plan, actor, worldAt) {
  const finalActor = createMomentumActor({
    ...actor,
    hex: plan.finalHex,
    hM: plan.finalM,
    axisId: plan.finalState?.axisId ?? actor.axisId,
    downM: 0,
    downPrepared: false,
  })
  return (plan.samples ?? []).map((sample) => {
    const sampleActor = createMomentumActor({
      ...finalActor,
      hex: worldToAxial(sample.position),
      hM: Number.isFinite(sample.momentumLevel) ? sample.momentumLevel : finalActor.hM,
      axisId: sample.axisId ?? finalActor.axisId,
    })
    return {
      ...sample,
      worldAt: worldAt + Number(sample.t ?? 0),
      actor: sampleActor,
    }
  })
}

export function resolveTrajectoryGameplayAction({
  actor,
  actionId,
  targetHex = null,
  actors = [],
  boardRadius,
  obstacles = [],
  responseCurve = 'linear',
  worldAt = 0,
} = {}) {
  if (!usesTrajectoryRuntime(actor, actionId)) return null
  const trajectoryActionId = HORIZONTAL_ACTION_MAP[actionId]
  const state = gameplayActorToTrajectoryState(actor, worldAt)
  const basePlan = trajectoryActionPlan({
    state,
    actionId: trajectoryActionId,
    selectedHex: trajectoryActionId === 'skip' ? null : targetHex,
    boardRadius,
    responseCurve,
    baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
    obstacles,
  })
  if (!basePlan.valid) return { valid: false, reason: basePlan.reason, trajectoryPlan: basePlan }

  const targets = actors
    .filter((entry) => entry.id !== actor.id && entry.hp > 0)
    .map(gameplayActorToTrajectoryTarget)
  const plan = targets.length
    ? resolveTrajectoryTargetContacts(basePlan, { actors: targets, obstacles, boardRadius })
    : basePlan

  const next = createMomentumActor({
    ...actor,
    hex: plan.finalHex,
    hM: plan.finalM,
    axisId: plan.finalState?.axisId ?? actor.axisId,
    downM: 0,
    downPrepared: false,
  })
  const trace = [{
    source: actionId === 'move' ? 'Move' : actionId === 'drive' ? 'Drive' : 'Skip',
    from: `HM${plan.beforeM}`,
    to: `HM${plan.finalM}`,
    cause: transitionCause(actionId, plan),
    deltaM: plan.finalM - plan.beforeM,
    authority: TRAJECTORY_RULE,
    reflectionCount: plan.reflectionCount ?? 0,
  }]
  for (const collision of plan.collisions ?? []) {
    trace.push({
      source: 'Trajectory',
      cause: 'Surface Reflection',
      axisBefore: collision.axisBefore,
      axisAfter: collision.axisAfter,
      authority: TRAJECTORY_REFLECTION_RULE,
    })
  }

  const originalById = new Map(actors.map((entry) => [entry.id, entry]))
  const targetUpdates = (plan.actorStates ?? []).map((entry) =>
    trajectoryTargetToGameplayActor(entry, originalById.get(entry.id) ?? entry))

  return {
    valid: true,
    actor: next,
    path: (plan.pathCells ?? []).slice(1).map((hex) => ({ ...hex })),
    trace,
    // A Strike preempts the initiative transaction in the shared Trajectory
    // resolver. Do not reinterpret Transfer as an Active H Spend here.
    thermal: plan.cellConflict ? [] : transitionThermal(actionId, basePlan.beforeM, basePlan.finalM),
    trajectoryPlan: plan,
    trajectoryBasePlan: basePlan,
    trajectorySamples: gameplaySamples(plan, actor, worldAt),
    targetUpdates,
    actorTrajectories: plan.actorTrajectories ?? {},
    actorPlaybackWindows: plan.actorPlaybackWindows ?? {},
    conflictEvents: plan.conflictEvents ?? [],
    momentumEvents: plan.momentumEvents ?? [],
    cellConflict: plan.cellConflict ?? null,
    gameplayActionId: actionId,
    gameplayTargetHex: targetHex ? { ...targetHex } : null,
    authority: TRAJECTORY_RULE,
  }
}

export function trajectoryPreviewForGameplay(options = {}) {
  const resolved = resolveTrajectoryGameplayAction(options)
  if (!resolved?.valid) return resolved
  const plan = resolved.trajectoryPlan
  const originalEnemies = options.actors ?? []
  const updateById = new Map((resolved.targetUpdates ?? []).map((entry) => [entry.id, entry]))
  return {
    ...plan,
    previewOnly: true,
    samples: resolved.trajectorySamples,
    actorTrajectories: resolved.actorTrajectories,
    actorPlaybackWindows: resolved.actorPlaybackWindows,
    finalState: {
      ...plan.finalState,
      player: createMomentumActor(resolved.actor),
      enemies: originalEnemies.map((entry) => createMomentumActor(updateById.get(entry.id) ?? entry)),
    },
    spatialAuthority: TRAJECTORY_RULE,
  }
}
