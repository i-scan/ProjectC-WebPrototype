import { CARD_LIBRARY, distance, getPlayer, type Card, type Coord, type GameState } from '../game'
import type { VisualEvent } from './InteractiveThreeBoard'

export type VisualEffect =
  | 'move'
  | 'attack'
  | 'guard'
  | 'heat'
  | 'cool'
  | 'card-play'
  | 'draw'
  | 'discard'
  | 'freeze'
  | 'melt'
  | 'ignite'
  | 'vapor'
  | 'cloud'
  | 'wind'
  | 'rain-intent'
  | 'rain'
  | 'phase'
  | 'reset'

export type PlaybackEvent = VisualEvent & {
  label?: string
  durationAt?: number
  amount?: number
  actorId?: string
  sourceActorId?: string
  cardIds?: string[]
  effect?: VisualEffect
  direction?: string | null
}

let cueSequence = 0

function nextId() {
  cueSequence += 1
  return Date.now() * 100 + (cueSequence % 100)
}

function keyOf(coord: Coord) {
  return `${coord.x},${coord.y}`
}

function sameCoord(a: Coord, b: Coord) {
  return a.x === b.x && a.y === b.y
}

function multisetDifference(source: string[], target: string[]) {
  const counts = new Map<string, number>()
  for (const value of target) counts.set(value, (counts.get(value) ?? 0) + 1)
  const result: string[] = []
  for (const value of source) {
    const count = counts.get(value) ?? 0
    if (count > 0) counts.set(value, count - 1)
    else result.push(value)
  }
  return result
}

function cardName(cardId: string) {
  return CARD_LIBRARY.find((card) => card.id === cardId)?.name ?? cardId
}

function cardKind(card?: Card): VisualEvent['kind'] {
  if (!card) return 'phase'
  if (card.effect === 'cool-cell' || card.effect === 'cold-strike') return 'cool'
  if (card.effect === 'heat-cell' || card.effect === 'hot-strike' || card.effect === 'grip') return 'heat'
  if (card.effect === 'guard' || card.effect === 'temper') return 'guard'
  return 'attack'
}

function pushCue(events: PlaybackEvent[], cue: Omit<PlaybackEvent, 'id'>) {
  if (events.length >= 20) return
  events.push({ id: nextId(), ...cue })
}

