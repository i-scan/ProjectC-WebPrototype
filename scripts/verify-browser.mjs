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
  const candidates = [
    process.env.CHROME_BIN,
    which('google-chrome'),
    which('google-chrome-stable'),
    which('chromium'),
    which('chromium-browser'),
  ].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

async function waitFor(label, operation, attempts = 200, delay = 50) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (index + 1 < attempts) await sleep(delay)
    }
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
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        this.socket.addEventListener('open', resolve, { once: true })
        this.socket.addEventListener('error', reject, { once: true })
      })
    }
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

  close() {
    this.socket.close()
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed')
  return response.result.value
}

const snapshotExpression = `(() => {
  const root = document.querySelector('.cell-world-prototype[data-implementation="cell-world-spatial-ab-v3"]')
  const board = root?.querySelector('.cell-world-board')
  const pendulum = root?.querySelector('.thermal-pendulum')
  const cards = [...(root?.querySelectorAll('.action-card') ?? [])]
  const spatialButtons = [...(root?.querySelectorAll('[data-spatial-select]') ?? [])]
  const panelButtons = [...(root?.querySelectorAll('[data-spatial-panel-select]') ?? [])]
  const timebaseSlider = root?.querySelector('[data-timebase-slider]')
  const canvas = board?.querySelector('canvas')
  const canvasRect = canvas?.getBoundingClientRect()
  return {
    implementation: root?.dataset.implementation ?? '',
    authority: root?.dataset.authority ?? '',
    cellWorld: root?.dataset.cellWorld === 'true',
    spatialMode: root?.dataset.spatialMode ?? '',
    actionId: root?.dataset.actionId ?? '',
    atVisualMs: Number(root?.dataset.atVisualMs ?? 0),
    solverSteps: Number(root?.dataset.solverSteps ?? 0),
    playing: root?.dataset.playing === 'true',
    worldAt: Number(root?.dataset.worldAt ?? -1),
    logicalX: Number(root?.dataset.logicalX ?? NaN),
    logicalZ: Number(root?.dataset.logicalZ ?? NaN),
    speed: Number(root?.dataset.speed ?? NaN),
    momentum: Number(root?.dataset.momentum ?? -1),
    visualX: Number(board?.dataset.visualX ?? NaN),
    visualZ: Number(board?.dataset.visualZ ?? NaN),
    visualMomentum: Number(board?.dataset.visualMomentum ?? -1),
    axisArrowLength: Number(board?.dataset.axisArrowLength ?? NaN),
    axisArrowThickness: Number(board?.dataset.axisArrowThickness ?? NaN),
    axisArrowMeaning: board?.dataset.axisArrowMeaning ?? '',
    previewStyle: board?.dataset.previewStyle ?? '',
    previewLengthMax: Number(board?.dataset.previewLengthMax ?? NaN),
    previewVisibleLength: Number(board?.dataset.previewVisibleLength ?? 0),
    frameProgress: Number(board?.dataset.playbackProgress ?? 0),
    playbackDurationMs: Number(board?.dataset.playbackDurationMs ?? 0),
    cameraZoom: Number(board?.dataset.cameraZoom ?? NaN),
    viewportWidth: Number(board?.dataset.viewportWidth ?? 0),
    viewportHeight: Number(board?.dataset.viewportHeight ?? 0),
    canvasWidth: Number(canvasRect?.width ?? 0),
    canvasHeight: Number(canvasRect?.height ?? 0),
    thermalVisualAt: Number(pendulum?.dataset.visualAt ?? NaN),
    thermalVisualTemperature: Number(pendulum?.dataset.visualTemperature ?? NaN),
    thermalCycleAt: Number(pendulum?.dataset.cycleAt ?? 0),
    instanceProbe: board?.dataset.instanceProbe ?? '',
    canvasCount: root?.querySelectorAll('canvas').length ?? 0,
    actionCardCount: cards.length,
    basicMoveCard: Boolean(root?.querySelector('[data-action-id="basic-move"]')),
    selectedActionId: cards.find((node) => node.classList.contains('selected'))?.dataset.actionId ?? '',
    spatialButtonCount: spatialButtons.length,
    panelButtonCount: panelButtons.length,
    topDiscretePressed: root?.querySelector('[data-spatial-select="discrete"]')?.getAttribute('aria-pressed') ?? '',
    topHybridPressed: root?.querySelector('[data-spatial-select="hybrid"]')?.getAttribute('aria-pressed') ?? '',
    panelDiscreteChosen: root?.querySelector('[data-spatial-panel-select="discrete"]')?.classList.contains('chosen') ?? false,
    panelHybridChosen: root?.querySelector('[data-spatial-panel-select="hybrid"]')?.classList.contains('chosen') ?? false,
    thermalPendulum: Boolean(pendulum),
    timebaseSlider: Boolean(timebaseSlider),
    timebaseSliderValue: Number(timebaseSlider?.value ?? 0),
    switcherButtonCount: document.querySelectorAll('.app-switcher nav button').length,
    hasApply: Boolean(root?.querySelector('[data-testid="impulse-commit"], .impulse-commit-row')),
  }
})()`

