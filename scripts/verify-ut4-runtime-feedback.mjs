import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4176'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#rules-lab`
const debuggingOrigin = 'http://127.0.0.1:9225'

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

const stateSnapshot = `(() => {
  const root = document.querySelector('.coupled-inertia-lab')
  const hp = root?.querySelector('.ut4-player-card .visual-bars > div:first-child strong')?.textContent?.trim() ?? ''
  const header = root?.querySelector('.ut4-header-state')?.textContent ?? ''
  const driftRow = [...(root?.querySelectorAll('#ut4-thermal-debug .ut4-range') ?? [])].find((node) => node.querySelector('span')?.textContent.trim() === 'Drift')
  const drift = Number(driftRow?.querySelector('input')?.value ?? 0)
  const surfaces = [...(root?.querySelectorAll('.ut4-diagnostic-surface-overlay [data-surface-label]') ?? [])].map((node) => node.getAttribute('data-surface-label'))
  const nobodyDies = root?.querySelector('[data-control="nobody-dies"]')
  return {
    hp,
    header,
    drift,
    surfaces,
    nobodyDiesText: nobodyDies?.textContent?.trim() ?? '',
    nobodyDiesPressed: nobodyDies?.getAttribute('aria-pressed') ?? '',
  }
})()`

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4176', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ut4-runtime-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut4-runtime-preview] ${chunk}`))

  await waitFor('UT4 runtime Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-ut4-runtime-chrome-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9225',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut4-runtime-chrome] ${chunk}`))

  const version = await waitFor('UT4 runtime Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create UT4 runtime Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1080, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  await waitFor('UT4 runtime lab', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.coupled-inertia-lab .hex-board-host canvas'))`)
    if (!ready) throw new Error('UT4 lab / 3D board is not ready')
    return true
  })
  await sleep(400)

  const initial = await evaluate(client, stateSnapshot)
  assert(initial.hp === '12/12', 'Lab HP baseline should be visible and compact', initial)
  assert(initial.header.includes('0.0 AT') && initial.header.includes('T 1.0'), 'Lab runtime baseline mismatch', initial)
  assert(initial.nobodyDiesPressed === 'true' && initial.nobodyDiesText.includes('ON'), 'Nobody Dies must default ON', initial)
  assert(new Set(initial.surfaces).size === 3 && initial.surfaces.includes('Hard') && initial.surfaces.includes('Reflect L') && initial.surfaces.includes('Reflect R'), 'UT4 diagnostic surfaces are not visibly labelled', initial)

  await evaluate(client, `(() => {
    const section = [...document.querySelectorAll('.ut4-debug-panel section')].find((node) => node.querySelector('h3')?.textContent.includes('Weapon / Inject Hit'))
    const heavy = [...section.querySelectorAll('.ut4-segmented button')].find((node) => node.textContent.trim() === 'heavy')
    if (!heavy) throw new Error('Heavy hit selector missing')
    heavy.click()
    return true
  })()`)

  const clickHit = async () => {
    await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('.ut4-debug-panel button')].find((node) => node.textContent.includes('Hit Player'))
      if (!button) throw new Error('Hit Player button missing')
      button.click()
      return true
    })()`)
    await sleep(70)
  }

  await clickHit()
  const afterOneHit = await evaluate(client, stateSnapshot)
  assert(afterOneHit.hp === '10/12', 'Heavy hit should visibly reduce Player HP', afterOneHit)
  assert(afterOneHit.header.includes('0.0 AT') && afterOneHit.header.includes('T 1.0'), 'Inject Hit must stay at 0 AT and not advance Temperature', afterOneHit)
  assert(afterOneHit.drift > 0, 'Inject Hit should immediately increase Drift', afterOneHit)

  for (let index = 0; index < 5; index += 1) await clickHit()
  const afterLethalCycle = await evaluate(client, stateSnapshot)
  assert(afterLethalCycle.hp === '12/12', 'Nobody Dies should refill HP after a lethal hit', afterLethalCycle)
  assert(afterLethalCycle.header.includes('0.0 AT'), 'Repeated Inject Hit events must still be 0 AT', afterLethalCycle)

  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.ut4-time-controls button')].find((node) => node.textContent.includes('+1 AT'))
    if (!button) throw new Error('+1 AT button missing')
    button.click()
    return true
  })()`)
  await waitFor('post-hit thermal evolution', async () => {
    const snapshot = await evaluate(client, stateSnapshot)
    if (!snapshot.header.includes('1.0 AT') || snapshot.header.includes('T 1.0')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, `(() => {
    const reset = [...document.querySelectorAll('.visual-session-controls button')].find((node) => node.textContent.includes('重置状态'))
    if (!reset) throw new Error('reset button missing')
    reset.click()
    return true
  })()`)
  await sleep(100)

  await evaluate(client, `(() => {
    const hot = [...document.querySelectorAll('.ut4-quick-row button')].find((node) => node.textContent.includes('T +4'))
    const twoD = [...document.querySelectorAll('.hex-view-switch button')].find((node) => node.textContent.trim() === '2D')
    if (!hot || !twoD) throw new Error('Hot quick set / 2D switch missing')
    hot.click()
    twoD.click()
    return true
  })()`)
  await waitFor('UT4 runtime 2D board', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut4-board-frame .hex-travel-map-host svg'))`)
    if (!ready) throw new Error('2D board not ready')
    return true
  })
  await evaluate(client, `document.querySelector('[data-action-id="drive"]')?.click()`)
  await waitFor('UT4 Hot Drive candidate', async () => {
    const count = await evaluate(client, `document.querySelectorAll('.hex-travel-cell.valid-target.drive').length`)
    if (!count) throw new Error('No Drive board candidates')
    return count
  })
  await evaluate(client, `document.querySelector('.hex-travel-cell.valid-target.drive')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await waitFor('UT4 Hot Drive Movement M', async () => {
    const header = await evaluate(client, `document.querySelector('.ut4-header-state')?.textContent ?? ''`)
    if (!header.includes('3.0 AT') || !header.includes('Movement M')) throw new Error(header)
    return header
  }, 100, 100)

  console.log('UT4 visible damage, Nobody Dies refill, 0 AT Hit timing, visible surfaces, and Hot Drive Movement M verified in real Chrome.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
