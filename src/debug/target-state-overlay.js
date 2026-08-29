import { momentumLevel } from '../sim/solver.js'

export const TARGET_STATE_OVERLAY_RULE = 'target-m-axis-overlay-v1'

function actorM(actor) {
  if (Number.isFinite(actor?.momentumLevel)) return Math.max(0, Math.round(actor.momentumLevel))
  return momentumLevel(Math.hypot(actor?.velocity?.x ?? 0, actor?.velocity?.z ?? 0))
}

function axisText(axisId) {
  return axisId || '—'
}

function make(tag, className, text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function stylePanel(panel) {
  Object.assign(panel.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    zIndex: '24',
    minWidth: '176px',
    maxWidth: '265px',
    padding: '9px 10px',
    border: '1px solid rgba(241,200,90,.38)',
    borderRadius: '8px',
    background: 'rgba(12,20,29,.88)',
    boxShadow: '0 8px 24px rgba(0,0,0,.28)',
    color: '#dce8ef',
    font: '10px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    pointerEvents: 'none',
    backdropFilter: 'blur(5px)',
  })
}

function render(panel, api) {
  const snapshot = api?.snapshot?.()
  const actors = snapshot?.actors ?? []
  panel.replaceChildren()
  panel.dataset.rule = TARGET_STATE_OVERLAY_RULE

  const heading = make('div', 'target-state-heading')
  heading.textContent = 'TARGET INERTIA'
  Object.assign(heading.style, {
    marginBottom: '6px',
    color: '#f2c85a',
    fontWeight: '800',
    letterSpacing: '.08em',
  })
  panel.appendChild(heading)

  if (!actors.length) {
    const empty = make('div', '', 'No target actors')
    empty.style.color = '#8295a8'
    panel.appendChild(empty)
    return
  }

  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  for (const actor of actors) {
    const row = make('div', 'target-state-row')
    row.dataset.targetActorId = actor.id
    row.dataset.targetM = String(actorM(actor))
    row.dataset.targetAxis = actor.axisId || 'none'
    row.textContent = `${actor.label ?? actor.id} · Cell ${actor.hex.q},${actor.hex.r} · M${actorM(actor)} · Axis ${axisText(actor.axisId)}`
    Object.assign(row.style, {
      padding: '3px 0',
      borderTop: panel.querySelector('.target-state-row') ? '1px solid rgba(126,151,171,.10)' : '0',
      whiteSpace: 'nowrap',
    })
    panel.appendChild(row)
  }

  const events = api?.conflicts?.() ?? []
  const transfer = [...events].reverse().find((entry) => entry?.kind === 'momentum-transfer' && entry?.sourceActorId === 'player')
  if (!transfer?.targetActorId) return

  const target = actorById.get(transfer.targetActorId)
  const composition = transfer.composition ?? null
  const detail = make('div', 'target-composition-preview')
  detail.dataset.targetComposition = 'true'
  const existingAxis = composition?.beforeAxis ?? target?.axisId ?? null
  const incomingAxis = composition?.incomingAxis ?? transfer.directionId ?? null
  const resultAxis = composition?.axisId ?? null
  detail.textContent = `${target?.label ?? transfer.targetActorId}: Existing M${transfer.targetBeforeM ?? composition?.beforeM ?? 0} ${axisText(existingAxis)} + Incoming M${transfer.sourceBeforeM ?? composition?.incomingM ?? 0} ${axisText(incomingAxis)} → M${transfer.targetAfterM ?? composition?.momentum ?? 0} ${axisText(resultAxis)}`
  Object.assign(detail.style, {
    marginTop: '7px',
    paddingTop: '7px',
    borderTop: '1px solid rgba(241,200,90,.28)',
    color: '#fff0ca',
    whiteSpace: 'normal',
  })
  panel.appendChild(detail)
}

function install() {
  const root = document.querySelector('.cell-world-prototype')
  const board = root?.querySelector('.cell-world-board')
  const api = window.__PROJECTC_PROTOTYPE__
  if (!root || !board || !api?.snapshot) return

  if (getComputedStyle(board).position === 'static') board.style.position = 'relative'
  let panel = board.querySelector(':scope > .target-state-overlay')
  if (!panel) {
    panel = make('div', 'target-state-overlay')
    panel.setAttribute('aria-label', 'Target Momentum and Axis state')
    stylePanel(panel)
    board.appendChild(panel)
  }
  render(panel, api)
}

install()
const timer = window.setInterval(install, 80)
window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true })
