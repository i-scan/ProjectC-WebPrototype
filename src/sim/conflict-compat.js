export * from './conflict-v2.js'
import { resolveCellConflicts as resolveCellConflictsV2 } from './conflict-v2.js'
import { directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'

function restoreLegacyNonReflectedChainMomentum(result) {
  const events = result?.conflictEvents ?? []
  const reflectedSources = new Set(events
    .filter((event) => event.kind === 'momentum-transfer' && event.reflectedSource)
    .map((event) => event.sourceActorId))
  const legacySourceM = new Map()
  for (const event of events) {
    if (event.kind !== 'momentum-transfer' || event.model !== 'chain-decay-prototype') continue
    if (!event.sourceActorId || reflectedSources.has(event.sourceActorId)) continue
    legacySourceM.set(event.sourceActorId, event.sourceBeforeM)
  }
  if (!legacySourceM.size) return result

  const restoreActor = (actor) => {
    const level = legacySourceM.get(actor.id)
    if (level == null || !actor.axisId) return actor
    const direction = directionVector(actor.axisId)
    const speed = momentumSpeed(level)
    return {
      ...actor,
      velocity: { x: direction.x * speed, z: direction.z * speed },
    }
  }

  const actorStates = (result.actorStates ?? []).map(restoreActor)
  const finalActors = (result.finalState?.actors ?? actorStates).map(restoreActor)
  return {
    ...result,
    actorStates,
    finalState: result.finalState ? { ...result.finalState, actors: finalActors } : result.finalState,
  }
}

export function resolveCellConflicts(input) {
  const resolved = restoreLegacyNonReflectedChainMomentum(resolveCellConflictsV2(input))
  if (!resolved?.cellConflict) return resolved
  return {
    ...resolved,
    cellConflict: {
      ...resolved.cellConflict,
      resolution: 'stepwise-clipped-mirror-v2',
    },
  }
}
