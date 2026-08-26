import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9229'
const artifactDir = resolve('artifacts')
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`) }
const which = (command) => { const result = spawnSync('which', [command], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : '' }

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

async function waitFor(label, operation, attempts = 260, delay = 45) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation() } catch (error) { lastError = error; if (index + 1 < attempts) await sleep(delay) }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`)
}

class CdpClient {
  constructor(url) { this.id = 1; this.pending = new Map(); this.socket = new WebSocket(url) }
  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)); const pending = this.pending.get(payload.id); if (!pending) return
      this.pending.delete(payload.id); payload.error ? pending.reject(new Error(payload.error.message)) : pending.resolve(payload.result)
    })
  }
  send(method, params = {}) {
    const id = this.id++
    return new Promise((resolveSend, reject) => { this.pending.set(id, { resolve: resolveSend, reject }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  close() { this.socket.close() }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed')
  return response.result.value
}

const snapshotExpression = `(() => {
  const root=document.querySelector('.cell-world-prototype[data-implementation="cell-world-spatial-ab-v3"]');
  const board=root?.querySelector('.cell-world-board'); const pendulum=root?.querySelector('.thermal-pendulum');
  const canvas=board?.querySelector('canvas'); const rect=canvas?.getBoundingClientRect();
  return {
    implementation:root?.dataset.implementation??'', actionId:root?.dataset.actionId??'', spatialMode:root?.dataset.spatialMode??'',
    playing:root?.dataset.playing==='true', worldAt:Number(root?.dataset.worldAt??-1), logicalX:Number(root?.dataset.logicalX??NaN), logicalZ:Number(root?.dataset.logicalZ??NaN),
    momentum:Number(root?.dataset.momentum??-1), axisId:root?.dataset.axisId??'', atVisualMs:Number(root?.dataset.atVisualMs??0), thermalPeriodAt:Number(root?.dataset.thermalPeriodAt??0),
    axisUi:root?.dataset.axisUi??'', boardAxisStyle:board?.dataset.axisStyle??'', actorAxisPersistent:board?.dataset.actorAxisPersistent??'', boardAxisDirection:board?.dataset.axisDirection??'',
    boardAxisLengthPx:Number(board?.dataset.axisLengthPx??0), boardAxisStrokePx:Number(board?.dataset.axisStrokePx??0), boardAxisAnchor:board?.dataset.axisAnchor??'', boardAxisDownStyle:board?.dataset.axisDownStyle??'',
    previewStyle:board?.dataset.previewStyle??'', previewArrow:board?.dataset.previewArrow??'', reachableHighlight:board?.dataset.reachableHighlight??'',
    viewportWidth:Number(board?.dataset.viewportWidth??0), viewportHeight:Number(board?.dataset.viewportHeight??0), canvasWidth:Number(rect?.width??0), canvasHeight:Number(rect?.height??0),
    playerPlaybackProgress:Number(board?.dataset.playerPlaybackProgress??0), playerPlaybackEnd:Number(board?.dataset.playerPlaybackEnd??1), actorPlaybackWindowCount:Number(board?.dataset.actorPlaybackWindowCount??0),
    thermalCycleAt:Number(pendulum?.dataset.cycleAt??0), actionCardCount:root?.querySelectorAll('.action-card').length??0, holdCardCount:root?.querySelectorAll('[data-action-id="hold"]').length??0,
    actorAxisHudCount:root?.querySelectorAll('.actor-axis-hud').length??0, downAxisControlCount:root?.querySelectorAll('[data-axis-display^="down-"]').length??0,
    resetDisabled:Boolean(root?.querySelector('.session-buttons button:last-child')?.disabled)
  }
})()`
const snapshot = (client) => evaluate(client, snapshotExpression)

async function idleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt}`, async () => { const value = await snapshot(client); if (value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value)); return value })
}
async function resetUi(client) { assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reset()'), 'reset failed'); return idleAt(client, 0) }
async function setAction(client, id) { assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAction(${JSON.stringify(id)})`), `action ${id} rejected`) }
async function setKinematics(client, axisId, level) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axisId)},${level})`), 'setKinematics failed')
  return waitFor(`kinematics ${axisId} M${level}`, async () => { const value = await snapshot(client); const expected = axisId === 'none' ? 'none' : axisId; if (value.axisId !== expected || value.momentum !== level) throw new Error(JSON.stringify(value)); return value })
}
async function setAtMs(client, value) { assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`), 'AT setter failed') }
async function setThermal(client, value) { assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setThermalPeriod(${value})`), 'Thermal setter failed') }
async function setCollisionSurfaces(client, enabled) {
  const desired = enabled ? 'ON' : 'OFF'
  assert(await evaluate(client, `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'));if(!b)return false;if(!b.textContent.includes('${desired}'))b.click();return true})()`), 'Collision control missing')
  return waitFor(`Collision ${desired}`, async () => { const label = await evaluate(client, `([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'))?.textContent??'')`); if (!label.includes(desired)) throw new Error(label); return label })
}
async function setConflictScenario(client, kind) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario(${JSON.stringify(kind)})`), `${kind} scenario rejected`)
  const expected = kind === 'chain' ? { x: 0.5, z: 0.8660254 } : { x: -1, z: 0 }
  return waitFor(`${kind} scenario state`, async () => { const value = await snapshot(client); if (value.playing || value.worldAt !== 0 || value.axisId !== 'E' || value.momentum !== 2 || Math.abs(value.logicalX - expected.x) > 0.02 || Math.abs(value.logicalZ - expected.z) > 0.02) throw new Error(JSON.stringify(value)); return value })
}
async function moveFreeM0(client, q, r, expectedWorldAt) {
  await setKinematics(client, 'none', 0)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},${r})`), `M0 move to ${q},${r} failed`)
  const value = await idleAt(client, expectedWorldAt)
  const expectedX = q + r * 0.5; const expectedZ = r * 0.8660254037844386
  assert(Math.abs(value.logicalX - expectedX) < 0.02 && Math.abs(value.logicalZ - expectedZ) < 0.02, `M0 move did not enter ${q},${r}`, value)
  return value
}
function integerHexFromPosition(position) {
  const r = Math.round(position.z / 0.8660254037844386); const q = Math.round(position.x - r * 0.5)
  const centerX = q + r * 0.5; const centerZ = r * 0.8660254037844386
  return Math.hypot(position.x - centerX, position.z - centerZ) < 0.03 ? { q, r } : null
}

