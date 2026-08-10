import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  advanceThermalInertia,
  basicMove,
  createCoupledInertiaLabState,
  createSpatialInertiaState,
  defaultRuntimeTuning,
  defaultWeaponAction,
  heavyRelease,
  holdPosition,
  injectHit,
  reconcileSpatialWithTemperature,
  resolveDrive,
  setSpatialDebug,
  setThermalDebug,
  stepWorld,
  thermalDomainFor,
} from './coupledInertia'
import { hexAdvance } from './hexTopology'

const tuning = () => defaultRuntimeTuning()

describe('VAL-012 UT4 coupled inertia', () => {
  it('damps thermal oscillation toward the set point without persistent input', () => {
    const settings = tuning()
    const start = { temperature: 4, drift: 1.5, setPoint: 0 }
    const early = advanceThermalInertia(start, 4, settings).state
    const late = advanceThermalInertia(start, 40, settings).state

    expect(Math.abs(late.temperature - late.setPoint)).toBeLessThan(Math.abs(early.temperature - early.setPoint))
    expect(Math.abs(late.drift)).toBeLessThan(Math.abs(early.drift))
    expect(Math.abs(late.temperature)).toBeLessThan(0.35)
  })

  it('uses absolute +/-3 domains and preserves M at exact zero until crossing it', () => {
    expect(thermalDomainFor(-3)).toBe('cold')
    expect(thermalDomainFor(-2.99)).toBe('neutral')
    expect(thermalDomainFor(2.99)).toBe('neutral')
    expect(thermalDomainFor(3)).toBe('hot')

    const movement = createSpatialInertiaState({ level: 3, mode: 'movement', axis: 'E', pendingLevel: 3, chainOpen: true })
    expect(reconcileSpatialWithTemperature(movement, 0).spatial.level).toBe(3)
    expect(reconcileSpatialWithTemperature(movement, -0.01).spatial.mode).toBe('none')

    const position = createSpatialInertiaState({ level: 3, mode: 'position', anchorCellId: '3,3' })
    expect(reconcileSpatialWithTemperature(position, 0).spatial.level).toBe(3)
    expect(reconcileSpatialWithTemperature(position, 0.01).spatial.mode).toBe('none')
  })

  it('builds at most one Position M for a fully cold stationary action', () => {
    let lab = createCoupledInertiaLabState()
    lab = setThermalDebug(lab, { temperature: -4, drift: 0, setPoint: -2 })
    lab = holdPosition(lab, tuning())
    expect(lab.spatialByActorId.player.mode).toBe('position')
    expect(lab.spatialByActorId.player.level).toBe(1)
    const anchor = lab.spatialByActorId.player.anchorCellId

    lab = holdPosition(lab, tuning())
    expect(lab.spatialByActorId.player.level).toBe(2)
    expect(lab.spatialByActorId.player.anchorCellId).toBe(anchor)
  })

  it('does not build Position M when the stationary action leaves Cold during its AT', () => {
    let lab = createCoupledInertiaLabState()
    lab = setThermalDebug(lab, { temperature: -3.1, drift: 3.2, setPoint: 0 })
    lab = holdPosition(lab, tuning())
    expect(lab.spatialByActorId.player.level).toBe(0)
  })

  it('uses pre-hit Position M for stability before applying hit heat', () => {
    let lab = createCoupledInertiaLabState()
    const player = getPlayer(lab.game)
    lab = setSpatialDebug(lab, 'player', { level: 3, mode: 'position', anchorCellId: `${player.position.x},${player.position.y}` })
    const origin = { ...player.position }
    const beforeDrift = lab.thermal.drift
    lab = injectHit(lab, 'heavy', 'E', tuning())

    expect(getPlayer(lab.game).position).toEqual(origin)
    expect(lab.spatialByActorId.player.level).toBe(3)
    expect(lab.thermal.drift).toBeGreaterThan(beforeDrift)
    expect(lab.worldTimeAt).toBe(0)
  })

  it('keeps Default Weapon Action separate from occupied-cell movement contest', () => {
    let lab = createCoupledInertiaLabState()
    const playerOrigin = { ...getPlayer(lab.game).position }
    const dummy = lab.game.actors.find((actor) => actor.id !== 'player')!
    lab = defaultWeaponAction(lab, dummy.id, tuning())
    expect(getPlayer(lab.game).position).toEqual(playerOrigin)
    expect(dummy.id).toBeTruthy()
    expect(lab.logs[0].detail).toContain('no Cell Contest')

    lab = createCoupledInertiaLabState()
    const target = lab.game.actors.find((actor) => actor.id !== 'player' && hexAdvance(getPlayer(lab.game).position, 'E').x === actor.position.x && hexAdvance(getPlayer(lab.game).position, 'E').y === actor.position.y)!
    const destination = { ...target.position }
    lab = setSpatialDebug(lab, 'player', { level: 3, mode: 'movement', axis: 'E' })
    lab = basicMove(lab, destination, tuning())
    expect(lab.logs[0].detail).toContain('Cell Contest')
  })

  it('converts Cold Position M into Heavy Release forced motion and self heat', () => {
    let lab = createCoupledInertiaLabState()
    const player = getPlayer(lab.game)
    const dummy = lab.game.actors.find((actor) => actor.id !== 'player' && hexAdvance(player.position, 'E').x === actor.position.x && hexAdvance(player.position, 'E').y === actor.position.y)!
    const targetOrigin = { ...dummy.position }
    lab = setSpatialDebug(lab, 'player', { level: 3, mode: 'position', anchorCellId: `${player.position.x},${player.position.y}` })
    const beforeDrift = lab.thermal.drift
    lab = heavyRelease(lab, dummy.id, tuning())

    const targetAfter = lab.game.actors.find((actor) => actor.id === dummy.id)!
    expect(targetAfter.position).not.toEqual(targetOrigin)
    expect(lab.spatialByActorId.player.level).toBe(0)
    expect(lab.thermal.drift).toBeGreaterThan(beforeDrift)
    expect(getPlayer(lab.game).position).toEqual(player.position)
  })

  it('executes Drive as three committed AT phases instead of invalidating the whole action', () => {
    let lab = createCoupledInertiaLabState()
    lab = setThermalDebug(lab, { temperature: 4, drift: 0, setPoint: 2 })
    const frames = resolveDrive(lab, 'E', tuning())
    expect(frames).toHaveLength(3)
    expect(frames.at(-1)!.state.worldTimeAt).toBe(3)
    expect(frames.some((frame) => /Contest|Redirect|Crash|Stop|Move/.test(frame.detail))).toBe(true)
  })

  it('lets manual world steps advance damping without selecting a player action', () => {
    let lab = createCoupledInertiaLabState()
    lab = setThermalDebug(lab, { temperature: 4, drift: 0, setPoint: 0 })
    lab = stepWorld(lab, 4, tuning())
    expect(lab.worldTimeAt).toBe(4)
    expect(lab.logs[0].label).toContain('Step World')
  })
})
