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
  constructor(url) { this.id = 1; this.pending = new Map(); this.socket = new WebSocket(url) }
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
  const root = document.querySelector('.cell-world-prototype[data-implementation="cell-world-spatial-ab-v2"]')
  const board = root?.querySelector('.cell-world-board')
  const cards = [...(root?.querySelectorAll('.action-card') ?? [])]
  const spatialButtons = [...(root?.querySelectorAll('[data-spatial-select]') ?? [])]
  const panelButtons = [...(root?.querySelectorAll('[data-spatial-panel-select]') ?? [])]
  const switcherButtons = [...document.querySelectorAll('.app-switcher nav button')]
  return {
    implementation: root?.dataset.implementation ?? '',
    authority: root?.dataset.authority ?? '',
    cellWorld: root?.dataset.cellWorld === 'true',
    spatialMode: root?.dataset.spatialMode ?? '',
    atVisualMs: Number(root?.dataset.atVisualMs ?? 0),
    solverSteps: Number(root?.dataset.solverSteps ?? 0),
    playing: root?.dataset.playing === 'true',
    worldAt: Number(root?.dataset.worldAt ?? -1),
    logicalX: Number(root?.dataset.logicalX ?? NaN),
    logicalZ: Number(root?.dataset.logicalZ ?? NaN),
    speed: Number(root?.dataset.speed ?? NaN),
    thermalTemperature: Number(root?.dataset.thermalTemperature ?? NaN),
    thermalDrift: Number(root?.dataset.thermalDrift ?? NaN),
    visualX: Number(board?.dataset.visualX ?? NaN),
    visualZ: Number(board?.dataset.visualZ ?? NaN),
    visualMomentum: Number(board?.dataset.visualMomentum ?? -1),
    frameProgress: Number(board?.dataset.playbackProgress ?? 0),
    instanceProbe: board?.dataset.instanceProbe ?? '',
    canvasCount: root?.querySelectorAll('canvas').length ?? 0,
    actionCardCount: cards.length,
    selectedActionId: cards.find((node) => node.classList.contains('selected'))?.dataset.actionId ?? '',
    spatialButtonCount: spatialButtons.length,
    panelButtonCount: panelButtons.length,
    topDiscretePressed: root?.querySelector('[data-spatial-select="discrete"]')?.getAttribute('aria-pressed') ?? '',
    topHybridPressed: root?.querySelector('[data-spatial-select="hybrid"]')?.getAttribute('aria-pressed') ?? '',
    panelDiscreteChosen: root?.querySelector('[data-spatial-panel-select="discrete"]')?.classList.contains('chosen') ?? false,
    panelHybridChosen: root?.querySelector('[data-spatial-panel-select="hybrid"]')?.classList.contains('chosen') ?? false,
    thermalPendulum: Boolean(root?.querySelector('.thermal-pendulum')),
    thermalZoneCount: root?.querySelectorAll('.thermal-zone').length ?? 0,
    cellInspector: Boolean(root?.querySelector('.cell-inspector')),
    worldLayerButtons: [...(root?.querySelectorAll('.wide-button') ?? [])].filter((node) => /Weather|Thermal/.test(node.textContent ?? '')).length,
    switcherButtonCount: switcherButtons.length,
    buildRevision: Boolean(document.querySelector('.app-switcher .build-revision')),
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
  await waitFor('Vite preview', async () => { const response = await fetch(pageUrl); if (!response.ok) throw new Error(`HTTP ${response.status}`); return true })

  const userDataDir = join(tmpdir(), `projectc-cell-world-v2-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229',
    `--user-data-dir=${userDataDir}`, '--window-size=1600,1100', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  await waitFor('Chrome DevTools', async () => { const response = await fetch(`${debugUrl}/json/version`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
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

  const initial = await waitFor('legacy-aligned Cell World prototype', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.canvasCount !== 1 || snapshot.implementation !== 'cell-world-spatial-ab-v2') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(initial.authority === 'cell-world-plus-spatial-state' && initial.cellWorld, 'Cell World runtime authority is missing', initial)
  assert(initial.atVisualMs === 800 && initial.solverSteps === 120, 'fixed AT / hybrid solver contract is incorrect', initial)
  assert(initial.spatialMode === 'discrete' && initial.spatialButtonCount === 2 && initial.panelButtonCount === 2, 'Spatial A/B controls are incomplete', initial)
  assert(initial.topDiscretePressed === 'true' && initial.topHybridPressed === 'false' && initial.panelDiscreteChosen, 'Discrete selected state is not visually reflected', initial)
  assert(initial.actionCardCount === 5 && initial.selectedActionId === 'drive', 'motion-card structure is incorrect', initial)
  assert(initial.thermalPendulum && initial.thermalZoneCount === 9, 'restored thermal pendulum is missing or incomplete', initial)
  assert(initial.switcherButtonCount === 3 && initial.buildRevision, 'global prototype switcher / revision placement is missing', initial)
  assert(initial.cellInspector && initial.worldLayerButtons >= 2, 'Cell inspector / world-layer UI missing', initial)
  assert(!initial.hasApply, 'Apply control leaked back into click-to-resolve input', initial)

  await evaluate(client, `document.querySelector('.cell-world-board').dataset.instanceProbe='same-board'`)

  // Verify the actual user-facing toolbar button, not the debug API.
  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-spatial-select="hybrid"]'); if(!button) return false; button.click(); return true })()`) === true, 'Hybrid toolbar button was not clickable')
  const hybridSwitch = await waitFor('Hybrid toolbar switch', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.spatialMode !== 'hybrid' || snapshot.topHybridPressed !== 'true' || !snapshot.panelHybridChosen) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(hybridSwitch.instanceProbe === 'same-board', 'Discrete/Hybrid replaced the board DOM instance', hybridSwitch)

  // Verify the mirrored right-panel control can also switch back.
  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-spatial-panel-select="discrete"]'); if(!button) return false; button.click(); return true })()`) === true, 'Discrete right-panel button was not clickable')
  const discreteSwitch = await waitFor('Discrete panel switch', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.spatialMode !== 'discrete' || snapshot.topDiscretePressed !== 'true' || !snapshot.panelDiscreteChosen) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(discreteSwitch.instanceProbe === 'same-board', 'shared board instance changed when switching back to Discrete', discreteSwitch)

  const discreteStart = Date.now()
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`) === true, 'Discrete Drive click-to-resolve failed')
  const discreteStarted = await waitFor('Discrete playback start', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.playing) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(discreteStarted.worldAt === 0 && Math.abs(discreteStarted.logicalX) < 0.001, 'Discrete logical state jumped at playback start', discreteStarted)
  await sleep(240)
  const discreteMid = await evaluate(client, snapshotExpression)
  assert(discreteMid.playing && discreteMid.worldAt === 0 && Math.abs(discreteMid.logicalX) < 0.001, 'Discrete logical state committed before fixed AT playback completed', discreteMid)
  const afterDiscrete = await waitFor('Discrete completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.playing || snapshot.worldAt !== 1) throw new Error(JSON.stringify(snapshot))
    return snapshot
  }, 110, 40)
  const discreteElapsedMs = Date.now() - discreteStart
  assert(discreteElapsedMs >= 700, `Discrete committed earlier than the fixed 800ms timebase allows: ${discreteElapsedMs}ms`, afterDiscrete)
  assert(Math.abs(afterDiscrete.logicalX - 1) < 0.05, 'Discrete result did not land at Cell center', afterDiscrete)
  assert(afterDiscrete.visualMomentum === 1, 'restored momentum markers did not receive M1 visual state', afterDiscrete)
  assert(Math.abs(afterDiscrete.thermalTemperature - initial.thermalTemperature) > 0.001 || Math.abs(afterDiscrete.thermalDrift - initial.thermalDrift) > 0.001, 'thermal pendulum state did not react to movement', afterDiscrete)

  await evaluate(client, `document.querySelector('.session-buttons button:last-child').click()`)
  await waitFor('Reset', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.worldAt !== 0 || Math.abs(snapshot.logicalX) > 0.001) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-spatial-select="hybrid"]'); button?.click(); return Boolean(button) })()`) === true, 'Hybrid toolbar button failed after reset')
  await waitFor('Hybrid mode after reset', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.spatialMode !== 'hybrid') throw new Error(JSON.stringify(snapshot))
    return snapshot
  })

  const hybridStart = Date.now()
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`) === true, 'Hybrid Drive click-to-resolve failed')
  const hybridStarted = await waitFor('Hybrid playback start', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.playing) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
  assert(hybridStarted.worldAt === 0 && Math.abs(hybridStarted.logicalX) < 0.001, 'Hybrid logical state jumped at playback start', hybridStarted)
  await sleep(240)
  const hybridMid = await evaluate(client, snapshotExpression)
  assert(hybridMid.playing && hybridMid.worldAt === 0 && Math.abs(hybridMid.logicalX) < 0.001, 'Hybrid logical state committed before fixed AT playback completed', hybridMid)
  const afterHybrid = await waitFor('Hybrid completion', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (snapshot.playing || snapshot.worldAt !== 1) throw new Error(JSON.stringify(snapshot))
    return snapshot
  }, 110, 40)
  const hybridElapsedMs = Date.now() - hybridStart
  assert(hybridElapsedMs >= 700, `Hybrid committed earlier than the fixed 800ms timebase allows: ${hybridElapsedMs}ms`, afterHybrid)
  assert(afterHybrid.logicalX > 0.72 && afterHybrid.logicalX < 0.95, 'Hybrid result did not remain at a continuous in-Cell position', afterHybrid)
  assert(Math.abs(afterHybrid.logicalX - afterDiscrete.logicalX) > 0.08, 'Discrete and Hybrid produced indistinguishable spatial results', { afterDiscrete, afterHybrid })
  assert(afterHybrid.instanceProbe === 'same-board', 'shared board instance was replaced during A/B execution', afterHybrid)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'cell-world-spatial-ab.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = { initial, hybridSwitch, discreteSwitch, discreteStarted, discreteMid, afterDiscrete, hybridStarted, hybridMid, afterHybrid, discreteElapsedMs, hybridElapsedMs }
  await writeFile(join(artifactDir, 'cell-world-spatial-ab.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log('Verified legacy-aligned UI: real Discrete/Hybrid buttons work, one shared board persists, thermal pendulum is live, momentum markers receive M, and fixed playback prevents early logical teleport.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
