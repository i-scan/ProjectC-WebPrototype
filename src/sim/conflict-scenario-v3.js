import {
  conflictScenario as baseConflictScenario,
  createConflictActors as baseCreateConflictActors,
} from './conflict-v2.js'

export const REFLECTED_CHAIN_SCENARIO = 'reflection-chain'

export function createConflictActors(kind = 'chain') {
  if (kind !== REFLECTED_CHAIN_SCENARIO) return baseCreateConflictActors(kind)
  return [
    { id: 'dummy-a', label: 'A', hex: { q: 4, r: -1 }, velocity: { x: 0, z: 0 }, axisId: null },
    { id: 'dummy-b', label: 'B', hex: { q: 3, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
  ]
}

export function conflictScenario(kind = 'chain') {
  if (kind !== REFLECTED_CHAIN_SCENARIO) return baseConflictScenario(kind)
  return {
    kind,
    playerHex: { q: 5, r: -2 },
    directionId: 'SW',
    momentum: 3,
    actors: createConflictActors(kind),
  }
}
