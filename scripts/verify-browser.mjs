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

async function waitFor(label, operation, attempts = 220, delay = 45) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation() } catch (error) {
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
  close() { this.socket.close() }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed')
  return response.result.value
}

const snapshotExpression = `(() => {
  const root = document.querySelector('.cell-world-prototype[data-implementation="cell-world-spatial-ab-v3"]')
  const board = root?.querySelector('.cell-world-board')
  const pendulum = root?.querySelector('.thermal-pendulum')
  const axis = root?.querySelector('.unified-axis-hud')
  const canvas = board?.querySelector('canvas')
  const rect = canvas?.getBoundingClientRect()
  return {
    implementation: root?.dataset.implementation ?? '',
    authority: root?.dataset.authority ?? '',
    basicRules: root?.dataset.basicMoveRules ?? '',
    actionId: root?.dataset.actionId ?? '',
    spatialMode: root?.dataset.spatialMode ?? '',
    playing: root?.dataset.playing === 'true',
    worldAt: Number(root?.dataset.worldAt ?? -1),
    logicalX: Number(root?.dataset.logicalX ?? NaN),
    logicalZ: Number(root?.dataset.logicalZ ?? NaN),
    speed: Number(root?.dataset.speed ?? NaN),
    momentum: Number(root?.dataset.momentum ?? -1),
    axisId: root?.dataset.axisId ?? '',
    atVisualMs: Number(root?.dataset.atVisualMs ?? 0),
    thermalPeriodAt: Number(root?.dataset.thermalPeriodAt ?? 0),
    reachableCount: Number(root?.dataset.reachableCount ?? -1),
    pushAtomic: root?.dataset.pushAtomic ?? '',
    solverSteps: Number(root?.dataset.solverSteps ?? 0),
    axisUi: axis?.dataset.axisUi ?? '',
    unifiedAxisKind: axis?.dataset.axisKind ?? '',
    unifiedAxisId: axis?.dataset.axisId ?? '',
    unifiedAxisLevel: Number(axis?.dataset.axisLevel ?? -1),
    unifiedTurnRadius: Number(axis?.dataset.turnRadius ?? -1),
    unifiedRange: Number(axis?.dataset.range ?? -1),
    middlePan: board?.dataset.middlePan ?? '',
    previewAuthority: board?.dataset.previewAuthority ?? '',
    cameraZoom: Number(board?.dataset.cameraZoom ?? NaN),
    cameraTargetX: Number(board?.dataset.cameraTargetX ?? NaN),
    cameraTargetZ: Number(board?.dataset.cameraTargetZ ?? NaN),
    viewportWidth: Number(board?.dataset.viewportWidth ?? 0),
    viewportHeight: Number(board?.dataset.viewportHeight ?? 0),
    canvasWidth: Number(rect?.width ?? 0),
    canvasHeight: Number(rect?.height ?? 0),
    thermalVisualAt: Number(pendulum?.dataset.visualAt ?? NaN),
    thermalCycleAt: Number(pendulum?.dataset.cycleAt ?? 0),
    thermalPlaybackInterpolation: pendulum?.dataset.playbackInterpolation ?? '',
    actionCardCount: root?.querySelectorAll('.action-card').length ?? 0,
    resetDisabled: Boolean(root?.querySelector('.session-buttons button:last-child')?.disabled),
  }
})()`

async function snapshot(client) { return evaluate(client, snapshotExpression) }

async function waitForIdleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt} AT`, async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    return value
  }, 180, 40)
}

async function resetUi(client) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reset()`) === true, 'debug reset failed')
  return waitFor('reset', async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== 0 || Math.abs(value.logicalX) > 0.001 || Math.abs(value.logicalZ) > 0.001) throw new Error(JSON.stringify(value))
    return value
  })
}

