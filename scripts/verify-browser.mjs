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
    implementation: root?.dataset.implementation ?? '', authority: root?.dataset.authority ?? '',
    aimContract: root?.dataset.basicAimContract ?? '', basicRules: root?.dataset.basicMoveRules ?? '',
    driveRule: root?.dataset.driveRule ?? '', axisUi: root?.dataset.axisUi ?? '',
    actionId: root?.dataset.actionId ?? '', spatialMode: root?.dataset.spatialMode ?? '',
    playing: root?.dataset.playing === 'true', worldAt: Number(root?.dataset.worldAt ?? -1),
    logicalX: Number(root?.dataset.logicalX ?? NaN), logicalZ: Number(root?.dataset.logicalZ ?? NaN),
    momentum: Number(root?.dataset.momentum ?? -1), axisId: root?.dataset.axisId ?? '',
    reachableCount: Number(root?.dataset.reachableCount ?? -1), pushAtomic: root?.dataset.pushAtomic ?? '',
    atVisualMs: Number(root?.dataset.atVisualMs ?? 0), thermalPeriodAt: Number(root?.dataset.thermalPeriodAt ?? 0),
    boardAxisStyle: board?.dataset.axisStyle ?? '', actorAxisPersistent: board?.dataset.actorAxisPersistent ?? '',
    boardAxisDirection: board?.dataset.axisDirection ?? '', previewStyle: board?.dataset.previewStyle ?? '',
    previewArrow: board?.dataset.previewArrow ?? '', previewAuthority: board?.dataset.previewAuthority ?? '',
    reachableHighlight: board?.dataset.reachableHighlight ?? '', knockbackPreview: board?.dataset.knockbackPreview ?? '',
    knockbackPlayback: board?.dataset.knockbackPlayback ?? '', middlePan: board?.dataset.middlePan ?? '',
    viewportWidth: Number(board?.dataset.viewportWidth ?? 0), viewportHeight: Number(board?.dataset.viewportHeight ?? 0),
    canvasWidth: Number(rect?.width ?? 0), canvasHeight: Number(rect?.height ?? 0),
    thermalCycleAt: Number(pendulum?.dataset.cycleAt ?? 0),
    thermalPlaybackInterpolation: pendulum?.dataset.playbackInterpolation ?? '',
    actionCardCount: root?.querySelectorAll('.action-card').length ?? 0,
    resetDisabled: Boolean(root?.querySelector('.session-buttons button:last-child')?.disabled),
    separateAxisWindow: root?.querySelectorAll('.unified-axis-hud,.axis-indicator-card').length ?? 0,
  }
})()`
async function snapshot(client) { return evaluate(client, snapshotExpression) }
async function waitForIdleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt} AT`, async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    return value
  }, 220, 40)
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
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAction(${JSON.stringify(id)})`) === true, `action ${id} rejected`)
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
    if (axisId !== 'none' && value.boardAxisDirection !== axisId) throw new Error(`actor Axis arrow=${value.boardAxisDirection}`)
    return value
  })
}
async function setAtMs(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`) === true, 'AT setter failed')
  return waitFor(`AT ${value}`, async () => {
    const current = await snapshot(client)
    if (current.atVisualMs !== value) throw new Error(JSON.stringify(current))
    return current
  })
}
async function setThermalPeriod(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setThermalPeriod(${value})`) === true, 'Thermal period setter failed')
  return waitFor(`Thermal ${value}`, async () => {
    const current = await snapshot(client)
    if (current.thermalPeriodAt !== value || current.thermalCycleAt !== value) throw new Error(JSON.stringify(current))
    return current
  })
}
async function setCollisionSurfaces(client, enabled) {
  const desired = enabled ? 'ON' : 'OFF'
  await evaluate(client, `(() => {
    const button=[...document.querySelectorAll('button')].find((entry)=>entry.textContent.trim().startsWith('Collision Surfaces'))
    if (!button) return false
    if (!button.textContent.includes(${JSON.stringify(desired)})) button.click()
    return true
  })()`)
  return waitFor(`Collision Surfaces ${desired}`, async () => {
    const label = await evaluate(client, `([...document.querySelectorAll('button')].find((entry)=>entry.textContent.trim().startsWith('Collision Surfaces'))?.textContent ?? '')`)
    if (!label.includes(desired)) throw new Error(label)
    return label
  })
}
function reachKey(entry) {
  const hex = entry.finalHex ?? entry.targetHex
  return `${hex.q},${hex.r}`
}
async function waitReach(client, expectedKeys) {
  const expected = [...expectedKeys].sort().join('|')
  return waitFor(`reachability ${expected}`, async () => {
    const reach = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reachability()`)
    const actual = reach.map(reachKey).sort().join('|')
    if (actual !== expected) throw new Error(`actual=${actual}`)
    return reach
  })
}
function sampleHex(sample) {
  const r = Math.round(sample.position.z / 0.8660254037844386)
  const q = Math.round(sample.position.x - r * 0.5)
  return `${q},${r}`
}
async function waitTrajectory(client, expectedHexes) {
  return waitFor(`trajectory ${expectedHexes.join('→')}`, async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    const actual = samples.map(sampleHex)
    const compressed = actual.filter((entry, index) => index === 0 || entry !== actual[index - 1])
    if (compressed.join('|') !== expectedHexes.join('|')) throw new Error(`actual=${compressed.join('→')}`)
    return samples
  })
}
async function setConflictScenario(client, kind) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario(${JSON.stringify(kind)})`) === true, `${kind} scenario rejected`)
  const expected = kind === 'chain' ? { x: 0.5, z: 0.8660254 } : { x: 0, z: 0 }
  return waitFor(`${kind} scenario`, async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== 0 || value.axisId !== 'E' || value.momentum !== 2) throw new Error(JSON.stringify(value))
    if (Math.abs(value.logicalX - expected.x) > 0.02 || Math.abs(value.logicalZ - expected.z) > 0.02) throw new Error(JSON.stringify(value))
    return value
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

  const userDataDir = join(tmpdir(), `projectc-reachable-curves-${process.pid}`)
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

  const initial = await waitFor('initialized visible map', async () => {
    const value = await snapshot(client)
    if (value.implementation !== 'cell-world-spatial-ab-v3' || value.actionCardCount !== 6) throw new Error(JSON.stringify(value))
    if (value.viewportWidth < 700 || value.viewportHeight < 300 || value.canvasWidth < 700 || value.canvasHeight < 300) throw new Error(JSON.stringify(value))
    return value
  })
  assert(initial.authority === 'cell-world-plus-spatial-state', 'authority marker missing', initial)
  assert(initial.aimContract === 'reachable-cell-target-v3', 'destination input contract missing', initial)
  assert(initial.basicRules === 'connected-envelope-v3', 'connected envelope missing', initial)
  assert(initial.driveRule === 'cell-target-curved-composition', 'curved discrete Drive rule missing', initial)
  assert(initial.axisUi === 'actor-world-arrow-v3', 'actor Axis UI marker missing', initial)
  assert(initial.boardAxisStyle === 'actor-world-arrow-v3' && initial.actorAxisPersistent === 'true', 'actor-local Axis arrow missing', initial)
  assert(initial.separateAxisWindow === 0, 'separate Axis window returned', initial)
  assert(initial.previewStyle === 'blue-dashed-no-arrow-v3' && initial.previewArrow === 'none', 'player path style wrong', initial)
  assert(initial.previewAuthority === 'cell-target-path-v3', 'landing path authority missing', initial)
  assert(initial.reachableHighlight === 'lifted-outline-v3', 'reachable highlight missing', initial)
  assert(initial.knockbackPreview === 'yellow-dashed-path-v2', 'knockback preview style missing', initial)
  assert(initial.knockbackPlayback === 'animated-actor-path-v2', 'knockback playback style missing', initial)
  assert(initial.middlePan === 'enabled' && initial.pushAtomic === 'true', 'board controls / atomic push regressed', initial)
  assert(!initial.resetDisabled, 'Reset must remain available', initial)

  const thermal4 = await setThermalPeriod(client, 4)
  const thermal6 = await setThermalPeriod(client, 6)
  const thermal8 = await setThermalPeriod(client, 8)
  await setAtMs(client, 300)
  // Pure movement-envelope checks are isolated from authored terrain collision surfaces.
  await setCollisionSurfaces(client, false)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'none', 0)
  const reachM0 = await waitReach(client, ['-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,0'])
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1,0)`) === true, 'M0 E landing rejected')
  const afterEstablish = await waitForIdleAt(client, 1)
  assert(afterEstablish.axisId === 'E' && afterEstablish.momentum === 0 && afterEstablish.boardAxisDirection === 'E', 'M0 Axis state/arrow wrong', afterEstablish)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2,0)`) === true, 'same Axis M0 landing rejected')
  const afterM0Build = await waitForIdleAt(client, 2)
  assert(afterM0Build.axisId === 'E' && afterM0Build.momentum === 1, 'same Axis M0 did not build M1', afterM0Build)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'E', 1)
  const reachM1 = await waitReach(client, ['-1,1', '0,-1', '0,1', '1,-1', '1,0'])
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0,-1)`) === true, 'M1 NW landing rejected')
  const m1NwTrajectory = await waitTrajectory(client, ['0,0', '1,-1', '0,-1'])
  const afterM1Nw = await waitForIdleAt(client, 1)
  assert(Math.abs(afterM1Nw.logicalX + 0.5) < 0.02 && Math.abs(afterM1Nw.logicalZ + 0.8660254) < 0.02, 'M1 NW landing wrong', afterM1Nw)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  const expectedM2 = ['0,1', '1,-1', '1,1', '2,-1', '2,0']
  const reachM2 = await waitReach(client, expectedM2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1,-1)`) === true, 'M2 inner NE landing rejected')
  const m2InnerTrajectory = await waitTrajectory(client, ['0,0', '1,0', '1,-1'])
  const afterM2Inner = await waitForIdleAt(client, 1)
  assert(Math.abs(afterM2Inner.logicalX - 0.5) < 0.02 && Math.abs(afterM2Inner.logicalZ + 0.8660254) < 0.02, 'M2 inner NE landing wrong', afterM2Inner)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'E', 3)
  const expectedM3 = ['0,2', '1,2', '2,-2', '2,1', '3,-1', '3,-2', '3,0']
  const reachM3 = await waitReach(client, expectedM3)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(3,-1)`) === true, 'M3 connector landing rejected')
  const m3ConnectorTrajectory = await waitTrajectory(client, ['0,0', '1,0', '2,0', '3,-1'])
  const afterM3Connector = await waitForIdleAt(client, 1)
  assert(Math.abs(afterM3Connector.logicalX - 2.5) < 0.02 && Math.abs(afterM3Connector.logicalZ + 0.8660254) < 0.02, 'M3 connector landing wrong', afterM3Connector)

  await resetUi(client)
  await selectAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(-1,0)`) === false, 'reverse M2 Move accepted')
  const afterReverseMove = await snapshot(client)
  assert(!afterReverseMove.playing && afterReverseMove.worldAt === 0 && afterReverseMove.momentum === 2, 'reverse Move corrupted state', afterReverseMove)

  await selectAction(client, 'drive')
  const driveReachM2 = await waitReach(client, expectedM2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(-1,0)`) === false, 'reverse M2 Drive accepted')
  const afterReverseDrive = await snapshot(client)
  assert(!afterReverseDrive.playing && afterReverseDrive.worldAt === 0 && afterReverseDrive.axisId === 'E' && afterReverseDrive.momentum === 2, 'reverse Drive corrupted state', afterReverseDrive)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reset()`) === true, 'Reset failed after reverse Drive')
  await waitForIdleAt(client, 0)

  await selectAction(client, 'drive')
  await setKinematics(client, 'E', 2)
  await waitReach(client, expectedM2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1,-1)`) === true, 'Discrete Drive inner NE rejected')
  const driveTrajectory = await waitTrajectory(client, ['0,0', '1,0', '1,-1'])
  const afterDrive = await waitForIdleAt(client, 1)
  assert(Math.abs(afterDrive.logicalX - 0.5) < 0.02 && Math.abs(afterDrive.logicalZ + 0.8660254) < 0.02, 'Discrete Drive ignored clicked Cell', afterDrive)

  // Re-enable environment collisions for Cell Conflict / wall legality tests.
  await setCollisionSurfaces(client, true)
  await setConflictScenario(client, 'chain')
  await waitReach(client, ['0,2', '1,0', '1,2', '2,0', '2,1'])
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2,1)`) === true, 'chain knockback landing rejected')
  const chainTrajectories = await waitFor('chain actor trajectories', async () => {
    const paths = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.actorTrajectories()`)
    if ((paths['dummy-a']?.length ?? 0) < 3 || (paths['dummy-b']?.length ?? 0) < 2 || (paths['dummy-c']?.length ?? 0) < 2) throw new Error(JSON.stringify(paths))
    return paths
  })
  const duringChain = await snapshot(client)
  assert(duringChain.playing && duringChain.knockbackPlayback === 'animated-actor-path-v2', 'knockback playback did not animate', duringChain)
  await waitForIdleAt(client, 1)
  const chainState = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
  const chainCells = Object.fromEntries(chainState.actors.map((actor) => [actor.id, `${actor.hex.q},${actor.hex.r}`]))
  assert(JSON.stringify(chainCells) === JSON.stringify({ 'dummy-a': '4,1', 'dummy-b': '5,1', 'dummy-c': '6,1' }), 'chain final Cells wrong', chainCells)

  await setConflictScenario(client, 'wall')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2,0)`) === true, 'wall conflict landing rejected')
  const wallTrajectories = await waitFor('wall actor trajectory', async () => {
    const paths = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.actorTrajectories()`)
    if (!paths['dummy-a']) throw new Error(JSON.stringify(paths))
    return paths
  })
  const afterWall = await waitForIdleAt(client, 1)
  const wallState = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
  assert(wallState.actors[0].hex.q === 2 && wallState.actors[0].hex.r === 0, 'wall-blocked actor moved', wallState)
  assert(wallTrajectories['dummy-a'].length === 1, 'wall-blocked actor got fake flight path', wallTrajectories)
  assert(Math.abs(afterWall.logicalX - 1) < 0.02 && Math.abs(afterWall.logicalZ) < 0.02, 'player entered blocked actor Cell', afterWall)

  await resetUi(client)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setSpatialMode('hybrid')`) === true, 'Hybrid switch failed')
  await selectAction(client, 'drive')
  await setKinematics(client, 'E', 1)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(0,-2)`) === true, 'Hybrid Drive rejected free Aim')
  const hybridSamples = await waitFor('Hybrid Drive samples', async () => {
    const samples = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
    if (samples.length < 100) throw new Error(`samples=${samples.length}`)
    return samples
  })
  await waitForIdleAt(client, 1)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'reachable-curves-knockback.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = {
    initial, thermal4, thermal6, thermal8,
    reachM0, afterEstablish, afterM0Build,
    reachM1, m1NwTrajectory,
    reachM2, m2InnerTrajectory,
    reachM3, m3ConnectorTrajectory,
    afterReverseMove, afterReverseDrive,
    driveReachM2, driveTrajectory,
    chainTrajectories, chainCells,
    wallTrajectories, hybridSampleCount: hybridSamples.length,
  }
  await writeFile(join(artifactDir, 'reachable-curves-knockback.json'), `${JSON.stringify(evidence, null, 2)}\n`)

  console.log('Verified connected M1/M2/M3 landing geometry, obstacle-aware legality, destination clicks, safe reverse Move/Drive, curved Discrete Drive, actor Axis arrow, readable highlights, animated atomic knockback, Thermal periods, map geometry, and Hybrid continuity.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