let previewProcess, chromeProcess, client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`)); previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))
  await waitFor('Vite preview', async () => { const response = await fetch(pageUrl); if (!response.ok) throw new Error(`HTTP ${response.status}`); return true })
  chromeProcess = spawn(chromeExecutable(), ['--headless=new','--no-sandbox','--hide-scrollbars','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--enable-unsafe-swiftshader','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9229',`--user-data-dir=${join(tmpdir(), `projectc-wall-surface-${process.pid}`)}`,'--window-size=1600,1100','about:blank'], { stdio: ['ignore','ignore','pipe'] })
  await waitFor('Chrome DevTools', async () => { const response = await fetch(`${debugUrl}/json/version`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() }, 240, 50)
  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' }); assert(targetResponse.ok, 'Failed to create target'); const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Page.bringToFront'); await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }); await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('initialized visible map', async () => { const value = await snapshot(client); if (value.implementation !== 'cell-world-spatial-ab-v3' || value.viewportWidth < 700 || value.viewportHeight < 300 || value.canvasWidth < 700 || value.canvasHeight < 300) throw new Error(JSON.stringify(value)); return value })
  assert(initial.atVisualMs === 500 && initial.thermalPeriodAt === 4 && initial.thermalCycleAt === 4, 'default timebase must be 4 AT / 0.5s', initial)
  assert(initial.axisUi === 'actor-body-screen-arrow-v5' && initial.boardAxisStyle === 'actor-body-screen-arrow-v5' && initial.actorAxisPersistent === 'true', 'Axis UI regressed', initial)
  assert(initial.boardAxisLengthPx === 30 && Math.abs(initial.boardAxisStrokePx - 2.5) < 0.01 && initial.boardAxisAnchor === 'actor-body' && initial.boardAxisDownStyle === 'unified-arrow-v1', 'Axis geometry regressed', initial)
  assert(initial.previewStyle === 'blue-dashed-no-arrow-v3' && initial.previewArrow === 'none' && initial.reachableHighlight === 'lifted-outline-v3', 'path/reachability UI regressed', initial)
  assert(initial.actionCardCount === 7 && initial.holdCardCount === 1 && initial.actorAxisHudCount === 1 && initial.downAxisControlCount === 3 && !initial.resetDisabled, 'control UI regressed', initial)

  await setThermal(client, 6); await setThermal(client, 4); await setAtMs(client, 250); await setCollisionSurfaces(client, false)
  await resetUi(client); await setAction(client, 'basic-move'); await setKinematics(client, 'E', 2); assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(2,0)'), 'M2 forward rejected'); const afterM2 = await idleAt(client, 1); assert(afterM2.momentum === 1 && afterM2.axisId === 'E', 'M2 Range2 must spend to M1', afterM2)
  await resetUi(client); await setAction(client, 'basic-move'); await setKinematics(client, 'E', 3); assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(3,0)'), 'M3 forward rejected'); const afterM3 = await idleAt(client, 1); assert(afterM3.momentum === 2 && afterM3.axisId === 'E', 'M3 Range3 must spend to M2', afterM3)
  await resetUi(client); await setKinematics(client, 'E', 2); assert(await evaluate(client, `(()=>{const b=document.querySelector('[data-action-id="hold"]');if(!b)return false;b.click();return true})()`), 'Hold card click failed'); const afterHold = await idleAt(client, 1); assert(afterHold.momentum === 1 && Math.abs(afterHold.logicalX) < 0.02 && Math.abs(afterHold.logicalZ) < 0.02, 'Hold must stay in Cell and dissipate M2→M1', afterHold)
  await resetUi(client); await setAction(client, 'basic-move'); await setKinematics(client, 'E', 2); assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(-1,0)') === false, 'reverse Move accepted'); const afterReverse = await snapshot(client); assert(!afterReverse.playing && afterReverse.worldAt === 0 && afterReverse.momentum === 2, 'reverse Move corrupted state', afterReverse)

  await setCollisionSurfaces(client, true); await setAtMs(client, 900); await setConflictScenario(client, 'chain'); assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(2,1)'), 'chain knockback rejected')
  const duringChain = await waitFor('staged chain playback', async () => { const value = await snapshot(client); if (!value.playing || value.playerPlaybackProgress < 0.99 || value.actorPlaybackWindowCount < 3) throw new Error(JSON.stringify(value)); return value })
  const chainEvents = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.conflicts()'); const primaryTransfer = chainEvents.find((event) => event.kind === 'momentum-transfer' && event.sourceActorId === 'player'); assert(primaryTransfer?.sourceBeforeM === 2 && primaryTransfer?.sourceAfterM === 1 && primaryTransfer?.targetAfterM === 2, 'M exchange regressed', chainEvents)
  const afterChain = await idleAt(client, 1); const chainState = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.snapshot()'); const chainCells = Object.fromEntries(chainState.actors.map((actor) => [actor.id, `${actor.hex.q},${actor.hex.r}`])); assert(JSON.stringify(chainCells) === JSON.stringify({ 'dummy-a':'4,1','dummy-b':'5,1','dummy-c':'6,1' }) && afterChain.momentum === 1, 'chain final state regressed', { chainCells, afterChain })

  await setConflictScenario(client, 'wall'); assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(1,0)'), 'wall knockback rejected')
  const wallData = await waitFor('rendered wall contact trajectory', async () => { const paths = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.actorTrajectories()'); const path = paths['dummy-a'] ?? []; const hasFractionalContact = path.some((point) => !Number.isInteger(point.q) || !Number.isInteger(point.r)); if (!hasFractionalContact || !path.some((point) => point.q === 2 && point.r === 0)) throw new Error(JSON.stringify(paths)); return paths })
  const wallEvents = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.conflicts()'); const wallCrash = wallEvents.find((event) => event.kind === 'wall-crash' && event.actorId === 'dummy-a')
  assert(wallCrash?.geometryKind === 'obstacle-box-face' && wallCrash?.faceIds?.includes('x-'), 'wall must use rendered box end face', wallEvents)
  assert(wallEvents.some((event) => event.kind === 'surface-stop' && event.actorId === 'dummy-a') && !wallEvents.some((event) => event.kind === 'surface-reflection' && event.actorId === 'dummy-a'), 'blocked head-on rebound must stop without side branch', wallEvents)
  const afterWall = await idleAt(client, 1); const wallState = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.snapshot()'); assert(wallState.actors[0].hex.q === 2 && wallState.actors[0].hex.r === 0 && Math.abs(afterWall.logicalX - 1) < 0.02 && Math.abs(afterWall.logicalZ) < 0.02, 'wall contact produced a player/target swap', { wallState, wallData, afterWall })

  // Latest regression: use Wall Scenario so the normal Chain dummy at q2,r1 cannot block setup.
  // Walk around the sole wall dummy, then hit the thin Hard Wall at q3,r0 with NE/M3.
  await setConflictScenario(client, 'wall'); await setCollisionSurfaces(client, false); await setAction(client, 'basic-move'); await setAtMs(client, 250)
  await moveFreeM0(client, -1, 1, 1); await moveFreeM0(client, 0, 1, 2); await moveFreeM0(client, 1, 1, 3); await moveFreeM0(client, 2, 1, 4)
  await setCollisionSurfaces(client, true); await setKinematics(client, 'NE', 3); await setAction(client, 'basic-move')
  const obliqueReach = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reachability()'); assert(obliqueReach.some((entry) => (entry.targetHex?.q ?? entry.finalHex?.q) === 2 && (entry.targetHex?.r ?? entry.finalHex?.r) === 1), 'oblique wall collision Cell is not clickable', obliqueReach)
  assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(2,1)'), 'oblique wall reflection rejected')
  const obliqueSamples = await waitFor('oblique rendered-wall reflection', async () => {
    const samples = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.trajectory()'); const collisionIndex = samples.findIndex((sample) => sample.collision)
    if (collisionIndex < 0 || samples[collisionIndex].axisId !== 'SE') throw new Error(JSON.stringify(samples))
    const integerAfter = samples.slice(collisionIndex + 1).map((sample) => integerHexFromPosition(sample.position)).filter(Boolean)
    if (!integerAfter.length || integerAfter[0].q !== 2 || integerAfter[0].r !== 2 || integerAfter.some((hex) => hex.q === 3 && hex.r === 1)) throw new Error(JSON.stringify({ integerAfter, samples }))
    return samples
  })
  const afterOblique = await idleAt(client, 5); assert(afterOblique.axisId === 'SE', 'oblique wall reflection did not preserve reflected Axis', afterOblique)

  await resetUi(client); await setAtMs(client, 300); assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setSpatialMode('hybrid')`), 'Hybrid switch failed'); await setAction(client, 'drive'); await setKinematics(client, 'E', 1); assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(0,-2)'), 'Hybrid Drive rejected')
  const hybridSamples = await waitFor('Hybrid samples', async () => { const samples = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.trajectory()'); if (samples.length < 100) throw new Error(`samples=${samples.length}`); return samples }); await idleAt(client, 1)

  await mkdir(artifactDir, { recursive: true }); const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(artifactDir, 'rendered-wall-reflection.png'), Buffer.from(screenshot.data, 'base64'))
  const evidence = { initial, afterM2, afterM3, afterHold, afterReverse, duringChain, primaryTransfer, chainCells, wallData, wallEvents, afterWall, obliqueSamples, afterOblique, hybridSampleCount: hybridSamples.length }; await writeFile(join(artifactDir, 'rendered-wall-reflection.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log('Verified rendered obstacle surface/contact geometry, immediate Hex6 mirror quantization, oblique NE→SE wall reflection without a one-Cell detour, safe head-on knockback stop, Axis/Hold/Momentum rules, strict map geometry, and Hybrid continuity.')
} finally { client?.close(); chromeProcess?.kill('SIGTERM'); previewProcess?.kill('SIGTERM') }
