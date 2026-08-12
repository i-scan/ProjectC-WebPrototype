import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4177'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#rules-lab`
const debuggingOrigin = 'http://127.0.0.1:9226'
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

const snapshotExpression = `(() => {
  const root = document.querySelector('.coupled-inertia-lab[data-ruleset="VAL-012-UT5"]')
  const header = root?.querySelector('.ut4-header-state')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const strip = root?.querySelector('.ut4-comparison-strip')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const hp = root?.querySelector('.ut4-player-card .visual-bars > div:first-child strong')?.textContent?.trim() ?? ''
  const driftRow = [...(root?.querySelectorAll('#ut5-thermal-debug .ut4-range') ?? [])].find((node) => node.querySelector('span')?.textContent.trim() === 'Drift')
  const drift = Number(driftRow?.querySelector('input')?.value ?? 0)
  const right = root?.querySelector('.ut4-debug-panel')
  const direct = right ? [...right.children].filter((node) => node.matches('section, details')) : []
  const lastDirect = direct.at(-1)
  return {
    header,
    strip,
    hp,
    drift,
    pageScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    nobodyDiesLast: lastDirect?.matches('[data-control="nobody-dies"]') ?? false,
    nobodyDiesText: right?.querySelector('[data-control="nobody-dies"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    surfaceLabels: [...document.querySelectorAll('.ut5-diagnostic-surface-overlay [data-surface-label]')].map((node) => node.getAttribute('data-surface-label')),
    reactionText: [...(right?.querySelectorAll('section') ?? [])].find((node) => node.querySelector('h3')?.textContent.includes('Reaction A/B'))?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  }
})()`

const setRangeExpression = (sectionSelector, label, value) => `(() => {
  const section = document.querySelector(${JSON.stringify(sectionSelector)})
  const row = [...section.querySelectorAll('.ut4-range')].find((node) => node.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)})
  const input = row?.querySelector('input[type="range"]')
  if (!input) throw new Error(${JSON.stringify(`range ${label} missing`)})
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(String(value))})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return Number(input.value)
})()`

const setSelectExpression = (sectionHeading, label, value) => `(() => {
  const section = [...document.querySelectorAll('.ut4-debug-panel section')].find((node) => node.querySelector('h3')?.textContent.includes(${JSON.stringify(sectionHeading)}))
  const row = [...section.querySelectorAll('.ut4-select-row')].find((node) => node.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)})
  const select = row?.querySelector('select')
  if (!select) throw new Error(${JSON.stringify(`select ${sectionHeading}/${label} missing`)})
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(select, ${JSON.stringify(value)})
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return select.value
})()`

const clickButtonExpression = (text) => `(() => {
  const button = [...document.querySelectorAll('.coupled-inertia-lab button')].find((node) => node.textContent.trim() === ${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}))
  if (!button) throw new Error(${JSON.stringify(`button ${text} missing`)})
  button.click()
  return true
})()`

