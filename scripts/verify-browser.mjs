import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9229'
const artifactDir = resolve('artifacts')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`)
}
function which(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}
function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}
async function waitFor(label, operation, attempts = 160, delay = 50) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation() } catch (error) { lastError = error; if (index + 1 < attempts) await sleep(delay) }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`)
}

class CdpClient {
  constructor(url) {
    this.id = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
  }
  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)
      payload.error ? pending.reject(new Error(payload.error.message)) : pending.resolve(payload.result)
    })
  }
  send(method, params = {}) {
    const id = this.id++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.socket.close() }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed')
  return response.result.value
}

const snapshotExpression = `(() => {
  const root = document.querySelector('.current-prototype[data-implementation="continuous-inertia-v1"]')
  const board = root?.querySelector('.continuous-board-host')
  const cards = [...(root?.querySelectorAll('.action-card') ?? [])]
  return {
    implementation: root?.dataset.implementation ?? '',
    authority: root?.dataset.authority ?? '',
    atVisualMs: Number(root?.dataset.atVisualMs ?? 0),
    solverSteps: Number(root?.dataset.solverSteps ?? 0),
    playing: root?.dataset.playing === 'true',
    worldAt: Number(root?.dataset.worldAt ?? -1),
    logicalX: Number(root?.dataset.logicalX ?? NaN),
    logicalZ: Number(root?.dataset.logicalZ ?? NaN),
    speed: Number(root?.dataset.speed ?? NaN),
    visualX: Number(board?.dataset.visualX ?? NaN),
    visualZ: Number(board?.dataset.visualZ ?? NaN),
    frameProgress: Number(board?.dataset.playbackProgress ?? 0),
    canvasCount: root?.querySelectorAll('canvas').length ?? 0,
    actionCardCount: cards.length,
    selectedActionId: cards.find((node) => node.classList.contains('selected'))?.dataset.actionId ?? '',
    hasLegacyBoard: Boolean(root?.querySelector('.inertia-field-board')),
    hasApply: Boolean(root?.querySelector('[data-testid="impulse-commit"], .impulse-commit-row')),
  }
})()`

let previewProcess
let chromeProcess
let client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))
  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-continuous-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229',
    `--user-data-dir=${userDataDir}`, '--window-size=1600,1100', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  await waitFor('Chrome DevTools', async () => {
    const response = await fetch(`${debugUrl}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create browser target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Page.bringToFront')
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('continuous prototype', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.canvasCount !== 1 || snapshot.implementation !== 'continuous-inertia-v1') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(initial.authority === 'position-velocity', 'Position + Velocity is not authoritative', initial)
  assert(initial.atVisualMs === 800 && initial.solverSteps === 120, 'fixed AT / solver contract is incorrect', initial)
  assert(initial.actionCardCount === 5 && initial.selectedActionId === 'drive', 'motion-card structure is incorrect', initial)
  assert(!initial.hasLegacyBoard && !initial.hasApply, 'legacy renderer or Apply control leaked into rebuild', initial)

  const driveStart = Date.now()
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`) === true, 'Drive click-to-resolve path failed')
  const started = await waitFor('Drive playback start', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.playing) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(started.worldAt === 0 && Math.abs(started.logicalX) < 0.001, 'logical state jumped at playback start', started)

  await sleep(240)
  const mid = await evaluate(client, snapshotExpression)
  assert(mid.playing && mid.worldAt === 0 && Math.abs(mid.logicalX) < 0.001, 'logical state committed before the fixed AT clock completed', mid)

  const afterDrive = await waitFor('Drive completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.playing || snapshot.worldAt !== 1) throw new Error(JSON.stringify(snapshot))
    return snapshot
  }, 100, 40)
  const driveElapsedMs = Date.now() - driveStart
  assert(driveElapsedMs >= 700 && driveElapsedMs <= 1700, `headless observation drifted too far from the fixed 800ms timebase: ${driveElapsedMs}ms`, afterDrive)
  assert(afterDrive.logicalX > 0.7 && afterDrive.logicalX < 1, 'Drive final Position snapped to a cell instead of remaining continuous', afterDrive)
  assert(Math.abs(afterDrive.visualX - afterDrive.logicalX) < 0.03, 'visual/logical Position disagree after Drive', afterDrive)

  await evaluate(client, `document.querySelector('[data-action-id="coast"]').click()`)
  await waitFor('Coast selection', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.selectedActionId !== 'coast') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  const coastStart = Date.now()
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`) === true, 'Coast click-to-resolve path failed')
  const afterCoast = await waitFor('Coast completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.playing || snapshot.worldAt !== 2) throw new Error(JSON.stringify(snapshot))
    return snapshot
  }, 100, 40)
  const coastElapsedMs = Date.now() - coastStart
  assert(coastElapsedMs >= 700 && coastElapsedMs <= 1700, `Coast did not share the same fixed 800ms timebase: ${coastElapsedMs}ms`, afterCoast)
  assert(afterCoast.logicalX > 1.45 && Math.abs(afterCoast.speed - afterDrive.speed) < 0.02, 'Coast did not preserve continuous velocity', afterCoast)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'continuous-inertia.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = { initial, started, mid, afterDrive, afterCoast, driveElapsedMs, coastElapsedMs }
  await writeFile(join(artifactDir, 'continuous-inertia.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log('Verified browser contract: single continuous board, no early logical teleport, fixed 800ms timebase, continuous final Position, direct click resolution, and Coast velocity persistence. Frame cadence is intentionally not gated by CI software WebGL.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