async function selectAction(client, id) {
  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-action-id="${id}"]'); if(!button) return false; button.click(); return true })()`) === true, `action ${id} button missing`)
  return waitFor(`action ${id}`, async () => {
    const value = await snapshot(client)
    if (value.actionId !== id) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setKinematics(client, axisId, level) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axisId)}, ${level})`) === true, 'setKinematics failed')
  return waitFor(`kinematics ${axisId} M${level}`, async () => {
    const value = await snapshot(client)
    const expectedAxis = axisId === 'none' ? 'none' : axisId
    if (value.axisId !== expectedAxis || value.momentum !== level) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setThermalPeriod(client, period) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setThermalPeriod(${period})`) === true, 'Thermal period setter failed')
  return waitFor(`Thermal period ${period}`, async () => {
    const value = await snapshot(client)
    if (value.thermalPeriodAt !== period || value.thermalCycleAt !== period) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setAtMs(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`) === true, 'AT timebase setter failed')
  return waitFor(`AT timebase ${value}`, async () => {
    const current = await snapshot(client)
    if (current.atVisualMs !== value) throw new Error(JSON.stringify(current))
    return current
  })
}

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

  const userDataDir = join(tmpdir(), `projectc-foundation-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229',
    `--user-data-dir=${userDataDir}`, '--window-size=1600,1100', 'about:blank',
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
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('fully initialized visible map', async () => {
    const value = await snapshot(client)
    const ready = value.implementation === 'cell-world-spatial-ab-v3'
      && value.actionCardCount === 6
      && value.axisUi === 'unified-v2'
      && Number.isFinite(value.cameraZoom)
      && value.viewportWidth >= 700
      && value.viewportHeight >= 300
      && value.canvasWidth >= 700
      && value.canvasHeight >= 300
    if (!ready) throw new Error(JSON.stringify(value))
    return value
  })
  assert(initial.authority === 'cell-world-plus-spatial-state', 'movement authority missing', initial)
  assert(initial.basicRules === 'axis-build-turn-radius-v2', 'foundation Basic Move rules missing', initial)
  assert(initial.pushAtomic === 'true', 'atomic push contract missing', initial)
  assert(initial.thermalPeriodAt === 8 && initial.thermalCycleAt === 8, 'default Thermal cycle changed', initial)
  assert(initial.thermalPlaybackInterpolation === 'single-at-monotonic', 'single-AT thermal presentation mode missing', initial)
  assert(initial.previewAuthority === 'solver-cell-path-v2', 'solver-authoritative path preview regressed', initial)
  assert(initial.middlePan === 'enabled', 'middle-button board pan capability missing', initial)
  assert(!initial.resetDisabled, 'Reset must remain available as a playback escape hatch', initial)
  assert(initial.viewportHeight >= 300 && initial.canvasHeight >= 300, 'map canvas collapsed or invisible', initial)

  const thermal4 = await setThermalPeriod(client, 4)
  const thermal6 = await setThermalPeriod(client, 6)
  const thermal8 = await setThermalPeriod(client, 8)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setAtMs(client, 350)
  await setKinematics(client, 'none', 0)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1, -1)`) === true, 'M0 Axis-establish move rejected')
  const afterEstablish = await waitForIdleAt(client, 1)
  assert(afterEstablish.axisId === 'NE' && afterEstablish.momentum === 0, 'M0 Basic Move did not establish Axis without building M', afterEstablish)

  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, -2)`) === true, 'same-Axis M0 build move rejected')
  const afterM0Build = await waitForIdleAt(client, 2)
  assert(afterM0Build.axisId === 'NE' && afterM0Build.momentum === 1, 'same-Axis M0 Basic Move did not build M1', afterM0Build)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setAtMs(client, 300)
  await setKinematics(client, 'E', 2)
  const reachM2 = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reachability()`)
  assert(reachM2.length >= 4 && !reachM2.some((entry) => entry.aimId === 'W'), 'M2 steering envelope accepted the opposite Axis', reachM2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1, 0)`) === true, 'same-Axis M2 move rejected')
  const afterM2Build = await waitForIdleAt(client, 1)
  assert(afterM2Build.logicalX > 1.94 && afterM2Build.logicalX < 2.06 && afterM2Build.momentum === 3 && afterM2Build.axisId === 'E', 'M2 same-Axis move did not resolve Range2 and build M3', afterM2Build)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0, -1)`) === true, 'M2 steering move rejected')
  const m2Trajectory = await waitFor('M2 steering trajectory', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (!samples || samples.length < 3) throw new Error(`samples=${samples?.length ?? 0}`)
    return samples
  })
  const afterM2Turn = await waitForIdleAt(client, 1)
  assert(afterM2Turn.logicalX > 1.45 && afterM2Turn.logicalX < 1.55 && afterM2Turn.logicalZ < -0.82 && afterM2Turn.logicalZ > -0.91, 'M2 turn path is not E -> NE', { afterM2Turn, m2Trajectory })
  assert(afterM2Turn.momentum === 1 && afterM2Turn.axisId === 'NW', 'M2 steering did not spend one M / finish redirected Axis', afterM2Turn)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'E', 3)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0, -1)`) === true, 'M3 steering move rejected')
  const m3Trajectory = await waitFor('M3 Range3 trajectory', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (!samples || samples.length < 4) throw new Error(`samples=${samples?.length ?? 0}`)
    return samples
  })
  const afterM3Turn = await waitForIdleAt(client, 1)
  assert(afterM3Turn.logicalX > 0.94 && afterM3Turn.logicalX < 1.06 && afterM3Turn.logicalZ < -1.68 && afterM3Turn.logicalZ > -1.78, 'M3 did not produce the wider Range3 turn-radius path', { afterM3Turn, m3Trajectory })
  assert(afterM3Turn.momentum === 2, 'M3 steering did not spend exactly one M', afterM3Turn)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(-1, 0)`) === false, '180-degree M2 Basic Move was accepted')
  const afterOpposite = await snapshot(client)
  assert(!afterOpposite.playing && afterOpposite.worldAt === 0 && afterOpposite.axisId === 'E' && afterOpposite.momentum === 2, 'opposite input corrupted state or entered playback', afterOpposite)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reset()`) === true, 'Reset stopped responding after opposite input')
  await waitForIdleAt(client, 0)

  // Reproduce the old one-sample freeze: M0 reaches an occupied Cell and is blocked.
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`) === true, 'Wall conflict setup failed')
  await setKinematics(client, 'E', 0)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1, 0)`) === true, 'M0 setup move before occupied Cell failed')
  await waitForIdleAt(client, 1)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`) === true, 'M0 occupied-Cell resolution failed to start')
  const afterBlockedM0 = await waitForIdleAt(client, 2)
  assert(afterBlockedM0.logicalX > 0.94 && afterBlockedM0.logicalX < 1.06 && afterBlockedM0.momentum === 0, 'M0 occupancy block did not finish safely', afterBlockedM0)

  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('chain')`) === true, 'Chain conflict setup failed')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1, 1)`) === true, 'Chain conflict action rejected')
  const afterChain = await waitForIdleAt(client, 1)
  const chainState = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
  const chainCells = Object.fromEntries(chainState.actors.map((actor) => [actor.id, actor.hex]))
  assert(JSON.stringify(chainCells) === JSON.stringify({ 'dummy-a': { q: 4, r: 1 }, 'dummy-b': { q: 5, r: 1 }, 'dummy-c': { q: 6, r: 1 } }), 'atomic knockback chain resolved to wrong Cells', { chainCells, afterChain })

  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`) === true, 'Wall conflict setup failed')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1, 0)`) === true, 'Wall conflict action rejected')
  const afterWall = await waitForIdleAt(client, 1)
  const wallState = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
  assert(afterWall.logicalX > 0.94 && afterWall.logicalX < 1.06, 'player entered occupied wall-blocked Cell', afterWall)
  assert(wallState.actors[0].hex.q === 2 && wallState.actors[0].hex.r === 0, 'wall-blocked defender moved despite atomic preflight', wallState)

  // Hybrid impulse A/B remains available after the Discrete foundation changes.
  await resetUi(client)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setSpatialMode('hybrid')`) === true, 'Hybrid switch failed')
  await selectAction(client, 'drive')
  await setKinematics(client, 'E', 1)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0, -2)`) === true, 'Hybrid Drive rejected test Aim')
  const hybridTrajectory = await waitFor('Hybrid trajectory', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (!samples || samples.length < 100) throw new Error(`samples=${samples?.length ?? 0}`)
    return samples
  })
  await waitForIdleAt(client, 1)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'foundation-rules-cell-conflict.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = {
    initial,
    thermal4,
    thermal6,
    thermal8,
    afterEstablish,
    afterM0Build,
    reachM2,
    afterM2Build,
    m2Trajectory,
    afterM2Turn,
    m3Trajectory,
    afterM3Turn,
    afterOpposite,
    afterBlockedM0,
    chainState,
    wallState,
    hybridSampleCount: hybridTrajectory.length,
  }
  await writeFile(join(artifactDir, 'foundation-rules-cell-conflict.json'), `${JSON.stringify(evidence, null, 2)}\n`)

  console.log('Verified adjustable Thermal period, unified Axis UI, M0 Axis establishment, same-Axis M build, M1/M2/M3 turn-radius rules, safe opposite input, atomic Cell Conflict, visible map geometry, and Hybrid continuity.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
