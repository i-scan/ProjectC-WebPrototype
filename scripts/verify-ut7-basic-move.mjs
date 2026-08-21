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
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length > 0, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

async function waitFor(label, operation, attempts = 180, delay = 100) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation() } catch (error) { lastError = error; if (attempt < attempts) await sleep(delay) }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`)
}

class CdpClient {
  constructor(url) { this.nextId = 1; this.pending = new Map(); this.socket = new WebSocket(url) }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener('open', resolvePromise, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)); if (!payload.id) return
      const pending = this.pending.get(payload.id); if (!pending) return
      this.pending.delete(payload.id); if (payload.error) pending.reject(new Error(payload.error.message)); else pending.resolve(payload.result)
    })
  }
  send(method, params = {}) {
    const id = this.nextId; this.nextId += 1
    return new Promise((resolvePromise, reject) => { this.pending.set(id, { resolve: resolvePromise, reject }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  close() { this.socket.close() }
}

async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  return result.result.value
}

const snapshotExpression = `(() => {
  const root = document.querySelector('.ut7-actor-loop[data-ruleset="VAL-012-UT7-candidate"]')
  const header = root?.querySelector('.ut4-header-state')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const preview = root?.querySelector('.ut6-action-preview')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const resolution = root?.querySelector('[data-ut7-move-preview]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const cellText = root?.querySelector('.ut4-comparison-strip > span:last-child')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const radiusInput = root?.querySelector('.ut7-playground-setup input[type="range"]')
  const playerMatch = cellText.match(/Cell \\((-?\\d+),(-?\\d+)\\)/)
  const player = playerMatch ? { x: Number(playerMatch[1]), y: Number(playerMatch[2]) } : null
  const axial = (coord) => ({ q: coord.x - (coord.y - (coord.y & 1)) / 2, r: coord.y })
  const distance = (a, b) => {
    const first = axial(a); const second = axial(b)
    const dq = first.q - second.q; const dr = first.r - second.r
    const ds = -first.q - first.r + second.q + second.r
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds))
  }
  const validTargets = [...(root?.querySelectorAll('.hex-travel-cell.valid-target.drive') ?? [])]
  const distanceTwoTargets = player ? validTargets.filter((node) => distance(player, { x: Number(node.dataset.x), y: Number(node.dataset.y) }) === 2).length : 0
  return {
    header, preview, resolution, cellText,
    pageScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    basicMoveCard: Boolean(root?.querySelector('[data-action-id="basic-move"]')),
    steerCard: Boolean(root?.querySelector('[data-action-id="steer"]')),
    validMoveTargets: validTargets.length,
    distanceTwoTargets,
    allValidTargets: root?.querySelectorAll('.hex-travel-cell.valid-target').length ?? 0,
    boardCellCount: root?.querySelectorAll('.hex-travel-cell').length ?? 0,
    radius: Number(radiusInput?.value ?? 0),
    latestLog: root?.querySelector('.ut4-log-list article')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    playbackSegments: Number(root?.querySelector('.hex-travel-actor.player')?.dataset.playbackSegments ?? 0),
    playbackPath: root?.querySelector('.hex-travel-actor.player')?.dataset.playbackPath ?? '',
    playbackMotion: root?.querySelector('.hex-travel-actor.player animateMotion')?.getAttribute('path') ?? '',
  }
})()`

const clickText = (scopeSelector, text) => `(() => {
  const scope = document.querySelector(${JSON.stringify(scopeSelector)})
  const button = [...(scope?.querySelectorAll('button') ?? [])].find((node) => node.textContent.trim() === ${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}))
  if (!button) throw new Error(${JSON.stringify(`button ${text} missing in ${scopeSelector}`)})
  button.click(); return true
})()`

const dispatchDistanceTwoTarget = (eventName) => `(() => {
  const root = document.querySelector('.ut7-actor-loop')
  const cellText = root?.querySelector('.ut4-comparison-strip > span:last-child')?.textContent ?? ''
  const match = cellText.match(/Cell \\((-?\\d+),(-?\\d+)\\)/)
  if (!match) throw new Error('Unable to read player Cell')
  const player = { x: Number(match[1]), y: Number(match[2]) }
  const axial = (coord) => ({ q: coord.x - (coord.y - (coord.y & 1)) / 2, r: coord.y })
  const distance = (a, b) => {
    const first = axial(a); const second = axial(b)
    const dq = first.q - second.q; const dr = first.r - second.r
    const ds = -first.q - first.r + second.q + second.r
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds))
  }
  const target = [...root.querySelectorAll('.hex-travel-cell.valid-target.drive')].find((node) => distance(player, { x: Number(node.dataset.x), y: Number(node.dataset.y) }) === 2)
  if (!target) throw new Error('No distance-2 Basic Move Steering Intent found')
  target.dispatchEvent(new MouseEvent(${JSON.stringify(eventName)}, { bubbles: true }))
  return { x: Number(target.dataset.x), y: Number(target.dataset.y) }
})()`

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ut7-basic-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut7-basic-preview] ${chunk}`))
  await waitFor('UT7 Basic Move Vite preview', async () => { const response = await fetch(pageUrl, { redirect: 'follow' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return true })

  const userDataDir = join(tmpdir(), `projectc-ut7-basic-move-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229', `--user-data-dir=${userDataDir}`, '--window-size=1366,1080', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut7-basic-chrome] ${chunk}`))
  const version = await waitFor('UT7 Basic Move Chrome DevTools', async () => { const response = await fetch(`${debuggingOrigin}/json/version`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create UT7 Basic Move Chrome target')
  const target = await targetResponse.json(); client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl); await client.open()
  await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1080, deviceScaleFactor: 1, mobile: false }); await client.send('Page.navigate', { url: pageUrl })

  await waitFor('UT7 Basic Move live root', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut7-actor-loop[data-implementation="inertia-driving-basic-move-v3"] .hex-board-host canvas'))`)
    if (!ready) throw new Error('UT7 Basic Move root / 3D board canvas not mounted'); return true
  })
  await sleep(450)

  const initial = await evaluate(client, snapshotExpression)
  assert(initial.basicMoveCard && !initial.steerCard, 'UT7 live command row must expose Basic Move and remove Steer', initial)
  assert(initial.header.includes('0.0 AT') && initial.header.includes('M0'), 'UT7 Basic Move initial state mismatch', initial)
  assert(initial.pageScrollHeight <= initial.innerHeight + 2, 'UT7 Basic Move page requires vertical scrolling at 1366x1080', initial)

  await evaluate(client, clickText('.hex-view-switch', '2D'))
  const m0Targets = await waitFor('UT7 M0 Move1 target field', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.validMoveTargets < 1 || snapshot.validMoveTargets > 6 || snapshot.distanceTwoTargets !== 0) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.ut7-preset-grid', 'm2-east'))
  const momentumTargets = await waitFor('UT7 Horizontal M rule-generated Steering Intent field', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.distanceTwoTargets < 1 || snapshot.validMoveTargets <= m0Targets.validMoveTargets) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, dispatchDistanceTwoTarget('mouseover'))
  const twoStepPreview = await waitFor('UT7 two-Cell-step one-AT Move Resolution preview', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.resolution.includes('Move Resolution') || !snapshot.resolution.includes('1 AT') || !snapshot.resolution.includes('2 Cell-steps') || snapshot.preview.includes('ETA')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, dispatchDistanceTwoTarget('click'))
  const afterOneMove = await waitFor('UT7 one Basic Move command with inertia path', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    const pathCells = snapshot.playbackPath ? snapshot.playbackPath.split('>') : []
    const motionCommands = snapshot.playbackMotion.match(/\\b[ML]\\b/g) ?? []
    if (!snapshot.header.includes('1.0 AT') || !snapshot.latestLog.includes('Basic Move') || !snapshot.latestLog.includes('Move2') || snapshot.playbackSegments !== 2 || pathCells.length !== 3 || motionCommands.length !== 3) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.ut7-preset-grid', 'cold-down'))
  const coldPreset = await waitFor('UT7 cold-down preset', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('0.0 AT') || !snapshot.header.includes('M3') || !snapshot.header.includes('Down')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  await evaluate(client, `document.querySelector('.ut7-actor-loop .hex-travel-cell.valid-target.drive').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  const downBreakawayOneAt = await waitFor('UT7 Down Breakaway one command', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('1.0 AT') || !snapshot.header.includes('M2') || !snapshot.header.includes('Down')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, `(() => {
    const input = document.querySelector('.ut7-playground-setup input[type="range"]')
    if (!input) throw new Error('UT7 Board Radius input missing')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '10')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  const radius10 = await waitFor('UT7 Basic Move real R10 topology rebuild', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.radius !== 10 || snapshot.boardCellCount !== 331 || !snapshot.header.includes('0.0 AT')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut7-basic-move.png'), Buffer.from(screenshot.data, 'base64'))
  const result = { initial, m0Targets, momentumTargets, twoStepPreview, afterOneMove, coldPreset, downBreakawayOneAt, radius10 }
  await writeFile(join(artifactDir, 'ut7-basic-move.json'), `${JSON.stringify(result, null, 2)}\n`)

  console.log('UT7 Basic Move verified in real Chrome: M0 stays Move1, Horizontal M exposes distance-2 Steering Intents, one command stays 1 AT with two Cell-steps, Down Breakaway advances one AT, and R10 remains real.')
  console.log(JSON.stringify({
    initial: initial.header,
    m0Targets: m0Targets.validMoveTargets,
    momentumTargets: momentumTargets.validMoveTargets,
    distanceTwoTargets: momentumTargets.distanceTwoTargets,
    twoStepPreview: twoStepPreview.resolution,
    afterOneMove: afterOneMove.header,
    downBreakaway: downBreakawayOneAt.header,
    r10Cells: radius10.boardCellCount,
  }, null, 2))
} finally {
  client?.close(); chromeProcess?.kill('SIGTERM'); previewProcess?.kill('SIGTERM')
}