async function reset(client) {
  await evaluate(client, clickButtonExpression('重置状态'))
  await sleep(80)
}

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4177', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ut5-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut5-preview] ${chunk}`))

  await waitFor('UT5 Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-ut5-axis-chrome-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9226',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut5-chrome] ${chunk}`))

  const version = await waitFor('UT5 Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })

  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create UT5 Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1080, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  await waitFor('UT5 inertia lab root', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.coupled-inertia-lab[data-ruleset="VAL-012-UT5"] .hex-board-host canvas'))`)
    if (!ready) throw new Error('UT5 lab / 3D board canvas not mounted')
    return true
  })
  await sleep(450)

  const initial = await evaluate(client, snapshotExpression)
  assert(initial.header.includes('0.0 AT') && initial.header.includes('M0') && initial.header.includes('None'), 'UT5 initial world state mismatch', initial)
  assert(initial.hp === '12/12', 'UT5 HP baseline mismatch', initial)
  assert(initial.pageScrollHeight <= initial.innerHeight + 2, 'UT5 primary page requires vertical page scrolling', initial)
  assert(initial.nobodyDiesLast && initial.nobodyDiesText.includes('Nobody Dies · ON'), 'Nobody Dies must be the final right-sidebar control and default ON', initial)
  assert(new Set(initial.surfaceLabels).size === 3 && initial.surfaceLabels.includes('Hard') && initial.surfaceLabels.includes('Reflect L') && initial.surfaceLabels.includes('Reflect R'), 'UT5 diagnostic surfaces are not visibly labelled', initial)
  assert(initial.reactionText.includes('Reaction Sidestep') && initial.reactionText.includes('Failed Fallback'), 'UT5 independent Reaction A/B controls missing', initial)

  await evaluate(client, clickButtonExpression('T -4'))
  await evaluate(client, setRangeExpression('#ut5-thermal-debug', 'Set Point', -2))
  await sleep(70)
  await evaluate(client, clickButtonExpression('+1 AT'))
  const cold = await waitFor('UT5 Cold Down build', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    const arrow = await evaluate(client, `Boolean(document.querySelector('.ut5-axis-overlay [data-actor-id="player"][data-axis="Down"][data-momentum="1"]'))`)
    if (!snapshot.header.includes('1.0 AT') || !snapshot.header.includes('M1') || !snapshot.header.includes('Down') || !arrow) throw new Error(JSON.stringify({ snapshot, arrow }))
    return { snapshot, arrow }
  })

  await reset(client)
  await evaluate(client, setSelectExpression('Spatial Debug', 'Axis', 'E'))
  await sleep(70)
  await evaluate(client, setSelectExpression('Spatial Debug', 'Momentum', '2'))
  await sleep(70)
  await evaluate(client, clickButtonExpression('+1 AT'))
  const neutral = await waitFor('UT5 Neutral persistent M', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    const arrow = await evaluate(client, `Boolean(document.querySelector('.ut5-axis-overlay [data-actor-id="player"][data-axis="E"][data-momentum="2"]'))`)
    if (!snapshot.header.includes('1.0 AT') || !snapshot.header.includes('M2') || !snapshot.header.includes('AxisE') || !arrow) throw new Error(JSON.stringify({ snapshot, arrow }))
    return { snapshot, arrow }
  })

  await reset(client)
  await evaluate(client, clickButtonExpression('heavy'))
  await evaluate(client, clickButtonExpression('Inject 0 AT'))
  const hit0 = await waitFor('UT5 0 AT hit', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('0.0 AT') || !snapshot.header.includes('T 1.0') || !snapshot.header.includes('M2') || !snapshot.header.includes('W') || snapshot.hp !== '10/12' || !(snapshot.drift > 0)) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await reset(client)
  await evaluate(client, clickButtonExpression('heavy'))
  await evaluate(client, clickButtonExpression('Hit + Resolve 1 AT'))
  const hit1 = await waitFor('UT5 same-AT hit thermal evolution', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('1.0 AT') || snapshot.header.includes('T 1.0') || snapshot.hp !== '10/12') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  // Reaction remains a choice while the 3D board is active. Validate the live
  // choice state via the enabled Decline control rather than querying 2D-only
  // SVG cell DOM.
  await reset(client)
  await evaluate(client, clickButtonExpression('Reaction Sidestep'))
  await evaluate(client, setSelectExpression('Spatial Debug', 'Axis', 'E'))
  await sleep(70)
  await evaluate(client, setSelectExpression('Spatial Debug', 'Momentum', '3'))
  await sleep(70)
  await evaluate(client, clickButtonExpression('heavy'))
  await evaluate(client, clickButtonExpression('Hit + Resolve 1 AT'))
  const reaction = await waitFor('UT5 Reaction Sidestep choice', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    const declineEnabled = await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('.ut4-debug-panel button')].find((node) => node.textContent.trim() === 'Decline Reaction')
      return Boolean(button && !button.disabled)
    })()`)
    if (!snapshot.strip.includes('Reaction Sidestep') || !snapshot.header.includes('0.0 AT') || !declineEnabled) throw new Error(JSON.stringify({ snapshot, declineEnabled }))
    return { snapshot, declineEnabled }
  })
  await evaluate(client, clickButtonExpression('Decline Reaction'))
  await waitFor('UT5 declined reaction completes same AT', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('1.0 AT') || snapshot.header.includes('T 1.0')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await reset(client)
  await evaluate(client, clickButtonExpression('2D'))
  await waitFor('UT5 2D board', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut4-board-frame .hex-travel-map-host svg'))`)
    if (!ready) throw new Error('2D board not ready')
    return true
  })
  await evaluate(client, `document.querySelector('[data-action-id="drive"]')?.click()`)
  await waitFor('UT5 W Axis selector', async () => {
    const valid = await evaluate(client, `document.querySelector('.hex-travel-cell[data-x="2"][data-y="3"]')?.classList.contains('valid-target') ?? false`)
    if (!valid) throw new Error('W selector (2,3) not valid')
    return true
  })
  await evaluate(client, `(() => {
    const cell = document.querySelector('.hex-travel-cell[data-x="2"][data-y="3"]')
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    return true
  })()`)
  const drivePreview = await waitFor('UT5 W DrivePlan preview', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.strip.includes('Drive W') || !snapshot.strip.includes('(2,3)') || !snapshot.strip.includes('(1,3)')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  await evaluate(client, `document.querySelector('.hex-travel-cell[data-x="2"][data-y="3"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  const drive = await waitFor('UT5 committed W DrivePlan', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('3.0 AT') || !snapshot.strip.includes('Selected (1,3)')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  }, 120, 100)
  assert(!drive.strip.includes('Redirect'), 'UT5 Drive must not auto-redirect around the Hard surface', drive)

  await mkdir(artifactDir, { recursive: true })
  const evidence = {
    initial,
    cold: cold.snapshot,
    neutral: neutral.snapshot,
    hit0,
    hit1,
    reaction: reaction.snapshot,
    drivePreview,
    drive,
  }
  await writeFile(join(artifactDir, 'ut5-axis-inertia.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut5-axis-inertia.png'), Buffer.from(screenshot.data, 'base64'))

  console.log('UT5 unified M+Axis, Down/Horizontal persistence, hit timing, active Reaction, Nobody Dies placement, and DrivePlan preview=execution verified in real Chrome.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
