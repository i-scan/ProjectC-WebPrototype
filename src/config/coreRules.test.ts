import { describe, expect, it } from 'vitest'
import rules from '../../config/core-rules.v0.json'
import { CARD_LIBRARY, createInitialState } from '../game'
import {
  ROOM_DEFAULT_RADIUS,
  ROOM_MAX_RADIUS,
  ROOM_MIN_RADIUS,
} from '../hex/hexRoom'
import {
  TRAVEL_MAP_HEIGHT,
  TRAVEL_MAP_WIDTH,
  TRAVEL_OBJECTIVE,
  TRAVEL_START,
  TRAVEL_THREAT_RADIUS,
} from '../hex/hexTravel'

type ConfigCard = {
  id: string
  name: string
  cost: number
  range: number
  target: string
  layer?: string
}

describe('core rules config baseline', () => {
  it('keeps card identities and targeting fields aligned with CARD_LIBRARY', () => {
    const configCards = rules.cards as ConfigCard[]
    const normalize = (card: ConfigCard) => ({
      id: card.id,
      name: card.name,
      cost: card.cost,
      range: card.range,
      target: card.target,
      layer: card.layer ?? null,
    })

    expect(configCards.map(normalize)).toEqual(
      CARD_LIBRARY.map((card) =>
        normalize({
          id: card.id,
          name: card.name,
          cost: card.cost,
          range: card.range,
          target: card.target,
          layer: card.layer,
        }),
      ),
    )
  })

  it('keeps deck order and initial hand deterministic', () => {
    const cardIds = rules.cards.map((card) => card.id)
    expect(new Set(cardIds).size).toBe(cardIds.length)
    expect(rules.deck.initialOrder).toEqual(cardIds)

    const state = createInitialState()
    expect(state.hand).toEqual(rules.deck.initialOrder.slice(0, rules.deck.drawTo))
    expect(state.deck).toEqual(rules.deck.initialOrder.slice(rules.deck.drawTo))
  })

  it('keeps turn and temperature defaults aligned with GameState', () => {
    const state = createInitialState()
    expect(state.config.baseAP).toBe(rules.turn.baseAP)
    expect(state.config.maxReservedAP).toBe(rules.turn.maxReservedAP)
    expect(state.config.turnMode).toBe(rules.turn.defaultMode)
    expect(state.config.temperatureMin).toBe(rules.temperature.minimum)
    expect(state.config.temperatureMax).toBe(rules.temperature.maximum)
    expect(state.config.directTemperatureMin).toBe(rules.temperature.directMinimum)
    expect(state.config.directTemperatureMax).toBe(rules.temperature.directMaximum)
  })

  it('keeps initial actor values aligned with the config snapshot', () => {
    const state = createInitialState()

    for (const [actorId, expected] of Object.entries(rules.actors)) {
      const actor = state.actors.find((entry) => entry.id === actorId)
      expect(actor, `Missing actor ${actorId}`).toBeDefined()
      expect(actor).toMatchObject({
        hp: expected.hp,
        maxHp: expected.maxHp,
        shield: expected.shield,
        bodyTemperature: expected.bodyTemperature,
        balanceTemperature: expected.balanceTemperature,
        thermalRegulation: expected.thermalRegulation,
        thermalInsulation: expected.thermalInsulation,
        mass: expected.mass,
        attackPower: expected.attackPower,
      })
    }
  })

  it('keeps Hex room and travel profile constants aligned', () => {
    expect(ROOM_MIN_RADIUS).toBe(rules.mapProfiles.room.minimumRadius)
    expect(ROOM_MAX_RADIUS).toBe(rules.mapProfiles.room.maximumRadius)
    expect(ROOM_DEFAULT_RADIUS).toBe(rules.mapProfiles.room.defaultRadius)

    expect(TRAVEL_MAP_WIDTH).toBe(rules.mapProfiles.world.width)
    expect(TRAVEL_MAP_HEIGHT).toBe(rules.mapProfiles.world.height)
    expect(TRAVEL_START).toEqual(rules.mapProfiles.world.start)
    expect(TRAVEL_OBJECTIVE).toEqual(rules.mapProfiles.world.objective)
    expect(TRAVEL_THREAT_RADIUS).toBe(rules.mapProfiles.world.travelThreatRadius)
  })

  it('keeps cross references internally valid', () => {
    const cardIds = new Set(rules.cards.map((card) => card.id))
    for (const cardId of rules.deck.initialOrder) expect(cardIds.has(cardId)).toBe(true)

    const equipmentIds = new Set(Object.keys(rules.equipment))
    for (const equipmentId of rules.actors.player.equipment) {
      expect(equipmentIds.has(equipmentId)).toBe(true)
    }

    expect(rules.turn.availableModes).toContain(rules.turn.defaultMode)
    expect(rules.turn.phasesByMode).toHaveProperty(rules.turn.defaultMode)
    expect(rules.mapProfiles.room.defaultRadius).toBeGreaterThanOrEqual(rules.mapProfiles.room.minimumRadius)
    expect(rules.mapProfiles.room.defaultRadius).toBeLessThanOrEqual(rules.mapProfiles.room.maximumRadius)
    expect(rules.temperature.directMinimum).toBeGreaterThanOrEqual(rules.temperature.minimum)
    expect(rules.temperature.directMaximum).toBeLessThanOrEqual(rules.temperature.maximum)
  })
})
