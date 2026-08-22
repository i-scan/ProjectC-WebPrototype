import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4180'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/`
const debuggingOrigin = 'http://127.0.0.1:9229'
const artifactDir = resolve('artifacts')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function assert(condition, message, detail) {
  if (condition) return
  throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`)
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
async function waitFor(label, operation, attempts = 200, delay = 80) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try { return await operation() } catch (error) { lastError = error; if (i + 1 < attempts) await sleep(delay) }
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
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (!payload.id) return
      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)
      payload.error ? pending.reject(new Error(payload.error.message)) : pending.resolve(payload.result)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
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
  return {
    implementation: root?.dataset.implementation ?? '',
    playing: root?.dataset.playing === 'true',
    worldAt: Number(root?.dataset.worldAt ?? -1),
    logicalX: Number(root?.dataset.logicalX ?? NaN),
    logicalZ: Number(root?.dataset.logicalZ ?? NaN),
    speed: Number(root?.dataset.speed ?? NaN),
    visualX: Number(board?.dataset.visualX ?? NaN),
    visualZ: Number(board?.dataset.visualZ ?? NaN),
    progress: Number(board?.dataset.playbackProgress ?? 0),
    canvas: Boolean(board?.querySelector('canvas')),
    hasLegacyBoard: Boolean(root?.querySelector('.inertia-field-board')),
    hasApply: [...(root?.querySelectorAll('button') ?? [])].some((button) => button.textContent.includes('Apply Impulse')),
    text: root?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
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
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229',
    `--user-data-dir=${userDataDir}`, '--window-size=1600,1100', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[chrome] ${chunk}`))

  await waitFor('Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create browser target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('continuous prototype', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.canvas || snapshot.implementation !== 'continuous-inertia-v1') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(!initial.hasLegacyBoard && !initial.hasApply, 'legacy renderer or Apply control leaked into rebuild', initial)
  assert(initial.worldAt === 0 && Math.abs(initial.logicalX) < 0.001, 'initial logical state is incorrect', initial)
  assert(initial.text.includes('Position + Velocity') && initial.text.includes('No Discrete / Hybrid gameplay modes'), 'current movement contract is not visible', initial)

  const startMs = Date.now()
  const fired = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`)
  assert(fired === true, 'Drive could not be fired through the same click-resolution path')

  const started = await waitFor('playback start', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.playing) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(started.worldAt === 0 && Math.abs(started.logicalX) < 0.001, 'logical state jumped before playback completed', started)

  await sleep(240)
  const mid = await evaluate(client, snapshotExpression)
  assert(mid.playing, 'playback ended too early', mid)
  assert(mid.visualX > 0.05 && mid.visualX < 0.84, 'visual actor did not continuously move during fixed playback', mid)
  assert(Math.abs(mid.logicalX) < 0.001 && mid.worldAt === 0, 'authoritative position advanced during animation', mid)

  const afterDrive = await waitFor('playback completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.playing || snapshot.worldAt !== 1) throw new Error(JSON.stringify(snapshot))
    return snapshot
  }, 80, 40)
  const elapsed = Date.now() - startMs
  assert(elapsed >= 700 && elapsed <= 1150, `1 AT visual duration drifted outside fixed window: ${elapsed}ms`, afterDrive)
  assert(afterDrive.logicalX > 0.7 && afterDrive.logicalX < 1, 'Drive final continuous position was unexpectedly snapped', afterDrive)
  assert(Math.abs(afterDrive.visualX - afterDrive.logicalX) < 0.03, 'visual and authoritative positions disagree after playback', afterDrive)

  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.action-card')].find((node) => node.textContent.includes('Coast'))
    if (!button) throw new Error('Coast card missing')
    button.click()
    return true
  })()`)
  const coastFired = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`)
  assert(coastFired === true, 'Coast could not resolve by clicking a traversed Cell')
  const afterCoast = await waitFor('Coast completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.playing || snapshot.worldAt !== 2) throw new Error(JSON.stringify(snapshot))
    return snapshot
  }, 90, 40)
  assert(afterCoast.logicalX > 1.45, 'Coast did not preserve continuous velocity', afterCoast)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'continuous-inertia.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = { initial, started, mid, afterDrive, afterCoast, driveElapsedMs: elapsed }
  await writeFile(join(artifactDir, 'continuous-inertia.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log('Verified continuous inertia in real Chrome: no logical teleport, fixed 1 AT playback duration, continuous in-cell positions, click-to-resolve flow, and Coast velocity persistence.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
