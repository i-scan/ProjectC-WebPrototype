import { useMemo, useState } from 'react'
import {
  actorAt,
  actorSymbol,
  advancePhase,
  CARD_LIBRARY,
  cellAt,
  createInitialState,
  endPlayerTurn,
  getPlayer,
  phaseLabel,
  performBasicAction,
  playCard,
  toggleArmor,
  updateConfig,
  windArrow,
  type BasicAction,
  type Coord,
  type Layer,
  type TurnMode,
} from './game'

type Selection =
  | { kind: 'inspect' }
  | { kind: 'basic'; action: BasicAction }
  | { kind: 'card'; cardId: string }

const turnModeLabels: Record<TurnMode, string> = {
  'local-global': '玩家局部 → 敌人局部 → 一次全局',
  'global-before-enemy': '玩家 → 全局 → 敌人',
  'double-global': '玩家 → 全局 → 敌人 → 全局',
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(href)
}

export function App() {
  const [state, setState] = useState(() => createInitialState())
  const [selection, setSelection] = useState<Selection>({ kind: 'inspect' })
  const [layer, setLayer] = useState<Layer>('ground')
  const [selectedCoord, setSelectedCoord] = useState<Coord>({ x: 1, y: 8 })

  const player = getPlayer(state)
  const selectedCell = cellAt(state, selectedCoord)
  const selectedActor = actorAt(state, selectedCoord)
  const handCards = state.hand
    .map((id) => CARD_LIBRARY.find((card) => card.id === id))
    .filter((card): card is NonNullable<typeof card> => Boolean(card))

  const objectiveText = useMemo(
    () => [
      `${state.objectives.npcWarmed ? '✓' : '○'} 使失温 NPC 体温恢复至 0`,
      `${state.objectives.eliteDefeated ? '✓' : '○'} 击败精英守卫（战斗验证）`,
      `${state.objectives.extracted ? '✓' : '○'} 玩家与 NPC 返回 Shelter`,
    ],
    [state.objectives],
  )

  const handleCellClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (state.phase !== 'player' || state.status !== 'active') return
    if (selection.kind === 'basic') {
      setState((current) => performBasicAction(current, selection.action, coord))
      return
    }
    if (selection.kind === 'card') {
      setState((current) => playCard(current, selection.cardId, coord, layer))
      setSelection({ kind: 'inspect' })
    }
  }

  const handleSelfCard = (cardId: string) => {
    setState((current) => playCard(current, cardId, undefined, layer))
    setSelection({ kind: 'inspect' })
  }

  const handleAdvance = () => {
    if (state.phase === 'player') setState((current) => endPlayerTurn(current))
    else setState((current) => advancePhase(current))
    setSelection({ kind: 'inspect' })
  }

  const phaseButtonText =
    state.phase === 'player'
      ? '结束玩家回合（最多保留 1 AP）'
      : `推进：${phaseLabel(state.phase)}`

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ProjectC · Rules Lab v0</p>
          <h1>双层棋盘规则实验室</h1>
        </div>
        <div className={`status-badge status-${state.status}`}>
          {state.status === 'active'
            ? `Turn ${state.turn} · ${phaseLabel(state.phase)}`
            : state.status === 'won'
              ? 'Session 成功'
              : 'Session 失败'}
        </div>
      </header>

      <section className="layout">
        <aside className="panel left-panel">
          <h2>玩家 Actor</h2>
          <div className="stat-grid">
            <span>类型</span><strong>{player.actorType}</strong>
            <span>位置</span><strong>({player.position.x},{player.position.y})</strong>
            <span>HP</span><strong>{player.hp}/{player.maxHp}</strong>
            <span>Shield</span><strong>{player.shield}</strong>
            <span>体温 / 平衡</span><strong>{player.bodyTemperature} / {player.balanceTemperature}</strong>
            <span>攻击力</span><strong>{player.attackPower}</strong>
            <span>AP</span><strong>{state.ap}（待继承 {state.reservedAP}）</strong>
            <span>熵</span><strong>{state.entropy}</strong>
          </div>

          <h3>装备栏</h3>
          <div className="equipment-list">
            <div><span>武器</span><strong>{player.weapon?.name ?? '无'}</strong></div>
            <div><span>衣服</span><strong>{player.armor?.name ?? '已取下'}</strong></div>
            <div><span>鞋子</span><strong>{player.shoes?.name ?? '无'}</strong></div>
          </div>
          <button className="secondary" onClick={() => setState((current) => toggleArmor(current))}>
            {player.armor ? '脱下普通衣服' : '穿上普通衣服'}
          </button>

          <h3>基础行动</h3>
          <div className="button-row">
            <button
              className={selection.kind === 'basic' && selection.action === 'move' ? 'selected' : ''}
              disabled={state.phase !== 'player' || state.status !== 'active'}
              onClick={() => setSelection({ kind: 'basic', action: 'move' })}
            >
              移动 · 1 AP
            </button>
            <button
              className={selection.kind === 'basic' && selection.action === 'attack' ? 'selected' : ''}
              disabled={state.phase !== 'player' || state.status !== 'active'}
              onClick={() => setSelection({ kind: 'basic', action: 'attack' })}
            >
              剑攻击 · 1 AP
            </button>
          </div>

          <h3>规则配置</h3>
          <label className="field">
            <span>结算候选顺序</span>
            <select
              value={state.config.turnMode}
              onChange={(event) =>
                setState((current) => updateConfig(current, { turnMode: event.target.value as TurnMode }))
              }
            >
              {Object.entries(turnModeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={state.config.enableExtremeAccumulation}
              onChange={(event) =>
                setState((current) => updateConfig(current, { enableExtremeAccumulation: event.target.checked }))
              }
            />
            启用持续环境累积极端温度 ±3
          </label>
        </aside>

        <section className="board-column">
          <div className="board-toolbar">
            <div className="segmented">
              <button className={layer === 'ground' ? 'selected' : ''} onClick={() => setLayer('ground')}>地面目标</button>
              <button className={layer === 'sky' ? 'selected' : ''} onClick={() => setLayer('sky')}>天空目标</button>
            </div>
            <p>Cell 同时显示 Sky 与 Ground；当前卡牌目标层：<strong>{layer === 'ground' ? 'Ground' : 'Sky'}</strong></p>
          </div>

          <div className="board" style={{ gridTemplateColumns: `repeat(${state.config.width}, minmax(54px, 1fr))` }}>
            {state.cells.map((cell) => {
              const actors = state.actors.filter(
                (actor) => actor.alive && actor.position.x === cell.coord.x && actor.position.y === cell.coord.y,
              )
              const isSelected = selectedCoord.x === cell.coord.x && selectedCoord.y === cell.coord.y
              return (
                <button
                  key={`${cell.coord.x}-${cell.coord.y}`}
                  className={`cell ${isSelected ? 'cell-selected' : ''} ${cell.tags.includes('Shelter') ? 'cell-shelter' : ''}`}
                  onClick={() => handleCellClick(cell.coord)}
                  title={`(${cell.coord.x},${cell.coord.y})`}
                >
                  <div className="sky-line">
                    <span>S {cell.skyTemp > 0 ? `+${cell.skyTemp}` : cell.skyTemp}</span>
                    <span>{cell.skyFill === 'cloud' ? '☁' : cell.skyFill === 'smoke' ? '≋' : '·'}</span>
                    <span>{windArrow(cell.wind)}</span>
                  </div>
                  <div className="actor-line">
                    {actors.length
                      ? actors.map((actor) => (
                          <span key={actor.id} className={`actor actor-${actor.actorType}`}>{actorSymbol(actor)}</span>
                        ))
                      : <span> </span>}
                  </div>
                  <div className="ground-line">
                    <span>G {cell.groundTemp > 0 ? `+${cell.groundTemp}` : cell.groundTemp}</span>
                    <span>{cell.groundFill === 'water' ? '水' : cell.groundFill === 'grass' ? '草' : cell.groundFill === 'fire' ? '火' : cell.groundFill === 'ice' ? '冰' : '·'}</span>
                  </div>
                  {cell.intents.length > 0 && <div className="intent-pill">雨 {cell.intents[0].countdown}</div>}
                </button>
              )
            })}
          </div>

          <div className="turn-controls">
            <button className="primary" disabled={state.status !== 'active'} onClick={handleAdvance}>
              {phaseButtonText}
            </button>
            <button onClick={() => {
              setState(createInitialState({
                turnMode: state.config.turnMode,
                enableExtremeAccumulation: state.config.enableExtremeAccumulation,
              }))
              setSelection({ kind: 'inspect' })
            }}>
              重开场景
            </button>
            <button onClick={() => downloadJson(`projectc-turn-${state.turn}.json`, state)}>导出 GameState</button>
          </div>

          <section className="hand-panel">
            <div className="section-heading">
              <h2>手牌栏</h2>
              <span>{state.hand.length} 张 · Deck {state.deck.length} · Discard {state.discard.length}</span>
            </div>
            <div className="hand-grid">
              {handCards.map((card) => (
                <button
                  key={card.id}
                  className={`card ${selection.kind === 'card' && selection.cardId === card.id ? 'selected-card' : ''}`}
                  disabled={state.phase !== 'player' || state.status !== 'active' || state.ap < card.cost}
                  onClick={() =>
                    card.target === 'self'
                      ? handleSelfCard(card.id)
                      : setSelection({ kind: 'card', cardId: card.id })
                  }
                >
                  <div className="card-title"><strong>{card.name}</strong><span>{card.cost} AP</span></div>
                  <p>{card.description}</p>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="panel right-panel">
          <h2>检查器</h2>
          {selectedCell && (
            <>
              <h3>Cell ({selectedCell.coord.x},{selectedCell.coord.y})</h3>
              <div className="stat-grid compact">
                <span>Ground Temp</span><strong>{selectedCell.groundTemp}</strong>
                <span>Sky Temp</span><strong>{selectedCell.skyTemp}</strong>
                <span>Moisture</span><strong>{selectedCell.moisture}</strong>
                <span>Ground Fill</span><strong>{selectedCell.groundFill}</strong>
                <span>Sky Fill</span><strong>{selectedCell.skyFill}</strong>
                <span>Cloud Age</span><strong>{selectedCell.cloudAge}</strong>
                <span>Wind</span><strong>{selectedCell.wind ?? 'none'}</strong>
                <span>Intent</span><strong>{selectedCell.intents.map((intent) => `${intent.type}:${intent.countdown}`).join(', ') || 'none'}</strong>
                <span>Tags</span><strong>{selectedCell.tags.join(', ') || 'none'}</strong>
              </div>
            </>
          )}
          {selectedActor && (
            <>
              <h3>{selectedActor.name}</h3>
              <div className="stat-grid compact">
                <span>Actor Type</span><strong>{selectedActor.actorType}</strong>
                <span>HP</span><strong>{selectedActor.hp}/{selectedActor.maxHp}</strong>
                <span>Shield</span><strong>{selectedActor.shield}</strong>
                <span>体温 / 平衡</span><strong>{selectedActor.bodyTemperature}/{selectedActor.balanceTemperature}</strong>
                <span>Mass</span><strong>{selectedActor.mass}</strong>
                <span>Intent</span><strong>{selectedActor.intent}</strong>
              </div>
            </>
          )}

          <h2>任务目标</h2>
          <ul className="objective-list">
            {objectiveText.map((text) => <li key={text}>{text}</li>)}
          </ul>

          <h2>规则日志</h2>
          <div className="log-list">
            {state.logs.map((log, index) => <div key={`${index}-${log}`}>{log}</div>)}
          </div>
        </aside>
      </section>
    </main>
  )
}