async function snapshot(client) {
  return evaluate(client, snapshotExpression)
}

async function waitForIdleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt} AT`, async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    return value
  }, 150, 40)
}

async function resetUi(client) {
  await evaluate(client, `document.querySelector('.session-buttons button:last-child')?.click()`)
  return waitFor('reset', async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== 0 || Math.abs(value.logicalX) > 0.001 || Math.abs(value.logicalZ) > 0.001) {
      throw new Error(JSON.stringify(value))
    }
    return value
  })
}

async function selectAction(client, id) {
  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-action-id="${id}"]'); if(!button) return false; button.click(); return true })()`) === true, `action ${id} button missing`)
  return waitFor(`action ${id}`, async () => {
    const value = await snapshot(client)
    if (value.actionId !== id || value.selectedActionId !== id) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setVelocity(client, x, z) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setVelocity(${x}, ${z})`) === true, 'debug velocity setter failed')
  return waitFor('velocity state', async () => {
    const value = await snapshot(client)
    if (Math.abs(value.speed - Math.hypot(x, z)) > 0.01) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setAtMs(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`) === true, 'AT timebase setter failed')
  return waitFor(`AT timebase ${value}`, async () => {
    const current = await snapshot(client)
    if (current.atVisualMs !== value || current.timebaseSliderValue !== value) throw new Error(JSON.stringify(current))
    return current
  })
}

