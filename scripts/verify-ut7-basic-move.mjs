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
  const root = document.querySelector('.inertia-field-ab[data-implementation="inertia-reachable-field-ab-v1"]')
  const stateText = root?.querySelector('.ifab-state-strip')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const profile = root?.querySelector('.ifab-profile')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const readout = root?.querySelector('.ifab-readout')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const board = root?.querySelector('.inertia-field-board')
  const activeMode = root?.querySelector('.ifab-mode-switch button.active')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const activePreset = root?.querySelector('.ifab-preset-grid button.active')?.textContent?.trim() ?? ''
  const radiusInput = root?.querySelector('[data-testid="ifab-radius"]')
  return {
    implementation: root?.dataset.implementation ?? '',
    mode: root?.dataset.spatialMode ?? '',
    targetCount: Number(root?.dataset.targetCount ?? 0),
    maxDistance: Number(root?.dataset.maxDistance ?? 0),
    stateText,
    profile,
    readout,
    activeMode,
    activePreset,
    radius: Number(radiusInput?.value ?? 0),
    canvas: Boolean(board?.querySelector('canvas')),
    boardMode: board?.dataset.mode ?? '',
    navButtons: [...document.querySelectorAll('.app-switcher nav button')].map((button) => button.textContent?.trim() ?? ''),
  }
})()`

const clickText = (scopeSelector, text) => `(() => {
  const scope = document.querySelector(${JSON.stringify(scopeSelector)})
  const button = [...(scope?.querySelectorAll('button') ?? [])].find((node) => node.textContent.trim() === ${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}))
  if (!button) throw new Error(${JSON.stringify(`button ${text} missing in ${scopeSelector}`)})
  button.click()
  return true
})()`

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ifab-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ifab-preview] ${chunk}`))
  await waitFor('Inertia field Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-inertia-field-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9229',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ifab-chrome] ${chunk}`))

  const version = await waitFor('Inertia field Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create inertia field Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1080, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('Inertia field A/B root', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.canvas || snapshot.implementation !== 'inertia-reachable-field-ab-v1') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(initial.mode === 'discrete' && initial.activePreset === 'M0', 'A/B prototype must start in Discrete M0', initial)
  assert(initial.maxDistance === 1 && initial.targetCount > 0, 'M0 must expose only the adjacent field', initial)
  assert(initial.navButtons.length === 2 && initial.navButtons[0].includes('Inertia Field'), 'Prototype navigation was not cleaned to the current experiment + graphics lab', initial)

  await evaluate(client, clickText('.ifab-preset-grid', 'M1'))
  const m1 = await waitFor('M1 compact field', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.activePreset !== 'M1' || snapshot.maxDistance !== 2 || !snapshot.profile.includes('3×3')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.ifab-preset-grid', 'M2'))
  const m2 = await waitFor('M2 short teardrop', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.activePreset !== 'M2' || snapshot.maxDistance !== 3 || !snapshot.profile.includes('teardrop')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.ifab-preset-grid', 'M3'))
  const m3 = await waitFor('M3 long teardrop', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.activePreset !== 'M3' || snapshot.maxDistance !== 4 || snapshot.targetCount <= m2.targetCount) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.ifab-mode-switch', 'Hybrid Spatial'))
  const hybrid = await waitFor('Hybrid spatial comparison mode', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.mode !== 'hybrid' || snapshot.boardMode !== 'hybrid' || !snapshot.activeMode.includes('Hybrid')) throw new Error(JSON.stringify(snapshot))
    if (snapshot.targetCount !== m3.targetCount || snapshot.maxDistance !== m3.maxDistance) throw new Error(`Hybrid changed Target Cell field: ${JSON.stringify(snapshot)}`)
    return snapshot
  })

  await evaluate(client, `(() => {
    const input = document.querySelector('[data-testid="ifab-radius"]')
    if (!input) throw new Error('Board Radius input missing')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '10')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  const radius10 = await waitFor('R10 focused board', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.radius !== 10 || !snapshot.readout.includes('331 Cells') || !snapshot.canvas) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut7-basic-move.png'), Buffer.from(screenshot.data, 'base64'))
  const result = { initial, m1, m2, m3, hybrid, radius10 }
  await writeFile(join(artifactDir, 'ut7-basic-move.json'), `${JSON.stringify(result, null, 2)}\n`)

  console.log('Inertia Reachable Field A/B verified in real Chrome: M0 ring, M1 compact rear-closed field, M2/M3 teardrops, identical Hybrid target set, focused navigation, and R10 board all mounted correctly.')
  console.log(JSON.stringify(result, null, 2))
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
