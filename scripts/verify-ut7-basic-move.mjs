import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4180'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#hex-prototype`
const debuggingOrigin = 'http://127.0.0.1:9229'
const artifactDir = resolve('artifacts')

function assert(condition, message, detail) {
  if (condition) return
  const suffix = detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

function which(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    which('google-chrome'),
    which('google-chrome-stable'),
    which('chromium'),
    which('chromium-browser'),
  ].filter(Boolean)
  assert(candidates.length > 0, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

async function waitFor(label, operation, attempts = 220, delay = 100) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(delay)
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`)
}

class CdpClient {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener('open', resolvePromise, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (!payload.id) return
      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)
      if (payload.error) pending.reject(new Error(payload.error.message))
      else pending.resolve(payload.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  return result.result.value
}

const snapshotExpression = `(() => {
  const root = document.querySelector('.impulse-inertia-lab[data-implementation="impulse-inertia-input-v3"]')
  const header = root?.querySelector('.ut4-header-state')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const preview = root?.querySelector('.impulse-prediction-card')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const action = root?.querySelector('.impulse-card-row .selected-action')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const boardRadiusLabel = [...(root?.querySelectorAll('label.ut4-range') ?? [])].find((node) => node.textContent.includes('Board Radius'))
  const boardRadius = Number(boardRadiusLabel?.querySelector('input')?.value ?? 0)
  const stateItems = [...(root?.querySelectorAll('.ut4-header-state > div') ?? [])]
  const stateValue = (label) => stateItems.find((node) => node.querySelector('span')?.textContent?.trim() === label)?.querySelector('strong')?.textContent?.trim() ?? ''
  const collisionLog = [...(root?.querySelectorAll('.ut4-log-list article small') ?? [])].map((node) => node.textContent ?? '').find((text) => text.includes('UT3Hard')) ?? ''
  const boardHost = root?.querySelector('.hex-board-host')
  const rect = (selector) => {
    const node = root?.querySelector(selector)
    if (!node) return null
    const value = node.getBoundingClientRect()
    return {
      left: Math.round(value.left),
      right: Math.round(value.right),
      top: Math.round(value.top),
      bottom: Math.round(value.bottom),
      width: Math.round(value.width),
      height: Math.round(value.height),
    }
  }
  return {
    implementation: root?.dataset.implementation ?? '',
    clickToResolve: root?.dataset.clickToResolve ?? '',
    sharedBoard: root?.dataset.sharedBoard ?? '',
    rendererMode: root?.dataset.rendererMode ?? '',
    spatialMode: root?.dataset.spatialMode ?? '',
    previewValid: root?.dataset.previewValid === 'true',
    pathLength: Number(root?.dataset.previewPathLength ?? 0),
    collisionCount: Number(root?.dataset.previewCollisionCount ?? 0),
    momentum: stateValue('Momentum'),
    axis: stateValue('Axis'),
    worldTime: stateValue('World Time'),
    header,
    preview,
    action,
    boardRadius,
    canvas: Boolean(root?.querySelector('.visual-board-frame canvas')),
    boardMounted: Boolean(root?.querySelector('.visual-board-frame canvas, .visual-board-frame svg')),
    sharedProbe: boardHost?.dataset.sharedProbe ?? '',
    hasHexThreeBoard: Boolean(boardHost),
    hasSimplifiedHybridBoard: Boolean(root?.querySelector('.inertia-field-board')),
    hasApplyButton: Boolean(root?.querySelector('[data-testid="impulse-commit"]')),
    collisionLog,
    layout: {
      root: rect(':scope'),
      hud: rect('.visual-hud'),
      left: rect('.ut4-left-panel'),
      board: rect('.ut4-board-column'),
      right: rect('.ut4-debug-panel'),
      boardFrame: rect('.ut4-board-frame'),
      hand: rect('.impulse-action-hand'),
    },
    navButtons: [...document.querySelectorAll('.app-switcher nav button')].map((button) => button.textContent?.trim() ?? ''),
  }
})()`

function assertThreeColumnLayout(snapshot, label) {
  const { left, board, right, boardFrame } = snapshot.layout ?? {}
  assert(left && board && right && boardFrame, `${label}: restored lab columns are missing`, snapshot)
  assert(left.right < board.left, `${label}: left panel overlaps or stacks with board`, snapshot.layout)
  assert(board.right < right.left, `${label}: board overlaps or stacks with right panel`, snapshot.layout)
  assert(Math.abs(left.top - board.top) <= 12, `${label}: left panel is not aligned with board`, snapshot.layout)
  assert(Math.abs(right.top - board.top) <= 12, `${label}: right panel is not aligned with board`, snapshot.layout)
  assert(left.width >= 190 && left.width <= 280, `${label}: left panel width is outside UT6 lab range`, snapshot.layout)
  assert(right.width >= 240 && right.width <= 330, `${label}: right panel width is outside UT6 lab range`, snapshot.layout)
  assert(board.width >= 700, `${label}: center board column is too narrow`, snapshot.layout)
  assert(boardFrame.width >= 680 && boardFrame.height >= 280, `${label}: board frame collapsed`, snapshot.layout)
}

const clickText = (scopeSelector, text) => `(() => {
  const scope = document.querySelector(${JSON.stringify(scopeSelector)})
  const button = [...(scope?.querySelectorAll('button') ?? [])].find((node) => node.textContent.trim() === ${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}))
  if (!button) throw new Error(${JSON.stringify(`button ${text} missing in ${scopeSelector}`)})
  button.click()
  return true
})()`

const clickFirstAimCell = `(() => {
  const cells = [...document.querySelectorAll('.hex-travel-cell')]
  const cell = cells.find((node) => !node.classList.contains('selected') && !node.classList.contains('mountain'))
  if (!cell) throw new Error('No 2D aim cell was available')
  cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return { x: cell.dataset.x, y: cell.dataset.y }
})()`

const clickValid2dCell = `(() => {
  const cell = document.querySelector('.hex-travel-cell.valid-target')
  if (!cell) throw new Error('No valid 2D impulse cell was available')
  cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return { x: cell.dataset.x, y: cell.dataset.y }
})()`

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[impulse-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[impulse-preview] ${chunk}`))
  await waitFor('Impulse Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-impulse-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9229',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1600,1100',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[impulse-chrome] ${chunk}`))

  const version = await waitFor('Impulse Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create impulse Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('Impulse lab root', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.canvas || snapshot.implementation !== 'impulse-inertia-input-v3') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(initial.rendererMode === '3d' && initial.spatialMode === 'discrete', 'Impulse lab must restore the default 3D discrete lab view', initial)
  assert(initial.previewValid && initial.pathLength === 1 && initial.momentum === 'M0', 'M0 Drive must predict one forced cell from force input', initial)
  assert(initial.clickToResolve === 'true' && initial.sharedBoard === 'hex-three-board' && !initial.hasApplyButton, 'Click-to-resolve/HexThreeBoard contract is not active', initial)
  assert(initial.hasHexThreeBoard && !initial.hasSimplifiedHybridBoard, 'The original full HexThreeBoard must be the only 3D board', initial)
  assert(initial.action.includes('Drive') && initial.navButtons[0]?.includes('Inertia Driving'), 'Current navigation/action shell is incorrect', initial)
  assertThreeColumnLayout(initial, 'Initial 3D')

  await evaluate(client, clickText('.hex-view-switch', '2D'))
  const view2d = await waitFor('restored 2D view', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.rendererMode !== '2d' || !snapshot.boardMounted) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assertThreeColumnLayout(view2d, '2D')

  await evaluate(client, clickFirstAimCell)
  const afterDrive = await waitFor('M0 Drive board-click commit', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.worldTime !== '1.0 AT' || snapshot.momentum !== 'M1') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.impulse-card-row', 'Coast'))
  const coastPreview = await waitFor('M1 Coast preview', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.previewValid || snapshot.pathLength !== 1 || !snapshot.action.includes('Coast')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  await evaluate(client, clickValid2dCell)
  const afterCoast = await waitFor('persistent M1 Coast board-click commit', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.worldTime !== '2.0 AT' || snapshot.momentum !== 'M1') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.visual-session-controls', 'Reset'))
  await evaluate(client, clickText('.ut6-preset-grid', 'E M3'))
  await evaluate(client, clickText('.impulse-card-row', 'Coast'))
  const m3CrashPreview = await waitFor('M3 forced collision preview', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.momentum !== 'M3' || snapshot.pathLength !== 2 || snapshot.collisionCount < 1 || !snapshot.preview.includes('UT3Hard')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  await evaluate(client, clickValid2dCell)
  const afterCrash = await waitFor('M3 collision board-click result', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.momentum === 'M3' || !snapshot.collisionLog.includes('UT3Hard')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.visual-session-controls', 'Reset'))
  await evaluate(client, clickText('.ut6-preset-grid', 'E M3'))
  await evaluate(client, clickText('.impulse-card-row', 'Counter Impulse'))
  const counterPreview = await waitFor('M3 counter impulse preview', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.previewValid || !snapshot.preview.includes('M3 → M2') || snapshot.pathLength !== 2) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.hex-view-switch', '3D'))
  const discrete3d = await waitFor('original Discrete 3D board', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.rendererMode !== '3d' || snapshot.spatialMode !== 'discrete' || !snapshot.canvas || !snapshot.hasHexThreeBoard || snapshot.hasSimplifiedHybridBoard) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assertThreeColumnLayout(discrete3d, 'Discrete 3D')
  await evaluate(client, `(() => {
    const board = document.querySelector('.hex-board-host')
    if (!board) throw new Error('original HexThreeBoard host missing')
    board.dataset.sharedProbe = 'same-hex-three-board-instance'
    return true
  })()`)
  await evaluate(client, clickText('.impulse-ab-switch', 'Hybrid'))
  const hybrid = await waitFor('Hybrid playback on original board', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.rendererMode !== '3d' || snapshot.spatialMode !== 'hybrid' || !snapshot.canvas || snapshot.sharedProbe !== 'same-hex-three-board-instance' || !snapshot.hasHexThreeBoard || snapshot.hasSimplifiedHybridBoard) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assertThreeColumnLayout(hybrid, 'Hybrid 3D')

  await evaluate(client, `(() => {
    const label = [...document.querySelectorAll('label.ut4-range')].find((node) => node.textContent.includes('Board Radius'))
    const input = label?.querySelector('input')
    if (!input) throw new Error('Board Radius input missing')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '10')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  const radius10 = await waitFor('R10 impulse board', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.boardRadius !== 10 || !snapshot.canvas || !snapshot.hasHexThreeBoard) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assertThreeColumnLayout(radius10, 'R10 Hybrid')

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut7-basic-move.png'), Buffer.from(screenshot.data, 'base64'))
  const result = { initial, view2d, afterDrive, coastPreview, afterCoast, m3CrashPreview, afterCrash, counterPreview, discrete3d, hybrid, radius10 }
  await writeFile(join(artifactDir, 'ut7-basic-move.json'), `${JSON.stringify(result, null, 2)}\n`)

  console.log('Impulse inertia verified in real Chrome: board click directly resolves impulse, the original HexThreeBoard is the only 3D board and persists across Discrete/Hybrid, and forced travel/collision remain intact.')
  console.log(JSON.stringify(result, null, 2))
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