let previewProcess
let chromeProcess
let client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))
  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-driving-polish-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9229',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1600,1100',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  await waitFor('Chrome DevTools', async () => {
    const response = await fetch(`${debugUrl}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }, 240, 50)

  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create browser target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Page.bringToFront')
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('driving-polished prototype', async () => {
    const value = await snapshot(client)
    if (value.canvasCount !== 1 || value.implementation !== 'cell-world-spatial-ab-v3') throw new Error(JSON.stringify(value))
    return value
  })

  assert(initial.authority === 'cell-world-plus-spatial-state' && initial.cellWorld, 'Cell World movement authority missing', initial)
  assert(initial.atVisualMs === 800 && initial.solverSteps === 120, 'default AT / solver contract changed', initial)
  assert(initial.actionCardCount === 6 && initial.basicMoveCard && initial.selectedActionId === 'drive', 'Basic Move / action set is incorrect', initial)
  assert(initial.axisArrowMeaning === 'direction-only' && Math.abs(initial.axisArrowLength - 0.54) < 0.001 && Math.abs(initial.axisArrowThickness - 0.07) < 0.001, 'short thick direction-only Axis arrow contract missing', initial)
  assert(initial.previewStyle === 'short-thick-dashed-curve' && Math.abs(initial.previewLengthMax - 1.55) < 0.001, 'short dashed preview contract missing', initial)
  assert(initial.thermalPendulum && initial.thermalCycleAt === 8 && initial.timebaseSlider, 'thermal cycle / timebase UI missing', initial)
  assert(initial.switcherButtonCount === 3, 'global prototype switcher regressed', initial)
  assert(initial.spatialButtonCount === 2 && initial.panelButtonCount === 2, 'Spatial A/B controls incomplete', initial)
  assert(!initial.hasApply, 'Apply / Confirm leaked into click-to-resolve input', initial)

  await evaluate(client, `document.querySelector('.cell-world-board').dataset.instanceProbe='same-board'`)

  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-spatial-select="hybrid"]'); if(!button) return false; button.click(); return true })()`) === true, 'Hybrid toolbar button not clickable')
  const hybridSwitch = await waitFor('Hybrid toolbar switch', async () => {
    const value = await snapshot(client)
    if (value.spatialMode !== 'hybrid' || value.topHybridPressed !== 'true' || !value.panelHybridChosen) throw new Error(JSON.stringify(value))
    return value
  })
  assert(hybridSwitch.instanceProbe === 'same-board', 'Hybrid replaced board instance', hybridSwitch)

  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-spatial-panel-select="discrete"]'); if(!button) return false; button.click(); return true })()`) === true, 'Discrete panel button not clickable')
  const discreteSwitch = await waitFor('Discrete panel switch', async () => {
    const value = await snapshot(client)
    if (value.spatialMode !== 'discrete' || value.topDiscretePressed !== 'true' || !value.panelDiscreteChosen) throw new Error(JSON.stringify(value))
    return value
  })
  assert(discreteSwitch.instanceProbe === 'same-board', 'Discrete replaced board instance', discreteSwitch)

  // Adjustable real-time playback: use 600ms / AT for Basic Move and verify thermal updates continuously.
  await setAtMs(client, 600)
  await selectAction(client, 'basic-move')
  const basicStart = Date.now()
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(4, 0)`) === true, 'Basic Move far-Aim input was rejected')
  const basicStarted = await waitFor('Basic Move playback start', async () => {
    const value = await snapshot(client)
    if (!value.playing || value.playbackDurationMs !== 600) throw new Error(JSON.stringify(value))
    return value
  })
  assert(basicStarted.worldAt === 0 && Math.abs(basicStarted.logicalX) < 0.001, 'Basic Move committed logical state early', basicStarted)
  const stableViewport = {
    cameraZoom: basicStarted.cameraZoom,
    viewportWidth: basicStarted.viewportWidth,
    viewportHeight: basicStarted.viewportHeight,
    canvasWidth: basicStarted.canvasWidth,
    canvasHeight: basicStarted.canvasHeight,
  }

  await sleep(180)
  const basicMid = await snapshot(client)
  assert(basicMid.playing && basicMid.worldAt === 0 && Math.abs(basicMid.logicalX) < 0.001, 'Basic Move committed before configured playback completed', basicMid)
  assert(basicMid.thermalVisualAt > 0.05 && basicMid.thermalVisualAt < 0.8, 'thermal pendulum did not advance continuously inside the movement AT', basicMid)
  assert(Math.abs(basicMid.thermalVisualTemperature - initial.thermalVisualTemperature) > 0.001, 'thermal temperature stayed frozen during movement playback', basicMid)
  assert(Math.abs(basicMid.cameraZoom - stableViewport.cameraZoom) < 0.0001, 'camera zoom changed during playback', { stableViewport, basicMid })
  assert(basicMid.viewportWidth === stableViewport.viewportWidth && basicMid.viewportHeight === stableViewport.viewportHeight, 'board viewport resized during playback', { stableViewport, basicMid })
  assert(Math.abs(basicMid.canvasWidth - stableViewport.canvasWidth) < 0.5 && Math.abs(basicMid.canvasHeight - stableViewport.canvasHeight) < 0.5, 'canvas geometry changed during playback', { stableViewport, basicMid })

  const afterBasic = await waitForIdleAt(client, 1)
  const basicElapsedMs = Date.now() - basicStart
  assert(basicElapsedMs >= 520, `Basic Move committed before configured 600ms timebase: ${basicElapsedMs}ms`, afterBasic)
  assert(afterBasic.logicalX > 0.94 && afterBasic.logicalX < 1.06 && Math.abs(afterBasic.logicalZ) < 0.05, 'Basic Move treated far Aim as destination instead of direction', afterBasic)
  assert(afterBasic.momentum === 0 && afterBasic.speed < 0.01, 'Basic Move incorrectly created Momentum at rest', afterBasic)
  await setAtMs(client, 800)

  // Discrete Drive: a 120° Aim must be valid; result direction comes from V + ΔV.
  await resetUi(client)
  await selectAction(client, 'drive')
  await setVelocity(client, 0.85, 0)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0, -2)`) === true, 'Discrete Drive still rejects a 120-degree impulse Aim')
  await waitFor('Discrete turning playback start', async () => {
    const value = await snapshot(client)
    if (!value.playing) throw new Error(JSON.stringify(value))
    return value
  })
  const afterDiscreteTurn = await waitForIdleAt(client, 1)
  const discreteState = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
  assert(discreteState.velocity.x > 0.3 && discreteState.velocity.x < 0.6 && discreteState.velocity.z < -0.6, 'Discrete Drive did not use current Velocity + impulse vector', discreteState)
  assert(afterDiscreteTurn.logicalX > 0.45 && afterDiscreteTurn.logicalX < 0.55 && afterDiscreteTurn.logicalZ < -0.82, 'Discrete Drive did not turn to the mixed direction Cell', afterDiscreteTurn)

  // Hybrid: same input must produce a smooth bounded curve with the exact same resultant velocity.
  await resetUi(client)
  await setVelocity(client, 0.85, 0)
  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-spatial-select="hybrid"]'); button?.click(); return Boolean(button) })()`) === true, 'Hybrid switch failed before curved turn test')
  await waitFor('Hybrid mode for curve test', async () => {
    const value = await snapshot(client)
    if (value.spatialMode !== 'hybrid') throw new Error(JSON.stringify(value))
    return value
  })
  await selectAction(client, 'drive')
  const hybridTurnStart = Date.now()
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0, -2)`) === true, 'Hybrid Drive still rejects a 120-degree impulse Aim')
  const hybridTurnStarted = await waitFor('Hybrid curved playback start', async () => {
    const value = await snapshot(client)
    if (!value.playing) throw new Error(JSON.stringify(value))
    return value
  })
  const trajectory = await waitFor('Hybrid trajectory samples', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (!samples || samples.length < 100) throw new Error(`samples=${samples?.length ?? 0}`)
    return samples
  })
  const midpoint = trajectory[Math.floor(trajectory.length / 2)].position
  const endpoint = trajectory.at(-1).position
  const cross = midpoint.x * endpoint.z - midpoint.z * endpoint.x
  assert(Math.abs(cross) > 0.015, 'Hybrid turn trajectory is still visually straight / collinear', { midpoint, endpoint, cross })
  assert(Math.abs(trajectory[0].velocity.x - 0.85) < 0.01 && Math.abs(trajectory[0].velocity.z) < 0.01, 'Hybrid curve lost the incoming Velocity tangent', trajectory[0])

  await sleep(240)
  const hybridTurnMid = await snapshot(client)
  assert(hybridTurnMid.playing && hybridTurnMid.worldAt === 0 && Math.abs(hybridTurnMid.logicalX) < 0.001 && Math.abs(hybridTurnMid.logicalZ) < 0.001, 'Hybrid curved playback committed logical state early', hybridTurnMid)
  const afterHybridTurn = await waitForIdleAt(client, 1)
  const hybridElapsedMs = Date.now() - hybridTurnStart
  const hybridState = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
  assert(hybridElapsedMs >= 700, `Hybrid curve committed before default 800ms timebase: ${hybridElapsedMs}ms`, afterHybridTurn)
  assert(hybridState.velocity.x > 0.3 && hybridState.velocity.x < 0.6 && hybridState.velocity.z < -0.6, 'Hybrid final Velocity does not equal the mixed impulse result', hybridState)
  assert(afterHybridTurn.logicalX > 0.38 && afterHybridTurn.logicalX < 0.48 && afterHybridTurn.logicalZ < -0.68, 'Hybrid endpoint is not the continuous vector-sum endpoint', afterHybridTurn)
  assert(afterHybridTurn.instanceProbe === 'same-board', 'shared board instance changed during driving polish tests', afterHybridTurn)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'driving-polish-v1.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = {
    initial,
    hybridSwitch,
    discreteSwitch,
    basicStarted,
    basicMid,
    afterBasic,
    basicElapsedMs,
    stableViewport,
    afterDiscreteTurn,
    discreteState,
    hybridTurnStarted,
    hybridTurnMid,
    afterHybridTurn,
    hybridState,
    hybridElapsedMs,
    curve: { midpoint, endpoint, cross, sampleCount: trajectory.length },
  }
  await writeFile(join(artifactDir, 'driving-polish-v1.json'), `${JSON.stringify(evidence, null, 2)}\n`)

  console.log('Verified driving polish: short thick direction-only Axis arrow; short dashed curve preview contract; adjustable AT playback; continuous 8-AT thermal clock; stable camera/viewport during playback; exact V + ΔV result; bounded Hybrid curve; delayed logical commit.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
