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
  const canvas = board?.querySelector('canvas')
  const rect = canvas?.getBoundingClientRect()
  return {
    implementation: root?.dataset.implementation ?? '',
    authority: root?.dataset.authority ?? '',
    actionId: root?.dataset.actionId ?? '',
    spatialMode: root?.dataset.spatialMode ?? '',
    playing: root?.dataset.playing === 'true',
    worldAt: Number(root?.dataset.worldAt ?? -1),
    logicalX: Number(root?.dataset.logicalX ?? NaN),
    logicalZ: Number(root?.dataset.logicalZ ?? NaN),
    speed: Number(root?.dataset.speed ?? NaN),
    momentum: Number(root?.dataset.momentum ?? -1),
    atVisualMs: Number(root?.dataset.atVisualMs ?? 0),
    solverSteps: Number(root?.dataset.solverSteps ?? 0),
    axisStyle: board?.dataset.axisStyle ?? '',
    axisState: board?.dataset.axisState ?? '',
    previewStyle: board?.dataset.previewStyle ?? '',
    playbackDurationMs: Number(board?.dataset.playbackDurationMs ?? 0),
    cameraZoom: Number(board?.dataset.cameraZoom ?? NaN),
    viewportWidth: Number(board?.dataset.viewportWidth ?? 0),
    viewportHeight: Number(board?.dataset.viewportHeight ?? 0),
    canvasWidth: Number(rect?.width ?? 0),
    canvasHeight: Number(rect?.height ?? 0),
    thermalVisualAt: Number(pendulum?.dataset.visualAt ?? NaN),
    thermalCycleAt: Number(pendulum?.dataset.cycleAt ?? 0),
    actionCardCount: root?.querySelectorAll('.action-card').length ?? 0,
    basicMoveCard: Boolean(root?.querySelector('[data-action-id="basic-move"]')),
    hasApply: Boolean(root?.querySelector('[data-testid="impulse-commit"], .impulse-commit-row')),
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
  await evaluate(client, `document.querySelector('.session-buttons button:last-child')?.click()`)
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

  const userDataDir = join(tmpdir(), `projectc-basic-move-${process.pid}`)
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

  const initial = await waitFor('fully initialized current prototype', async () => {
    const value = await snapshot(client)
    const ready = value.implementation === 'cell-world-spatial-ab-v3'
      && value.actionCardCount === 6
      && value.axisStyle === 'legacy-hud'
      && value.previewStyle === 'short-dashed-heading-curve'
      && value.axisState === 'm0'
      && Number.isFinite(value.cameraZoom)
    if (!ready) throw new Error(JSON.stringify(value))
    return value
  })
  assert(initial.authority === 'cell-world-plus-spatial-state', 'movement authority missing', initial)
  assert(initial.atVisualMs === 800 && initial.solverSteps === 120, 'AT / solver baseline changed', initial)
  assert(initial.basicMoveCard && !initial.hasApply, 'Basic Move or click-to-resolve UI regressed', initial)
  assert(initial.axisStyle === 'legacy-hud' && initial.previewStyle === 'short-dashed-heading-curve', 'Axis / steering HUD regressed', initial)
  assert(initial.thermalCycleAt === 8, 'thermal timebase regressed', initial)

  // Basic Move accepts only an adjacent Aim Cell.
  await resetUi(client)
  await selectAction(client, 'basic-move')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2, 0)`) === false, 'remote Basic Move Aim was accepted')
  const afterRemote = await snapshot(client)
  assert(afterRemote.worldAt === 0 && !afterRemote.playing, 'remote Basic Move changed state', afterRemote)

  // M0 Basic Move remains one Cell / one AT.
  await setAtMs(client, 600)
  const m0Start = Date.now()
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1, 0)`) === true, 'adjacent M0 Basic Move was rejected')
  const m0Playback = await waitFor('M0 Basic playback', async () => {
    const value = await snapshot(client)
    if (!value.playing || value.playbackDurationMs !== 600) throw new Error(JSON.stringify(value))
    return value
  })
  const stableViewport = { cameraZoom: m0Playback.cameraZoom, viewportWidth: m0Playback.viewportWidth, viewportHeight: m0Playback.viewportHeight, canvasWidth: m0Playback.canvasWidth, canvasHeight: m0Playback.canvasHeight }
  await sleep(180)
  const m0Mid = await snapshot(client)
  assert(m0Mid.playing && m0Mid.worldAt === 0, 'Basic Move committed logical state early', m0Mid)
  assert(m0Mid.thermalVisualAt > 0.05 && m0Mid.thermalVisualAt < 0.8, 'thermal pendulum did not advance inside the AT', m0Mid)
  assert(Math.abs(m0Mid.cameraZoom - stableViewport.cameraZoom) < 0.0001, 'camera zoom changed during playback', { stableViewport, m0Mid })
  assert(m0Mid.viewportWidth === stableViewport.viewportWidth && m0Mid.viewportHeight === stableViewport.viewportHeight, 'viewport resized during playback', { stableViewport, m0Mid })
  const afterM0 = await waitForIdleAt(client, 1)
  assert(Date.now() - m0Start >= 520, 'configured 600ms AT was committed too early', afterM0)
  assert(afterM0.logicalX > 0.94 && afterM0.logicalX < 1.06 && Math.abs(afterM0.logicalZ) < 0.05 && afterM0.momentum === 0, 'M0 Basic Move is not Move1 / M0', afterM0)

  // M2 uses Range+1 and resolves M once for the whole AT, not once per Cell.
  await resetUi(client)
  await setVelocity(client, 1.7, 0)
  await selectAction(client, 'basic-move')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1, 0)`) === true, 'adjacent M2 Basic Move was rejected')
  const m2Trajectory = await waitFor('M2 Basic trajectory', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (!samples || samples.length !== 3) throw new Error(`samples=${samples?.length ?? 0}`)
    return samples
  })
  const afterM2 = await waitForIdleAt(client, 1)
  assert(afterM2.logicalX > 1.94 && afterM2.logicalX < 2.06 && Math.abs(afterM2.logicalZ) < 0.05, 'M2 Basic Move did not resolve Range 2', { afterM2, m2Trajectory })
  assert(afterM2.momentum === 1 && afterM2.speed > 0.8 && afterM2.speed < 0.9, 'M2 Basic Move did not resolve once to M1', afterM2)

  // M2 steering is path-constrained: E Axis + NW adjacent intent produces E then NE, not a direct NW endpoint.
  await resetUi(client)
  await setVelocity(client, 1.7, 0)
  await selectAction(client, 'basic-move')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0, -1)`) === true, 'M2 steering Aim was rejected')
  const turnTrajectory = await waitFor('M2 steering trajectory', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (!samples || samples.length !== 3) throw new Error(`samples=${samples?.length ?? 0}`)
    return samples
  })
  assert(Math.abs(turnTrajectory[1].position.x - 1) < 0.01 && Math.abs(turnTrajectory[1].position.z) < 0.01, 'first M2 Cell-step ignored incoming Axis', turnTrajectory)
  const afterTurn = await waitForIdleAt(client, 1)
  assert(afterTurn.logicalX > 1.45 && afterTurn.logicalX < 1.55 && afterTurn.logicalZ < -0.82 && afterTurn.logicalZ > -0.91, 'M2 turn did not follow E -> NE Cell path', { afterTurn, turnTrajectory })
  assert(afterTurn.momentum === 1, 'M2 turn over-consumed Momentum', afterTurn)

  // Impulse Hybrid A/B remains unchanged.
  await resetUi(client)
  await setVelocity(client, 0.85, 0)
  assert(await evaluate(client, `(() => { const button=document.querySelector('[data-spatial-select="hybrid"]'); button?.click(); return Boolean(button) })()`) === true, 'Hybrid switch failed')
  await selectAction(client, 'drive')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0, -2)`) === true, 'Hybrid Drive rejected 120-degree Aim')
  const hybridTrajectory = await waitFor('Hybrid trajectory', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (!samples || samples.length < 100) throw new Error(`samples=${samples?.length ?? 0}`)
    return samples
  })
  const midpoint = hybridTrajectory[Math.floor(hybridTrajectory.length / 2)].position
  const endpoint = hybridTrajectory.at(-1).position
  const cross = midpoint.x * endpoint.z - midpoint.z * endpoint.x
  assert(Math.abs(cross) > 0.015, 'Hybrid Drive trajectory lost curved blend', { midpoint, endpoint, cross })
  await waitForIdleAt(client, 1)
  const hybridState = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
  assert(hybridState.velocity.x > 0.3 && hybridState.velocity.x < 0.6 && hybridState.velocity.z < -0.6, 'Hybrid final Velocity no longer equals V + ΔV', hybridState)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'axis-thermal-preview-polish.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = { initial, afterRemote, m0Playback, m0Mid, afterM0, m2Trajectory, afterM2, turnTrajectory, afterTurn, hybridState, hybridCurve: { midpoint, endpoint, cross, sampleCount: hybridTrajectory.length } }
  await writeFile(join(artifactDir, 'axis-thermal-preview-polish.json'), `${JSON.stringify(evidence, null, 2)}\n`)

  console.log('Verified adjacent-only Basic Move, M2 Range+1 -> M1 Cell-path steering, stable AT/thermal playback, and unchanged Hybrid V + ΔV impulses.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
