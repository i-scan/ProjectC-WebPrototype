import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4178'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#hex-prototype`
const debuggingOrigin = 'http://127.0.0.1:9227'
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

async function waitFor(label, operation, attempts = 160, delay = 100) {
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
  const root = document.querySelector('.ut6-actor-loop[data-ruleset="VAL-012-UT6-candidate"]')
  const header = root?.querySelector('.ut4-header-state')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const preview = root?.querySelector('.ut6-action-preview')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  const move = root?.querySelector('[data-action-id="basic-move"]')
  const attack = root?.querySelector('[data-action-id="basic-attack"]')
  const raikiri = root?.querySelector('[data-action-id="raikiri"]')
  const board = root?.querySelector('.hex-board-host')
  const latestLog = root?.querySelector('.ut4-log-list article')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  return {
    header,
    preview,
    latestLog,
    pageScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    actionCount: root?.querySelectorAll('.ut6-action-card').length ?? 0,
    presetCount: root?.querySelectorAll('.ut6-preset-grid button').length ?? 0,
    abControlCount: root?.querySelectorAll('.ut6-toggle-list button').length ?? 0,
    moveSelected: Boolean(move?.classList.contains('selected-action')),
    attackSelected: Boolean(attack?.classList.contains('selected-action')),
    raikiriText: raikiri?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    validTargets: root?.querySelectorAll('.hex-travel-cell.valid-target.drive').length ?? 0,
    at0Open: Boolean(root?.querySelector('.ut6-at0-banner.open')),
    at0Text: root?.querySelector('.ut6-at0-banner')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    axisArrow: Boolean(root?.querySelector('.actor-axis-overlay [data-actor-id="player"]')),
    playbackStartCount: Number(board?.dataset.playbackStartCount ?? 0),
    playbackEventId: board?.dataset.playbackEventId ?? null,
    damageFeedbackCount: Number(board?.dataset.damageFeedbackCount ?? 0),
    lastDamageAmount: Number(board?.dataset.lastDamageAmount ?? 0),
    impactVisible: Boolean(board?.querySelector('.hex-board-impact-feedback')),
  }
})()`

const clickButtonExpression = (selector, text) => `(() => {
  const scope = document.querySelector(${JSON.stringify(selector)})
  const button = [...(scope?.querySelectorAll('button') ?? [])].find((node) => node.textContent.trim() === ${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}))
  if (!button) throw new Error(${JSON.stringify(`button ${text} missing in ${selector}`)})
  button.click()
  return true
})()`

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4178', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[ut6-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut6-preview] ${chunk}`))

  await waitFor('UT6 Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-ut6-actor-loop-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9227',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[ut6-chrome] ${chunk}`))

  const version = await waitFor('UT6 Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })

  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create UT6 Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1080, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  await waitFor('UT6 Actor Loop root', async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.ut6-actor-loop[data-ruleset="VAL-012-UT6-candidate"] .hex-board-host canvas'))`)
    if (!ready) throw new Error('UT6 root / 3D board canvas not mounted')
    return true
  })
  await sleep(450)

  const initial = await evaluate(client, snapshotExpression)
  assert(initial.header.includes('0.0 AT') && initial.header.includes('M0') && initial.header.includes('None'), 'UT6 initial state mismatch', initial)
  assert(initial.actionCount === 7, 'UT6 candidate action set must contain seven action cards', initial)
  assert(initial.presetCount === 5, 'UT6 preset strip is incomplete', initial)
  assert(initial.abControlCount === 4, 'UT6 A/B toggle strip is incomplete', initial)
  assert(initial.pageScrollHeight <= initial.innerHeight + 2, 'UT6 primary page requires vertical scrolling at 1366x1080', initial)

  await evaluate(client, clickButtonExpression('.hex-view-switch', '2D'))
  await evaluate(client, `document.querySelector('[data-action-id="basic-move"]').click(); true`)
  const moveReady = await waitFor('UT6 Basic Move board targets', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.moveSelected || snapshot.validTargets < 1 || !snapshot.preview.includes('Basic Move')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  await evaluate(client, `document.querySelector('.hex-travel-cell.valid-target.drive').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  const afterMove = await waitFor('UT6 Basic Move completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('1.0 AT') || !snapshot.header.includes('M1') || !snapshot.moveSelected) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickButtonExpression('.ut6-preset-grid', 'release'))
  const releasePreset = await waitFor('UT6 release preset', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('0.0 AT') || !snapshot.header.includes('T 4.0') || !snapshot.header.includes('M3') || !snapshot.header.includes('Axis E')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  await evaluate(client, `document.querySelector('[data-action-id="raikiri"]').click(); true`)
  const afterRaikiri = await waitFor('UT6 Raikiri release and AT0 window', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('1.0 AT') || !snapshot.at0Open || !snapshot.at0Text.includes('0 AT')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, `document.querySelector('[data-action-id="basic-attack"]').click(); true`)
  await waitFor('UT6 AT0 Basic Attack target', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.attackSelected || snapshot.validTargets < 1) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  await evaluate(client, `document.querySelector('.hex-travel-cell.valid-target.drive').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`)
  const afterAt0Attack = await waitFor('UT6 AT0 Basic Attack completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('1.0 AT') || snapshot.at0Open || !snapshot.attackSelected || !snapshot.latestLog.includes('Damage 1')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, clickButtonExpression('.hex-view-switch', '3D'))
  const playbackBeforeHover = await waitFor('UT6 one-shot attack playback in 3D', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.axisArrow || snapshot.playbackStartCount !== 1 || !snapshot.playbackEventId) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  await evaluate(client, `(() => {
    const canvas = document.querySelector('.ut6-actor-loop .hex-board-host canvas')
    if (!canvas) throw new Error('UT6 3D canvas missing for hover replay probe')
    const rect = canvas.getBoundingClientRect()
    const points = [
      [.34, .42], [.42, .48], [.50, .53], [.58, .46], [.65, .39],
      [.55, .58], [.45, .62], [.37, .54], [.60, .60], [.48, .37],
    ]
    for (const [x, y] of points) {
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 7,
        clientX: rect.left + rect.width * x,
        clientY: rect.top + rect.height * y,
      }))
    }
    return true
  })()`)
  await sleep(260)
  const playbackAfterHover = await evaluate(client, snapshotExpression)
  assert(
    playbackAfterHover.playbackStartCount === playbackBeforeHover.playbackStartCount
      && playbackAfterHover.playbackEventId === playbackBeforeHover.playbackEventId,
    'Hovering across Hex cells replayed the committed Attack event',
    { playbackBeforeHover, playbackAfterHover },
  )

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'ut6-actor-loop.png'), Buffer.from(screenshot.data, 'base64'))
  const result = { initial, moveReady, afterMove, releasePreset, afterRaikiri, afterAt0Attack, playbackBeforeHover, playbackAfterHover }
  await writeFile(join(artifactDir, 'ut6-actor-loop.json'), `${JSON.stringify(result, null, 2)}\n`)

  console.log('UT6 Actor Loop verified in real Chrome: HP damage is logged, Attack playback is one-shot across hover, plus existing move/release/AT0/axis contracts.')
  console.log(JSON.stringify({
    initial: initial.header,
    afterMove: afterMove.header,
    afterRaikiri: afterRaikiri.header,
    afterAt0Attack: afterAt0Attack.header,
    attackLog: afterAt0Attack.latestLog,
    playbackStartsBeforeHover: playbackBeforeHover.playbackStartCount,
    playbackStartsAfterHover: playbackAfterHover.playbackStartCount,
    primaryScrollHeight: playbackAfterHover.pageScrollHeight,
  }, null, 2))
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
