import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9229'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`) }
const which = (command) => { const result = spawnSync('which', [command], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : '' }

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

async function waitFor(label, operation, attempts = 240, delay = 45) {
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
  const root=document.querySelector('.cell-world-prototype[data-implementation="spatial-inertia-v1-candidate"]');
  const board=root?.querySelector('.cell-world-board');
  const pendulum=root?.querySelector('.thermal-pendulum');
  const canvas=board?.querySelector('canvas');
  const rect=canvas?.getBoundingClientRect();
  return {
    implementation:root?.dataset.implementation??'',
    authority:root?.dataset.authority??'',
    aimContract:root?.dataset.basicAimContract??'',
    basicRules:root?.dataset.basicMoveRules??'',
    driveRule:root?.dataset.driveRule??'',
    contactRule:root?.dataset.contactRule??'',
    forcedMoveRule:root?.dataset.forcedMoveRule??'',
    incomingComposition:root?.dataset.incomingComposition??'',
    actionId:root?.dataset.actionId??'',
    spatialMode:root?.dataset.spatialMode??'',
    playing:root?.dataset.playing==='true',
    worldAt:Number(root?.dataset.worldAt??-1),
    logicalX:Number(root?.dataset.logicalX??NaN),
    logicalZ:Number(root?.dataset.logicalZ??NaN),
    momentum:Number(root?.dataset.momentum??-1),
    axisId:root?.dataset.axisId??'',
    axisDisplayOverride:root?.dataset.axisDisplayOverride??'',
    atVisualMs:Number(root?.dataset.atVisualMs??0),
    thermalPeriodAt:Number(root?.dataset.thermalPeriodAt??0),
    thermalCycleAt:Number(pendulum?.dataset.cycleAt??0),
    boardAxisStyle:board?.dataset.axisStyle??'',
    boardAxisDirection:board?.dataset.axisDirection??'',
    boardAxisLengthPx:Number(board?.dataset.axisLengthPx??0),
    boardAxisStrokePx:Number(board?.dataset.axisStrokePx??0),
    boardAxisSupportsDown:board?.dataset.axisSupportsDown??'',
    boardAxisAnchor:board?.dataset.axisAnchor??'',
    previewStyle:board?.dataset.previewStyle??'',
    reachableHighlight:board?.dataset.reachableHighlight??'',
    knockbackPreview:board?.dataset.knockbackPreview??'',
    knockbackPlayback:board?.dataset.knockbackPlayback??'',
    viewportWidth:Number(board?.dataset.viewportWidth??0),
    viewportHeight:Number(board?.dataset.viewportHeight??0),
    canvasWidth:Number(rect?.width??0),
    canvasHeight:Number(rect?.height??0),
    actionCardCount:root?.querySelectorAll('.action-card').length??0,
    holdCardCount:root?.querySelectorAll('[data-action-id="hold"]').length??0,
    incomingControlCount:root?.querySelectorAll('[data-incoming-composition-select]').length??0,
    actorAxisHudCount:root?.querySelectorAll('.actor-axis-hud').length??0,
    downAxisControlCount:root?.querySelectorAll('[data-axis-display^="down-"]').length??0,
    resetDisabled:Boolean(root?.querySelector('.session-buttons button:last-child')?.disabled)
  }
})()`

const snapshot = (client) => evaluate(client, snapshotExpression)
async function idleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt}`, async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    return value
  }, 280, 40)
}
async function resetUi(client) {
  assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reset()'), 'reset failed')
  return idleAt(client, 0)
}
async function setAction(client, id) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAction(${JSON.stringify(id)})`), `action ${id} rejected`)
  return waitFor(`action ${id}`, async () => {
    const value = await snapshot(client)
    if (value.actionId !== id) throw new Error(JSON.stringify(value))
    return value
  })
}
async function setSpatial(client, mode) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setSpatialMode(${JSON.stringify(mode)})`), `Spatial ${mode} rejected`)
  return waitFor(`Spatial ${mode}`, async () => {
    const value = await snapshot(client)
    if (value.spatialMode !== mode) throw new Error(JSON.stringify(value))
    return value
  })
}
async function setComposition(client, mode) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setIncomingCompositionMode(${JSON.stringify(mode)})`), `Incoming composition ${mode} rejected`)
  return waitFor(`Incoming composition ${mode}`, async () => {
    const value = await snapshot(client)
    if (value.incomingComposition !== mode) throw new Error(JSON.stringify(value))
    return value
  })
}
async function setKinematics(client, axisId, level) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axisId)},${level})`), 'setKinematics failed')
  return waitFor(`kinematics ${axisId} M${level}`, async () => {
    const value = await snapshot(client)
    const expectedAxis = axisId === 'none' ? 'none' : axisId
    if (value.axisId !== expectedAxis || value.momentum !== level) throw new Error(JSON.stringify(value))
    return value
  })
}
async function setAxisDisplay(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAxisDisplay(${JSON.stringify(value)})`), `Axis display ${value} rejected`)
  return waitFor(`Axis display ${value}`, async () => {
    const snapshotValue = await snapshot(client)
    if (snapshotValue.axisDisplayOverride !== value) throw new Error(JSON.stringify(snapshotValue))
    return snapshotValue
  })
}
async function setAtMs(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`), 'AT setter failed')
  return waitFor(`AT ${value}`, async () => {
    const snapshotValue = await snapshot(client)
    if (snapshotValue.atVisualMs !== value) throw new Error(JSON.stringify(snapshotValue))
    return snapshotValue
  })
}
async function setThermal(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setThermalPeriod(${value})`), 'Thermal setter failed')
  return waitFor(`Thermal ${value}`, async () => {
    const snapshotValue = await snapshot(client)
    if (snapshotValue.thermalPeriodAt !== value || snapshotValue.thermalCycleAt !== value) throw new Error(JSON.stringify(snapshotValue))
    return snapshotValue
  })
}
async function setCollisionSurfaces(client, enabled) {
  const desired = enabled ? 'ON' : 'OFF'
  assert(await evaluate(client, `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'));if(!b)return false;if(!b.textContent.includes('${desired}'))b.click();return true})()`), 'Collision control missing')
  return waitFor(`Collision ${desired}`, async () => {
    const label = await evaluate(client, `([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'))?.textContent??'')`)
    if (!label.includes(desired)) throw new Error(label)
    return label
  })
}
const reachKey = (entry) => { const hex = entry.finalHex ?? entry.targetHex; return `${hex.q},${hex.r}` }
async function waitReach(client, expectedKeys) {
  const expected = [...expectedKeys].sort().join('|')
  return waitFor(`reach ${expected}`, async () => {
    const reach = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reachability()')
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
    const samples = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.trajectory()')
    const raw = samples.map(sampleHex)
    const compact = raw.filter((value, index) => index === 0 || value !== raw[index - 1])
    if (compact.join('|') !== expectedHexes.join('|')) throw new Error(`actual=${compact.join('→')}`)
    return samples
  })
}
async function fire(client, q, r, worldAt) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},${r})`), `fireAt ${q},${r} rejected`)
  return idleAt(client, worldAt)
}
async function setConflictScenario(client, kind) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario(${JSON.stringify(kind)})`), `${kind} scenario rejected`)
  return idleAt(client, 0)
}

