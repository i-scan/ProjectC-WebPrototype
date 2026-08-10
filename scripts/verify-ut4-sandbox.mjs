import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4174'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#rules-lab`
const debuggingOrigin = 'http://127.0.0.1:9223'
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

async function waitFor(label, operation, attempts = 200, delay = 100) {
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
    this.events = new Map()
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
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  return result.result.value
}

const snapshotExpression = `(() => {
  const root = document.querySelector('.coupled-inertia-lab')
  const board = root?.querySelector('.ut4-board-frame')
  const canvas = board?.querySelector('.hex-board-host canvas')
  const header = root?.querySelector('.ut4-header')
  const lower = root?.querySelector('.ut4-lower-layout')
  const text = root?.textContent ?? ''
  const rect = (element) => {
    if (!element) return null
    const value = element.getBoundingClientRect()
    return { left: value.left, top: value.top, width: value.width, height: value.height, right: value.right, bottom: value.bottom }
  }
  const stateCards = [...(root?.querySelectorAll('.ut4-header-state > div') ?? [])].map((node) => node.textContent.trim())
  return {
    root: rect(root),
    header: rect(header),
    board: rect(board),
    canvas: rect(canvas),
    lower: rect(lower),
    ruleset: root?.getAttribute('data-ruleset') ?? null,
    implementation: root?.getAttribute('data-implementation') ?? null,
    stateCards,
    hasThermalDebug: text.includes('Thermal Debug'),
    hasSpatialDebug: text.includes('Spatial Debug'),
    hasEventLog: text.includes('Event Log'),
    hasHeavyRelease: text.includes('Heavy Release'),
    hasHoldPosition: text.includes('Hold Position'),
    hasHitControl: text.includes('受击 / Hit Player'),
    hasQueueDummyMove: text.includes('Queue Dummy Move'),
  }
})()`

function verifySnapshot(snapshot, label) {
  assert(snapshot.ruleset === 'VAL-012-UT4', `${label}: active ruleset marker is not UT4`, snapshot)
  assert(snapshot.implementation === 'coupled-inertia-sandbox-v1', `${label}: implementation marker is missing`, snapshot)
  assert(snapshot.root && snapshot.root.width > 700, `${label}: sandbox root is collapsed`, snapshot)
  assert(snapshot.header && snapshot.header.height > 50, `${label}: sandbox header is collapsed`, snapshot)
  assert(snapshot.board && snapshot.board.width > 400 && snapshot.board.height > 400, `${label}: central board frame is collapsed`, snapshot)
  assert(snapshot.canvas && snapshot.canvas.width > 390 && snapshot.canvas.height > 390, `${label}: 3D Hex canvas is not visible`, snapshot)
  assert(snapshot.lower && snapshot.lower.height > 200, `${label}: Thermal/Event Log lower region is collapsed`, snapshot)
  assert(snapshot.hasThermalDebug, `${label}: Thermal Debug controls are missing`, snapshot)
  assert(snapshot.hasSpatialDebug, `${label}: Spatial Debug controls are missing`, snapshot)
  assert(snapshot.hasEventLog, `${label}: Event Log is missing`, snapshot)
  assert(snapshot.hasHeavyRelease, `${label}: Heavy Release control is missing`, snapshot)
  assert(snapshot.hasHoldPosition, `${label}: Hold Position control is missing`, snapshot)
  assert(snapshot.hasHitControl, `${label}: Inject Hit control is missing`, snapshot)
}

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ut4-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut4-preview] ${chunk}`))

  await waitFor('UT4 Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-ut4-chrome-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9223',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut4-chrome] ${chunk}`))

  const version = await waitFor('UT4 Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })

  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create UT4 Chrome inspection target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await client.send('Page.navigate', { url: pageUrl })

  await waitFor('UT4 sandbox root', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.coupled-inertia-lab[data-ruleset="VAL-012-UT4"]'))`)
    if (!ready) throw new Error('UT4 sandbox root not mounted')
    return true
  })
  await waitFor('UT4 3D board canvas', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.coupled-inertia-lab .ut4-board-frame .hex-board-host canvas'))`)
    if (!ready) throw new Error('3D board canvas not mounted')
    return true
  })
  await sleep(450)

  const initial = await evaluate(client, snapshotExpression)
  verifySnapshot(initial, '1366px initial')

  const domainBefore = await evaluate(client, `document.querySelector('.ut4-header-state')?.textContent ?? ''`)
  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.ut4-quick-row button')].find((node) => node.textContent.includes('T +4'))
    if (!button) throw new Error('T +4 button missing')
    button.click()
    return true
  })()`)
  await waitFor('UT4 Hot debug state', async () => {
    const hot = await evaluate(client, `document.querySelector('.ut4-header-state')?.textContent.includes('HOT')`)
    if (!hot) throw new Error('domain did not become HOT')
    return true
  })

  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.ut4-time-controls button')].find((node) => node.textContent.includes('+1 AT'))
    if (!button) throw new Error('+1 AT button missing')
    button.click()
    return true
  })()`)
  await waitFor('UT4 world time advance', async () => {
    const text = await evaluate(client, `document.querySelector('.ut4-header-state')?.textContent ?? ''`)
    if (!text.includes('1.0 AT')) throw new Error(`world time did not advance: ${text}`)
    return true
  })

  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.ut4-board-toolbar button')].find((node) => node.textContent.trim() === '2D')
    if (!button) throw new Error('2D button missing')
    button.click()
    return true
  })()`)
  await waitFor('UT4 2D map', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut4-board-frame .hex-travel-map-host svg'))`)
    if (!ready) throw new Error('2D Hex map not mounted')
    return true
  })

  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.ut4-board-toolbar button')].find((node) => node.textContent.trim() === '3D')
    if (!button) throw new Error('3D button missing')
    button.click()
    return true
  })()`)
  await waitFor('UT4 3D map restored', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut4-board-frame .hex-board-host canvas'))`)
    if (!ready) throw new Error('3D Hex canvas not restored')
    return true
  })
  await sleep(300)

  const finalSnapshot = await evaluate(client, snapshotExpression)
  verifySnapshot(finalSnapshot, '1366px after interaction')

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut4-sandbox.png'), Buffer.from(screenshot.data, 'base64'))
  await writeFile(join(artifactDir, 'ut4-sandbox.json'), `${JSON.stringify({ domainBefore, initial, finalSnapshot }, null, 2)}\n`)

  console.log('UT4 coupled inertia sandbox verified in real Chrome at 1366x1080.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