export function buildVisualEvents(
  before: GameState,
  after: GameState,
  fallbackTarget?: Coord,
): PlaybackEvent[] {
  const events: PlaybackEvent[] = []
  const removedCards = multisetDifference(before.hand, after.hand)
  const drawnCards = multisetDifference(after.hand, before.hand)
  const discardGrowth = after.discard.length - before.discard.length

  if (removedCards.length === 1 && before.phase === 'player' && after.phase === 'player' && discardGrowth > 0) {
    const card = CARD_LIBRARY.find((entry) => entry.id === removedCards[0])
    pushCue(events, {
      kind: cardKind(card),
      effect: 'card-play',
      target: fallbackTarget,
      cardIds: removedCards,
      label: `打出「${cardName(removedCards[0])}」`,
    })
  } else if (removedCards.length > 0) {
    pushCue(events, {
      kind: 'phase',
      effect: 'discard',
      target: fallbackTarget,
      cardIds: removedCards,
      amount: removedCards.length,
      label: `回合结束：弃置 ${removedCards.length} 张手牌`,
    })
  }

  const beforeActors = new Map(before.actors.map((actor) => [actor.id, actor]))
  const playerAfter = getPlayer(after)

  for (const actor of after.actors) {
    const previous = beforeActors.get(actor.id)
    if (!previous) continue

    if (!sameCoord(previous.position, actor.position)) {
      pushCue(events, {
        kind: 'move',
        effect: 'move',
        target: actor.position,
        actorId: actor.id,
        label: `${actor.name} 移动到 (${actor.position.x},${actor.position.y})`,
      })
    }

    if (actor.hp < previous.hp) {
      let sourceActorId: string | undefined
      if (actor.actorType === 'player') {
        sourceActorId = after.actors.find((candidate) =>
          candidate.alive && candidate.faction === 'enemy' && distance(candidate.position, actor.position) === 1,
        )?.id
      } else if (actor.faction === 'enemy') {
        sourceActorId = playerAfter.id
      }
      pushCue(events, {
        kind: 'attack',
        effect: 'attack',
        target: actor.position,
        actorId: actor.id,
        sourceActorId,
        amount: previous.hp - actor.hp,
        label: `${actor.name} 受到 ${previous.hp - actor.hp} 点伤害`,
      })
    }

    if (actor.shield > previous.shield) {
      pushCue(events, {
        kind: 'guard',
        effect: 'guard',
        target: actor.position,
        actorId: actor.id,
        amount: actor.shield - previous.shield,
        label: `${actor.name} 获得 Shield +${actor.shield - previous.shield}`,
      })
    }

    if (actor.bodyTemperature !== previous.bodyTemperature) {
      const delta = actor.bodyTemperature - previous.bodyTemperature
      pushCue(events, {
        kind: delta > 0 ? 'heat' : 'cool',
        effect: delta > 0 ? 'heat' : 'cool',
        target: actor.position,
        actorId: actor.id,
        amount: Math.abs(delta),
        label: `${actor.name} 体温 ${delta > 0 ? '+' : ''}${delta}`,
      })
    }
  }

  const beforeCells = new Map(before.cells.map((cell) => [keyOf(cell.coord), cell]))
  for (const cell of after.cells) {
    const previous = beforeCells.get(keyOf(cell.coord))
    if (!previous) continue

    if (cell.groundFill !== previous.groundFill) {
      let effect: VisualEffect = cell.groundFill === 'ice'
        ? 'freeze'
        : previous.groundFill === 'ice' && cell.groundFill === 'water'
          ? 'melt'
          : cell.groundFill === 'fire'
            ? 'ignite'
            : previous.groundFill === 'fire' && cell.groundFill === 'none'
              ? 'rain'
              : cell.groundTemp >= previous.groundTemp
                ? 'heat'
                : 'cool'
      const kind: VisualEvent['kind'] = ['freeze', 'cool'].includes(effect) ? 'cool' : effect === 'rain' ? 'phase' : 'heat'
      pushCue(events, {
        kind,
        effect,
        target: cell.coord,
        label: `${previous.groundFill} → ${cell.groundFill}`,
      })
    }

    if (cell.groundTemp !== previous.groundTemp) {
      const delta = cell.groundTemp - previous.groundTemp
      pushCue(events, {
        kind: delta > 0 ? 'heat' : 'cool',
        effect: delta > 0 ? 'heat' : 'cool',
        target: cell.coord,
        amount: Math.abs(delta),
        label: `Ground (${cell.coord.x},${cell.coord.y}) 温度 ${delta > 0 ? '+' : ''}${delta}`,
      })
    }

    const previousRainIntent = previous.intents.some((intent) => intent.type === 'rain')
    const currentRainIntent = cell.intents.some((intent) => intent.type === 'rain')

    if (previous.skyFill !== cell.skyFill) {
      const becameCloud = previous.skyFill === 'clear' && cell.skyFill === 'cloud'
      const rainResolved = previous.skyFill === 'cloud' && cell.skyFill === 'clear' && cell.moisture > previous.moisture
      pushCue(events, {
        kind: becameCloud ? 'heat' : 'phase',
        effect: rainResolved ? 'rain' : becameCloud && previous.groundFill === 'water' ? 'vapor' : becameCloud ? 'cloud' : 'phase',
        target: cell.coord,
        label: rainResolved
          ? `降雨结算：Sky 清空，Ground 湿度上升`
          : becameCloud && previous.groundFill === 'water'
            ? `Water 蒸发并在 Sky 形成 Cloud`
            : `Sky ${previous.skyFill} → ${cell.skyFill}`,
      })
    }

    if (cell.wind !== previous.wind) {
      pushCue(events, {
        kind: 'phase',
        effect: 'wind',
        target: cell.coord,
        direction: cell.wind,
        label: `风向 ${previous.wind ?? '—'} → ${cell.wind ?? '—'}`,
      })
    }

    if (!previousRainIntent && currentRainIntent) {
      const countdown = cell.intents.find((intent) => intent.type === 'rain')?.countdown ?? 1
      pushCue(events, {
        kind: 'phase',
        effect: 'rain-intent',
        target: cell.coord,
        amount: countdown,
        label: `Cloud 形成降雨预告 · T+${countdown}`,
      })
    }
  }

  if (events.length === 0 || before.phase !== after.phase || before.turn !== after.turn) {
    pushCue(events, {
      kind: 'phase',
      effect: 'phase',
      target: fallbackTarget,
      label: before.turn !== after.turn
        ? `Turn ${after.turn} · ${after.phase}`
        : `${before.phase} → ${after.phase}`,
    })
  }

  if (drawnCards.length > 0) {
    pushCue(events, {
      kind: 'phase',
      effect: 'draw',
      target: playerAfter.position,
      cardIds: drawnCards,
      amount: drawnCards.length,
      label: `抽取 ${drawnCards.length} 张牌：${drawnCards.map(cardName).join('、')}`,
    })
  }

  return events
}
