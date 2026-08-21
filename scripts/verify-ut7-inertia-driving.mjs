import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4179'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#hex-prototype`
const debuggingOrigin = 'http://127.0.0.1:9228'
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
  const root = document.querySelector('.ut7-actor-loop[data-ruleset="VAL-012-UT7-candidate"]')
  const header = root?.querySelector('.ut4-header-state')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const preview = root?.querySelector('.ut6-action-preview')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const route = root?.querySelector('.ut7-route-inspector')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const setup = root?.querySelector('.ut7-playground-setup')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const branch = root?.querySelector('[data-ut7-branch-choice]')
  const actorSelect = [...(root?.querySelectorAll('.ut4-select-row select') ?? [])].find((node) => [...node.options].some((option) => option.textContent.includes('Player')))
  const radiusInput = root?.querySelector('.ut7-playground-setup input[type="range"]')
  return {
    header,
    preview,
    route,
    setup,
    pageScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    actionCount: root?.querySelectorAll('.ut7-action-card').length ?? 0,
    boardCellCount: root?.querySelectorAll('.hex-travel-cell').length ?? 0,
    validTargets: root?.querySelectorAll('.hex-travel-cell.valid-target.drive').length ?? 0,
    routeRows: root?.querySelectorAll('.ut7-route-rows > div').length ?? 0,
    branchVisible: Boolean(branch),
    branchCount: branch?.querySelectorAll('button').length ?? 0,
    actorOptionCount: actorSelect?.options.length ?? 0,
    radius: Number(radiusInput?.value ?? 0),
    spawnEnemiesOn: Boolean(root?.querySelector('[data-control="spawn-enemies"]')?.classList.contains('active')),
    latestLog: root?.querySelector('.ut4-log-list article')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
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
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ut7-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut7-preview] ${chunk}`))
  await waitFor('UT7 Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-ut7-inertia-driving-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9228',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut7-chrome] ${chunk}`))

  const version = await waitFor('UT7 Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create UT7 Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1080, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  await waitFor('UT7 live root', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut7-actor-loop[data-ruleset="VAL-012-UT7-candidate"] .hex-board-host canvas'))`)
    if (!ready) throw new Error('UT7 root / 3D board canvas not mounted')
    return true
  })
  await sleep(450)

  const initial = await evaluate(client, snapshotExpression)
  assert(initial.header.includes('0.0 AT') && initial.header.includes('M0') && initial.header.includes('None'), 'UT7 initial state mismatch', initial)
  assert(initial.actionCount === 5, 'UT7 primary action row must focus on five driving actions', initial)
  assert(initial.radius === 7 && initial.spawnEnemiesOn && initial.actorOptionCount >= 4, 'UT7 Playground Setup defaults mismatch', initial)
  assert(initial.pageScrollHeight <= initial.innerHeight + 2, 'UT7 primary page requires vertical scrolling at 1366x1080', initial)

  await evaluate(client, clickText('.hex-view-switch', '2D'))
  await waitFor('UT7 2D target field', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.validTargets < 20) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickText('.ut7-preset-grid', 'm2-east'))
  const targetProbe = await evaluate(client, `(() => {
    const target = document.querySelector('.ut7-actor-loop .hex-travel-cell[data-x="8"][data-y="4"].valid-target.drive')
      ?? document.querySelector('.ut7-actor-loop .hex-travel-cell.valid-target.drive')
    if (!target) throw new Error('No UT7 valid target available for route hover probe')
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    return { x: target.dataset.x, y: target.dataset.y }
  })()`)
  const routePreview = await waitFor('UT7 route inspector', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.routeRows < 1 || !snapshot.route.includes('ETA') || !snapshot.route.match(/use|resist|generate/)) {
      throw new Error(JSON.stringify({ snapshot, targetProbe }))
    }
    return snapshot
  })

  const beforeEnemyToggle = await evaluate(client, snapshotExpression)
  await evaluate(client, `document.querySelector('.ut7-actor-loop [data-control="spawn-enemies"]').click(); true`)
  const enemiesOff = await waitFor('UT7 pure-driving enemy toggle', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.spawnEnemiesOn || snapshot.actorOptionCount !== 1 || snapshot.header !== beforeEnemyToggle.header) {
      throw new Error(JSON.stringify({ beforeEnemyToggle, snapshot }))
    }
    return snapshot
  })

  await evaluate(client, clickText('.ut7-preset-grid', 'm3-east'))
  const reverseTargetReady = await waitFor('UT7 exact reverse target', async () => {
    const exists = await evaluate(client, `Boolean(document.querySelector('.ut7-actor-loop .hex-travel-cell[data-x="4"][data-y="7"].valid-target.drive'))`)
    if (!exists) throw new Error('Expected pure-driving W3 reverse target (4,7) is not selectable')
    return true
  })
  await evaluate(client, `document.querySelector('.ut7-actor-loop .hex-travel-cell[data-x="4"][data-y="7"].valid-target.drive').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  const branchChoice = await waitFor('UT7 180-degree branch choice', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.branchVisible || snapshot.branchCount !== 2 || !snapshot.header.includes('0.0 AT')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, `document.querySelector('[data-ut7-branch="cw"]').click(); true`)
  const afterReverse = await waitFor('UT7 committed reverse steering', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.header.includes('0.0 AT') || snapshot.branchVisible || !snapshot.latestLog.match(/Steer \/ Horizontal|Steer \/ Generate/)) throw new Error(JSON.stringify(snapshot))
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
  const radius10 = await waitFor('UT7 real R10 topology rebuild', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.radius !== 10 || snapshot.actorOptionCount !== 1 || snapshot.boardCellCount !== 331 || !snapshot.header.includes('0.0 AT')) {
      throw new Error(JSON.stringify(snapshot))
    }
    return snapshot
  })

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut7-inertia-driving.png'), Buffer.from(screenshot.data, 'base64'))
  const result = { initial, routePreview, enemiesOff, reverseTargetReady, branchChoice, afterReverse, radius10 }
  await writeFile(join(artifactDir, 'ut7-inertia-driving.json'), `${JSON.stringify(result, null, 2)}\n`)

  console.log('UT7 inertia driving verified in real Chrome: target preview, pure-driving 180-degree branch choice, committed steering, Spawn Enemies preservation, and real R10 topology.')
  console.log(JSON.stringify({
    initial: initial.header,
    routePreview: routePreview.route,
    branchCount: branchChoice.branchCount,
    afterReverse: afterReverse.header,
    enemiesOffActors: enemiesOff.actorOptionCount,
    radiusAfterRebuild: radius10.radius,
    r10Cells: radius10.boardCellCount,
    primaryScrollHeight: radius10.pageScrollHeight,
  }, null, 2))
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
