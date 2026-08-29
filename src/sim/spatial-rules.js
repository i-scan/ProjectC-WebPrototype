export * from './spatial-inertia-v1.js'

import {
  discreteActionReachability as coreReachability,
  isDestinationDrivenAction as coreDestinationDriven,
  simulatePrototypeSpatial as coreSimulate,
} from './spatial-inertia-v1.js'

const V1_SHARED_PATH_ACTIONS = new Set(['basic-move', 'drive'])

export function isDestinationDrivenAction(actionId, spatialMode = 'discrete') {
  if (V1_SHARED_PATH_ACTIONS.has(actionId)) return true
  return coreDestinationDriven(actionId, spatialMode)
}

export function discreteActionReachability(input) {
  if (!V1_SHARED_PATH_ACTIONS.has(input.actionId ?? 'basic-move')) return coreReachability(input)
  return coreReachability({ ...input, spatialMode: 'discrete' })
}

export function simulatePrototypeSpatial(input) {
  if (!V1_SHARED_PATH_ACTIONS.has(input.actionId)) return coreSimulate(input)
  const plan = coreSimulate({ ...input, spatialMode: 'discrete' })
  return { ...plan, spatialMode: input.spatialMode ?? 'discrete' }
}