let previewProcess, chromeProcess, client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))
  await waitFor('Vite preview', async () => { const response = await fetch(pageUrl); if (!response.ok) throw new Error(`HTTP ${response.status}`); return true })

  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229',
    `--user-data-dir=${join(tmpdir(), `projectc-spatial-v1-${process.pid}`)}`,
    '--window-size=1600,1100', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  await waitFor('Chrome DevTools', async () => { const response = await fetch(`${debugUrl}/json/version`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() }, 240, 50)
  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Page.bringToFront')
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('initialized Spatial Inertia v1 map', async () => {
    const value = await snapshot(client)
    if (value.implementation !== 'spatial-inertia-v1-candidate' || value.actionCardCount !== 7 || value.holdCardCount !== 1 || value.incomingControlCount !== 2 || value.viewportWidth < 500 || value.viewportHeight < 280 || value.canvasWidth < 500 || value.canvasHeight < 280) throw new Error(JSON.stringify(value))
    return value
  })
  assert(initial.authority === 'spatial-inertia-v1-cell-axis-momentum', 'v1 authority marker missing', initial)
  assert(initial.aimContract === 'reachable-landing-cell-v1' && initial.basicRules === 'initiative-first-travel-transaction-v1', 'v1 Basic contract missing', initial)
  assert(initial.driveRule === 'drive-build-inertia-prototype-candidate-v1' && initial.contactRule === 'contact-strike-direct-transfer-v1' && initial.forcedMoveRule === 'forced-use-on-first-travel-v1', 'v1 action/contact markers missing', initial)
  assert(initial.incomingComposition === 'true-vector', 'True Vector should be the default A/B mode', initial)
  assert(initial.atVisualMs === 500 && initial.thermalPeriodAt === 4 && initial.thermalCycleAt === 4, 'default timebase regressed', initial)
  assert(initial.boardAxisStyle === 'actor-body-screen-arrow-v5' && initial.boardAxisLengthPx === 30 && Math.abs(initial.boardAxisStrokePx - 2.5) < 0.01 && initial.boardAxisSupportsDown === 'true' && initial.boardAxisAnchor === 'actor-body', 'Axis HUD regressed', initial)
  assert(initial.actorAxisHudCount === 1 && initial.downAxisControlCount === 3 && !initial.resetDisabled, 'UI safety controls regressed', initial)
  assert(initial.previewStyle === 'blue-dashed-no-arrow-v3' && initial.reachableHighlight === 'lifted-outline-v3' && initial.knockbackPreview === 'yellow-dashed-path-v2' && initial.knockbackPlayback === 'contact-staggered-fast-v3', 'path/playback presentation regressed', initial)

  await setComposition(client, 'hex-lookup')
  await setComposition(client, 'true-vector')
  await setAxisDisplay(client, 'down-2')
  await setAxisDisplay(client, 'auto')
  await setThermal(client, 6)
  await setThermal(client, 4)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)

  await resetUi(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'none', 0)
  await waitReach(client, ['-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,0'])
  let value = await fire(client, 1, 0, 1)
  assert(value.axisId === 'E' && value.momentum === 0 && Math.abs(value.logicalX - 1) < 0.02, 'M0 NoAxis startup wrong', value)

  await setKinematics(client, 'E', 0)
  value = await fire(client, 2, 0, 2)
  assert(value.momentum === 1 && value.axisId === 'E', 'M0 Axis Generate M1 wrong', value)
  await setKinematics(client, 'E', 1)
  value = await fire(client, 3, 0, 3)
  assert(value.momentum === 2 && value.axisId === 'E', 'M1 Generate M2 wrong', value)

  await resetUi(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  await waitReach(client, ['0,1', '1,-1', '1,1', '2,-1', '2,0'])
  await waitTrajectory(client, ['0,0', '1,0', '2,0'])
  value = await fire(client, 2, 0, 1)
  assert(value.momentum === 1 && value.axisId === 'E' && Math.abs(value.logicalX - 2) < 0.02, 'M2 Travel2 / Use wrong', value)

  await resetUi(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 3)
  await waitReach(client, ['1,2', '2,1', '3,-1', '3,-2', '3,0'])
  await waitTrajectory(client, ['0,0', '1,0', '2,0', '3,0'])
  value = await fire(client, 3, 0, 1)
  assert(value.momentum === 2 && value.axisId === 'E' && Math.abs(value.logicalX - 3) < 0.02, 'M3 Travel3 / Use wrong', value)

  await resetUi(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setSpatial(client, 'hybrid')
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  await waitTrajectory(client, ['0,0', '1,0', '2,0'])
  value = await fire(client, 2, 0, 1)
  assert(value.spatialMode === 'hybrid' && value.momentum === 1 && Math.abs(value.logicalX - 2) < 0.02, 'Hybrid Basic diverged from v1 logic', value)

  await resetUi(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'drive')
  await setKinematics(client, 'E', 2)
  await waitTrajectory(client, ['0,0', '1,0', '2,0'])
  value = await fire(client, 2, 0, 1)
  assert(value.momentum === 3 && value.axisId === 'E' && Math.abs(value.logicalX - 2) < 0.02, 'Drive Build candidate wrong', value)

  await resetUi(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setConflictScenario(client, 'chain')
  await setKinematics(client, 'E', 3)
  assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.fireAt(3,1)'), 'chain action rejected')
  value = await idleAt(client, 1)
  const conflicts = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.conflicts()')
  const playerStrike = conflicts.find((entry) => entry.kind === 'cell-conflict' && entry.sourceActorId === 'player')
  const playerTransfer = conflicts.find((entry) => entry.kind === 'momentum-transfer' && entry.sourceActorId === 'player')
  const forcedUse = conflicts.find((entry) => entry.kind === 'momentum-event' && entry.actorId === 'dummy-a' && entry.cause === 'Forced Use')
  const actorPaths = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.actorTrajectories()')
  assert(playerStrike?.impactM === 2 && playerStrike?.contactBehavior === 'Strike', 'later Strike must use post-first-Travel M2', { playerStrike, conflicts })
  assert(playerTransfer?.sourceBeforeM === 2 && playerTransfer?.sourceAfterM === 0 && playerTransfer?.targetAfterM === 2 && playerTransfer?.model === 'contact-strike-direct-transfer-v1', 'Strike direct transfer wrong', playerTransfer)
  assert(forcedUse?.fromM === 2 && forcedUse?.toM === 1, 'Forced Use must execute once before target travel', forcedUse)
  assert(JSON.stringify(actorPaths['dummy-a']) === JSON.stringify([{ q: 2, r: 1 }, { q: 3, r: 1 }]), 'Forced target trajectory wrong', actorPaths)
  assert(value.momentum === 0 && Math.abs(value.logicalX - 3) < 0.02 && Math.abs(value.logicalZ - 0.866) < 0.03, 'Strike source final state wrong', value)

  console.log('Verified Spatial Inertia v1 in real Chrome: landing envelopes, first-Travel transactions, shared Discrete/Hybrid logic, Drive Build candidate, Incoming A/B UI, Strike direct Transfer, Forced Use, Axis/Thermal and playback surfaces.')
} finally {
  try { client?.close() } catch {}
  try { chromeProcess?.kill('SIGTERM') } catch {}
  try { previewProcess?.kill('SIGTERM') } catch {}
}
