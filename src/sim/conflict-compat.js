export * from './conflict-v2.js'
import { resolveCellConflicts as resolveCellConflictsV2 } from './conflict-v2.js'

export function resolveCellConflicts(input) {
  const result = resolveCellConflictsV2(input)
  if (!result?.cellConflict) return result
  return {
    ...result,
    cellConflict: {
      ...result.cellConflict,
      resolution: 'stepwise-clipped-mirror-v2',
    },
  }
}
