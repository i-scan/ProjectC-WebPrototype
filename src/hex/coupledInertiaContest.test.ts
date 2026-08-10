import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  basicMove,
  createCoupledInertiaLabState,
  defaultRuntimeTuning,
  effectiveMovementInertiaForDirection,
  setSpatialDebug,
} from './coupledInertia'
import { hexAdvance } from './hexTopology'

describe('VAL-012 UT4 directional Cell Contest', () => {
  it('applies 60/120/reverse steering loss before Movement M contributes to occupancy power', () => {
    const tuning = defaultRuntimeTuning()
    const spatial = {
      level: 3 as const,
      mode: 'movement' as const,
      axis: 'NE' as const,
      pendingLevel: 3 as const,
      chainOpen: true,
      anchorCellId: null,
    }

    expect(effectiveMovementInertiaForDirection(spatial, 'NE', tuning)).toBe(3)
    expect(effectiveMovementInertiaForDirection(spatial, 'E', tuning)).toBe(2)
    expect(effectiveMovementInertiaForDirection(spatial, 'SE', tuning)).toBe(1)
    expect(effectiveMovementInertiaForDirection(spatial, 'SW', tuning)).toBe(0)
  })

  it('uses the steering-adjusted Movement M in an occupied-cell contest', () => {
    const tuning = defaultRuntimeTuning()
    let lab = createCoupledInertiaLabState()
    const player = getPlayer(lab.game)
    const occupiedEast = hexAdvance(player.position, 'E')

    lab = setSpatialDebug(lab, 'player', {
      level: 3,
      mode: 'movement',
      axis: 'NE',
      pendingLevel: 3,
      chainOpen: true,
    })
    lab = basicMove(lab, occupiedEast, tuning)

    expect(lab.logs[0].detail).toContain('Cell Contest 4 vs 2')
    expect(lab.logs[0].detail).toContain('Move M2')
  })
})
