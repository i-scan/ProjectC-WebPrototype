export * from './spatial-inertia-v1.js'

import {
  discreteActionReachability as coreReachability,
  isDestinationDrivenAction as coreDestinationDriven,
  simulateBasicMoveRule as coreBasicMove,
  simulateDriveRule as coreDrive,
  simulatePrototypeSpatial as coreSimulate,
} from './spatial-inertia-v1.js'

const V1_SHARED_PATH_ACTIONS = new Set(['basic-move', 'drive'])

function normalizeCollisionMomentum(plan) {
  if (!plan?.valid || !plan.actionTransaction || !plan.collisions?.length) return plan
  const transaction = plan.actionTransaction
  const collisions = plan.collisions.map((collision) => {
    const transactionAlreadyCommitted = transaction.status === 'committed' && (collision.t ?? 0) > 0
    const currentM = transactionAlreadyCommitted ? transaction.toM : transaction.fromM
    return { ...collision, beforeM: currentM, afterM: currentM }
  })
  return { ...plan, collisions }
}

export function isDestinationDrivenAction(actionId, spatialMode = 'discrete') {
  if (V1_SHARED_PATH_ACTIONS.has(actionId)) return true
  return coreDestinationDriven(actionId, spatialMode)
}

export function simulateBasicMoveRule(input) {
  return normalizeCollisionMomentum(coreBasicMove(input))
}

export function simulateDriveRule(input) {
  return normalizeCollisionMomentum(coreDrive(input))
}

export function discreteActionReachability(input) {
  if (!V1_SHARED_PATH_ACTIONS.has(input.actionId ?? 'basic-move')) return coreReachability(input)
  return coreReachability({ ...input, spatialMode: 'discrete' }).map((entry) => {
    if (!entry.actionTransaction || !entry.collisions?.length) return entry
    const transaction = entry.actionTransaction
    return {
      ...entry,
      collisions: entry.collisions.map((collision) => {
        const transactionAlreadyCommitted = transaction.status === 'committed' && (collision.t ?? 0) > 0
        const currentM = transactionAlreadyCommitted ? transaction.toM : transaction.fromM
        return { ...collision, beforeM: currentM, afterM: currentM }
      }),
    }
  })
}

export function simulatePrototypeSpatial(input) {
  if (!V1_SHARED_PATH_ACTIONS.has(input.actionId)) return coreSimulate(input)
  const plan = normalizeCollisionMomentum(coreSimulate({ ...input, spatialMode: 'discrete' }))
  return { ...plan, spatialMode: input.spatialMode ?? 'discrete' }
}
