import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4175'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#rules-lab`
const debuggingOrigin = 'http://127.0.0.1:9224'
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

const thermalSnapshotExpression = `(() => {
  const thermal = document.querySelector('#ut4-thermal-debug')
  const byLabel = (label) => {
    const row = [...thermal.querySelectorAll('.ut4-range')].find((node) => node.querySelector('span')?.textContent.trim() === label)
    const input = row?.querySelector('input[type="range"]')
    return input ? { value: Number(input.value), step: Number(input.step) } : null
  }
  return {
    header: document.querySelector('.ut4-header-state')?.textContent ?? '',
    temperature: byLabel('Temperature'),
    drift: byLabel('Drift'),
    setPoint: byLabel('Set Point'),
    damping: byLabel('Damping'),
  }
})()`

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ut4-interaction-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut4-interaction-preview] ${chunk}`))

  await waitFor('UT4 interaction Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-ut4-interaction-chrome-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9224',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut4-interaction-chrome] ${chunk}`))

  const version = await waitFor('UT4 interaction Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })

  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create UT4 interaction Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1080, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  await waitFor('UT4 interaction lab root', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.coupled-inertia-lab[data-ruleset="VAL-012-UT4"] .hex-board-host canvas'))`)
    if (!ready) throw new Error('UT4 lab or 3D board canvas not mounted')
    return true
  })
  await sleep(400)

  const initialThermal = await evaluate(client, thermalSnapshotExpression)
  assert(initialThermal.header.includes('T 1.0'), 'UT4 did not start at Temperature 1', initialThermal)
  assert(initialThermal.temperature?.value === 1 && initialThermal.temperature?.step === 0.25, 'Temperature baseline/step mismatch', initialThermal)
  assert(initialThermal.drift?.value === 0 && initialThermal.drift?.step === 0.25, 'Drift baseline/step mismatch', initialThermal)
  assert(initialThermal.setPoint?.value === 1 && initialThermal.setPoint?.step === 0.25, 'Set Point baseline/step mismatch', initialThermal)
  assert(initialThermal.damping?.value === 1, 'Damping baseline mismatch', initialThermal)

  await evaluate(client, `(() => {
    const section = [...document.querySelectorAll('.ut4-debug-panel section')].find((node) => node.querySelector('h3')?.textContent.includes('Spatial Debug'))
    const movement = [...section.querySelectorAll('.ut4-segmented button')].find((node) => node.textContent.trim() === 'movement')
    if (!movement) throw new Error('Movement mode button missing')
    movement.click()
    return true
  })()`)

  const axisArrow = await waitFor('UT4 player Movement Axis arrow', async () => {
    const snapshot = await evaluate(client, `(() => {
      const group = document.querySelector('.ut4-movement-axis-overlay [data-actor-id="player"][data-axis="E"]')
      const line = group?.querySelector('line')
      if (!line) return null
      const x1 = Number(line.getAttribute('x1'))
      const y1 = Number(line.getAttribute('y1'))
      const x2 = Number(line.getAttribute('x2'))
      const y2 = Number(line.getAttribute('y2'))
      return { x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1) }
    })()`)
    if (!snapshot || snapshot.length < 15) throw new Error(`axis arrow missing/collapsed: ${JSON.stringify(snapshot)}`)
    return snapshot
  })

  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.hex-view-switch button')].find((node) => node.textContent.trim() === '2D')
    if (!button) throw new Error('2D button missing')
    button.click()
    return true
  })()`)
  await waitFor('UT4 2D interaction map', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut4-board-frame .hex-travel-map-host svg'))`)
    if (!ready) throw new Error('2D map not mounted')
    return true
  })

  await evaluate(client, `document.querySelector('[data-action-id="basic-move"]')?.click()`)
  const firstMoveTargets = await waitFor('UT4 Basic Move targets', async () => {
    const count = await evaluate(client, `document.querySelectorAll('.ut4-board-frame .hex-travel-cell.valid-target.move').length`)
    if (count < 1) throw new Error(`Basic Move target count ${count}`)
    return count
  })
  await evaluate(client, `(() => {
    const target = document.querySelector('.ut4-board-frame .hex-travel-cell.valid-target.move')
    if (!target) throw new Error('first Basic Move target missing')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
  await waitFor('UT4 first continuous Basic Move', async () => {
    const state = await evaluate(client, `({
      header: document.querySelector('.ut4-header-state')?.textContent ?? '',
      selected: document.querySelector('[data-action-id="basic-move"]')?.classList.contains('selected-action') ?? false,
      targets: document.querySelectorAll('.ut4-board-frame .hex-travel-cell.valid-target.move').length,
    })`)
    if (!state.header.includes('1.0 AT') || !state.selected || state.targets < 1) throw new Error(JSON.stringify(state))
    return state
  })
  await evaluate(client, `(() => {
    const target = document.querySelector('.ut4-board-frame .hex-travel-cell.valid-target.move')
    if (!target) throw new Error('second Basic Move target missing')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
  await waitFor('UT4 second continuous Basic Move', async () => {
    const state = await evaluate(client, `({
      header: document.querySelector('.ut4-header-state')?.textContent ?? '',
      selected: document.querySelector('[data-action-id="basic-move"]')?.classList.contains('selected-action') ?? false,
    })`)
    if (!state.header.includes('2.0 AT') || !state.selected) throw new Error(JSON.stringify(state))
    return state
  })

  await evaluate(client, `document.querySelector('[data-action-id="basic-move"]')?.click()`)
  await evaluate(client, `document.querySelector('[data-action-id="drive"]')?.click()`)
  const driveTargets = await waitFor('UT4 Drive board targets', async () => {
    const state = await evaluate(client, `({
      count: document.querySelectorAll('.ut4-board-frame .hex-travel-cell.valid-target.drive').length,
      selected: document.querySelector('[data-action-id="drive"]')?.classList.contains('selected-action') ?? false,
      directionGrid: Boolean(document.querySelector('.ut4-card-direction-grid')),
    })`)
    if (state.count < 1 || !state.selected || state.directionGrid) throw new Error(JSON.stringify(state))
    return state
  })

  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.visual-session-controls button')].find((node) => node.textContent.includes('重置状态'))
    if (!button) throw new Error('Reset State button missing')
    button.click()
    return true
  })()`)
  const resetThermal = await waitFor('UT4 neutral reset baseline', async () => {
    const snapshot = await evaluate(client, thermalSnapshotExpression)
    if (!snapshot.header.includes('0.0 AT') || !snapshot.header.includes('T 1.0') || snapshot.damping?.value !== 1) {
      throw new Error(JSON.stringify(snapshot))
    }
    return snapshot
  })

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut4-interactions.png'), Buffer.from(screenshot.data, 'base64'))
  await writeFile(join(artifactDir, 'ut4-interactions.json'), `${JSON.stringify({ initialThermal, axisArrow, firstMoveTargets, driveTargets, resetThermal }, null, 2)}\n`)

  console.log('UT4 thermal baseline, Movement Axis arrow, continuous Basic Move, and board-target Drive verified in real Chrome.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
