import type { Coord, GameState } from '../game'
import type { VisualEvent } from './InteractiveThreeBoard'

export type PlaybackEvent = VisualEvent & {
  label?: string
  amount?: number
  actorId?: string
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

function pushCue(events: PlaybackEvent[], cue: Omit<PlaybackEvent, 'id'>) {
  if (events.length >= 14) return
  events.push({ id: nextId(), ...cue })
}

export function buildVisualEvents(
  before: GameState,
  after: GameState,
  fallbackTarget?: Coord,
): PlaybackEvent[] {
  const events: PlaybackEvent[] = []
  const beforeActors = new Map(before.actors.map((actor) => [actor.id, actor]))

  for (const actor of after.actors) {
    const previous = beforeActors.get(actor.id)
    if (!previous) continue

    if (!sameCoord(previous.position, actor.position)) {
      pushCue(events, {
        kind: 'move',
        target: actor.position,
        actorId: actor.id,
        label: `${actor.name} 移动到 (${actor.position.x},${actor.position.y})`,
      })
    }

    if (actor.hp < previous.hp) {
      pushCue(events, {
        kind: 'attack',
        target: actor.position,
        actorId: actor.id,
        amount: previous.hp - actor.hp,
        label: `${actor.name} 受到 ${previous.hp - actor.hp} 点伤害`,
      })
    }

    if (actor.shield > previous.shield) {
      pushCue(events, {
        kind: 'guard',
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

    if (cell.groundTemp !== previous.groundTemp) {
      const delta = cell.groundTemp - previous.groundTemp
      pushCue(events, {
        kind: delta > 0 ? 'heat' : 'cool',
        target: cell.coord,
        amount: Math.abs(delta),
        label: `Ground (${cell.coord.x},${cell.coord.y}) 温度 ${delta > 0 ? '+' : ''}${delta}`,
      })
    }

    if (cell.groundFill !== previous.groundFill) {
      const cooling = cell.groundFill === 'ice' || previous.groundFill === 'fire'
      pushCue(events, {
        kind: cooling ? 'cool' : 'heat',
        target: cell.coord,
        label: `${previous.groundFill} → ${cell.groundFill}`,
      })
    }

    const beforeIntent = previous.intents.map((intent) => `${intent.type}:${intent.countdown}`).join('|')
    const afterIntent = cell.intents.map((intent) => `${intent.type}:${intent.countdown}`).join('|')
    if (
      cell.skyFill !== previous.skyFill ||
      cell.wind !== previous.wind ||
      beforeIntent !== afterIntent
    ) {
      pushCue(events, {
        kind: 'phase',
        target: cell.coord,
        label: cell.skyFill !== previous.skyFill
          ? `Sky ${previous.skyFill} → ${cell.skyFill}`
          : cell.wind !== previous.wind
            ? `风向 ${previous.wind ?? '—'} → ${cell.wind ?? '—'}`
            : `Sky intent 更新`,
      })
    }
  }

  if (events.length === 0 || before.phase !== after.phase || before.turn !== after.turn) {
    pushCue(events, {
      kind: 'phase',
      target: fallbackTarget,
      label: before.turn !== after.turn
        ? `Turn ${after.turn} · ${after.phase}`
        : `${before.phase} → ${after.phase}`,
    })
  }

  return events
}
