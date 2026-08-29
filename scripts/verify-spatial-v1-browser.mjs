import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9229'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`)
}
const which = (command) => {
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

async function waitFor(label, operation, attempts = 260, delay = 40) {
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
  const response = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed')
  return response.result.value
}

const snapshotExpression = `(() => {
  const root=document.querySelector('.cell-world-prototype[data-implementation="spatial-inertia-v1-candidate"]');
  const board=root?.querySelector('.cell-world-board');
  const pendulum=root?.querySelector('.thermal-pendulum');
  const canvas=board?.querySelector('canvas');
  const rect=canvas?.getBoundingClientRect();
  const state=window.__PROJECTC_PROTOTYPE__?.snapshot?.();
  const r=Math.round((state?.position?.z??0)/0.8660254037844386);
  const q=Math.round((state?.position?.x??0)-r*0.5);
  return {
    ready:Boolean(root&&board&&canvas&&state&&window.__PROJECTC_PROTOTYPE__?.motionTrace),
    implementation:root?.dataset.implementation??'',
    authority:root?.dataset.authority??'',
    aimContract:root?.dataset.basicAimContract??'',
    basicRules:root?.dataset.basicMoveRules??'',
    driveRule:root?.dataset.driveRule??'',
    contactRule:root?.dataset.contactRule??'',
    forcedMoveRule:root?.dataset.forcedMoveRule??'',
    incomingComposition:root?.dataset.incomingComposition??'',
    playing:root?.dataset.playing==='true',
    worldAt:Number(root?.dataset.worldAt??-1),
    q,r,
    momentum:state?.momentum??-1,
    axisId:state?.axisId??'none',
    actionId:state?.actionId??'',
    spatialMode:state?.spatialMode??'',
    atVisualMs:state?.atVisualMs??0,
    thermalPeriodAt:state?.thermalPeriodAt??0,
    thermalCycleAt:Number(pendulum?.dataset.cycleAt??0),
    axisDisplayOverride:state?.axisDisplayOverride??'',
    boardAxisStyle:board?.dataset.axisStyle??'',
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
    incomingControlCount:root?.querySelectorAll('[data-incoming-composition-select]').length??0,
    actorAxisHudCount:root?.querySelectorAll('.actor-axis-hud').length??0,
    downAxisControlCount:root?.querySelectorAll('[data-axis-display^="down-"]').length??0,
    bridge:window.__PROJECTC_PROTOTYPE__?.__motionTraceBridge??''
  };
})()`

const snapshot = (client) => evaluate(client, snapshotExpression)

async function idleAt(client, worldAt, q = null, r = null) {
  return waitFor(`idle at ${worldAt}`, async () => {
    const value = await snapshot(client)
    if (!value.ready || value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    if (q !== null && (value.q !== q || value.r !== r)) throw new Error(JSON.stringify(value))
    return value
  })
}

async function callAndWait(client, expression, check, label) {
  assert(await evaluate(client, expression), `${label} rejected`)
  return waitFor(label, async () => {
    const value = await snapshot(client)
    if (value.playing || !check(value)) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setAction(client, id) {
  return callAndWait(client, `window.__PROJECTC_PROTOTYPE__.setAction(${JSON.stringify(id)})`, (v) => v.actionId === id, `action ${id}`)
}
async function setKinematics(client, axisId, level) {
  const expected = axisId === 'none' ? 'none' : axisId
  return callAndWait(
    client,
    `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axisId)},${level})`,
    (v) => v.axisId === expected && v.momentum === level,
    `${axisId} M${level}`,
  )
}
async function setSpatialMode(client, mode) {
  return callAndWait(client, `window.__PROJECTC_PROTOTYPE__.setSpatialMode(${JSON.stringify(mode)})`, (v) => v.spatialMode === mode, `Spatial ${mode}`)
}
async function setComposition(client, mode) {
  return callAndWait(
    client,
    `window.__PROJECTC_PROTOTYPE__.setIncomingCompositionMode(${JSON.stringify(mode)})`,
    (v) => v.incomingComposition === mode,
    `Incoming ${mode}`,
  )
}
async function setAtMs(client, value) {
  return callAndWait(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`, (v) => v.atVisualMs === value, `AT ${value}`)
}
async function setThermal(client, value) {
  return callAndWait(client, `window.__PROJECTC_PROTOTYPE__.setThermalPeriod(${value})`, (v) => v.thermalPeriodAt === value && v.thermalCycleAt === value, `Thermal ${value}`)
}
async function setAxisDisplay(client, value) {
  return callAndWait(client, `window.__PROJECTC_PROTOTYPE__.setAxisDisplay(${JSON.stringify(value)})`, (v) => v.axisDisplayOverride === value, `Axis display ${value}`)
}

async function setCollisionSurfaces(client, enabled) {
  const desired = enabled ? 'ON' : 'OFF'
  assert(await evaluate(client, `(() => {
    const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'));
    if(!b)return false;
    if(!b.textContent.includes('${desired}'))b.click();
    return true;
  })()`), 'Collision Surfaces control missing')
  await waitFor(`Collision ${desired}`, async () => {
    const label = await evaluate(client, `([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'))?.textContent??'')`)
    if (!label.includes(desired)) throw new Error(label)
    return label
  })
}

async function reset(client) {
  assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reset()'), 'reset rejected')
  return idleAt(client, 0)
}

async function reachability(client) {
  return evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reachability()')
}
function keyOf(entry) {
  const hex = entry.finalHex ?? entry.targetHex
  return `${hex.q},${hex.r}`
}
function findReach(reach, q, r) {
  return reach.find((entry) => keyOf(entry) === `${q},${r}`)
}
function pathKeys(entry) {
  return (entry?.pathCells ?? []).map((hex) => `${hex.q},${hex.r}`)
}

async function fire(client, q, r) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},${r})`), `fireAt(${q},${r}) rejected`)
}

async function captureConflicts(client, predicate, label) {
  return waitFor(label, async () => {
    const events = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.conflicts()')
    if (!Array.isArray(events) || !predicate(events)) throw new Error(JSON.stringify(events))
    return events
  }, 220, 20)
}

async function capturePlayerTrace(client, expectedLength, label) {
  return waitFor(label, async () => {
    const trace = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.motionTrace('player')`)
    if (!Array.isArray(trace) || trace.length !== expectedLength) throw new Error(JSON.stringify(trace))
    return trace
  }, 220, 20)
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

  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229',
    `--user-data-dir=${join(tmpdir(), `projectc-spatial-v1-${process.pid}`)}`,
    '--window-size=1600,1100', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  await waitFor('Chrome DevTools', async () => {
    const response = await fetch(`${debugUrl}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }, 240, 50)
  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Page.bringToFront')
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('Spatial Inertia v1 runtime', async () => {
    const value = await snapshot(client)
    if (!value.ready || value.viewportWidth < 500 || value.viewportHeight < 280 || value.canvasWidth < 500 || value.canvasHeight < 280) throw new Error(JSON.stringify(value))
    return value
  })
  assert(initial.implementation === 'spatial-inertia-v1-candidate', 'v1 implementation marker missing', initial)
  assert(initial.authority === 'spatial-inertia-v1-cell-axis-momentum', 'v1 authority marker missing', initial)
  assert(initial.aimContract === 'reachable-landing-cell-v1' && initial.basicRules === 'initiative-first-travel-transaction-v1', 'Basic v1 contract missing', initial)
  assert(initial.driveRule === 'drive-build-inertia-prototype-candidate-v1', 'Drive candidate marker missing', initial)
  assert(initial.contactRule === 'contact-strike-direct-transfer-v1' && initial.forcedMoveRule === 'forced-use-on-first-travel-v1', 'Contact / Forced v1 markers missing', initial)
  assert(initial.incomingComposition === 'true-vector' && initial.incomingControlCount === 2, 'Incoming A/B UI missing', initial)
  assert(initial.bridge === 'motion-trace-debug-bridge-v1', 'MotionTrace bridge missing', initial)
  assert(initial.actionCardCount === 7 && initial.actorAxisHudCount === 1 && initial.downAxisControlCount === 3, 'core UI structure regressed', initial)
  assert(initial.boardAxisStyle === 'actor-body-screen-arrow-v5' && initial.boardAxisLengthPx === 30 && Math.abs(initial.boardAxisStrokePx - 2.5) < 0.01 && initial.boardAxisSupportsDown === 'true' && initial.boardAxisAnchor === 'actor-body', 'Axis HUD regressed', initial)
  assert(initial.previewStyle === 'blue-dashed-no-arrow-v3' && initial.reachableHighlight === 'lifted-outline-v3' && initial.knockbackPreview === 'yellow-dashed-path-v2' && initial.knockbackPlayback === 'contact-staggered-fast-v3', 'route / knockback presentation regressed', initial)
  assert(initial.atVisualMs === 500 && initial.thermalPeriodAt === 4 && initial.thermalCycleAt === 4, 'default timebase regressed', initial)

  await setComposition(client, 'hex-lookup')
  await setComposition(client, 'true-vector')
  await setAxisDisplay(client, 'down-2')
  await setAxisDisplay(client, 'auto')
  await setThermal(client, 6)
  await setThermal(client, 4)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)

  // M0 NoAxis -> establish Axis/M0, then same-axis Generate to M1 and M2.
  await reset(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'none', 0)
  const m0Reach = await reachability(client)
  assert(m0Reach.map(keyOf).sort().join('|') === ['-1,0','-1,1','0,-1','0,1','1,-1','1,0'].sort().join('|'), 'M0 reachability changed', m0Reach)
  await fire(client, 1, 0)
  let value = await idleAt(client, 1, 1, 0)
  assert(value.axisId === 'E' && value.momentum === 0, 'M0 NoAxis startup wrong', value)

  await setKinematics(client, 'E', 0)
  await fire(client, 2, 0)
  value = await idleAt(client, 2, 2, 0)
  assert(value.axisId === 'E' && value.momentum === 1, 'M0 Axis -> M1 Generate wrong', value)

  await setKinematics(client, 'E', 1)
  await fire(client, 3, 0)
  value = await idleAt(client, 3, 3, 0)
  assert(value.axisId === 'E' && value.momentum === 2, 'M1 -> M2 Generate wrong', value)

  // M2 Travel2 and M3 Travel3 keep authored route length while committing one Action transaction.
  await reset(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  let reach = await reachability(client)
  let forward = findReach(reach, 2, 0)
  assert(forward && pathKeys(forward).join('|') === '1,0|2,0', 'M2 forward route must be Travel2', forward)
  await fire(client, 2, 0)
  value = await idleAt(client, 1, 2, 0)
  assert(value.axisId === 'E' && value.momentum === 1, 'M2 Basic transaction wrong', value)

  await reset(client)
  await setAtMs(client, 650)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 3)
  reach = await reachability(client)
  forward = findReach(reach, 3, 0)
  assert(forward && pathKeys(forward).join('|') === '1,0|2,0|3,0', 'M3 forward route must be Travel3', forward)
  await fire(client, 3, 0)
  const m3Trace = await capturePlayerTrace(client, 3, 'M3 player trace')
  assert(m3Trace[0]?.cost === 1 && m3Trace[0]?.remainingBefore === 3 && m3Trace[0]?.remainingAfter === 2 && m3Trace[0]?.momentumBefore === 3 && m3Trace[0]?.momentumAfter === 2, 'M3 first Travel transaction not recorded on trace', m3Trace)
  assert(m3Trace[1]?.momentumBefore === 2 && m3Trace[2]?.remainingAfter === 0, 'M3 remaining trace wrong', m3Trace)
  value = await idleAt(client, 1, 3, 0)
  assert(value.axisId === 'E' && value.momentum === 2, 'M3 Basic transaction wrong', value)

  // Discrete / Hybrid is presentation A/B for migrated Basic movement, not two gameplay solvers.
  await reset(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setSpatialMode(client, 'hybrid')
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  reach = await reachability(client)
  forward = findReach(reach, 2, 0)
  assert(forward && pathKeys(forward).join('|') === '1,0|2,0', 'Hybrid Basic route diverged from v1 logic', forward)
  await fire(client, 2, 0)
  value = await idleAt(client, 1, 2, 0)
  assert(value.spatialMode === 'hybrid' && value.momentum === 1 && value.axisId === 'E', 'Hybrid Basic final state diverged', value)

  // Drive candidate builds +1M after first Travel but does not retroactively extend this Action route.
  await reset(client)
  await setAtMs(client, 250)
  await setCollisionSurfaces(client, false)
  await setAction(client, 'drive')
  await setKinematics(client, 'E', 2)
  reach = await reachability(client)
  forward = findReach(reach, 2, 0)
  assert(forward && pathKeys(forward).join('|') === '1,0|2,0', 'Drive must keep the declared M2 Travel2 route', forward)
  await fire(client, 2, 0)
  value = await idleAt(client, 1, 2, 0)
  assert(value.momentum === 3 && value.axisId === 'E', 'Drive Build candidate did not create M3', value)

  // Adjacent Strike has priority over an uncommitted Basic transaction: M3 transfers as M3.
  await reset(client)
  await setAtMs(client, 650)
  await setCollisionSurfaces(client, false)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`), 'wall scenario rejected')
  await idleAt(client, 0, -1, 0)
  await setKinematics(client, 'none', 0)
  await fire(client, 0, 0)
  await idleAt(client, 1, 0, 0)
  await setKinematics(client, 'E', 3)
  await fire(client, 3, 0)
  const adjacentEvents = await captureConflicts(client, (events) => events.some((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player' && event.impactM === 3), 'adjacent M3 Strike')
  const adjacentStrike = adjacentEvents.find((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player')
  const adjacentTransfer = adjacentEvents.find((event) => event.kind === 'momentum-transfer' && event.sourceActorId === 'player')
  assert(adjacentStrike?.contactBehavior === 'Strike' && adjacentStrike?.impactM === 3, 'adjacent Strike did not use pre-Travel M3', adjacentStrike)
  assert(adjacentTransfer?.sourceBeforeM === 3 && adjacentTransfer?.sourceAfterM === 0 && adjacentTransfer?.targetAfterM === 3, 'adjacent Strike transfer wrong', adjacentTransfer)
  value = await idleAt(client, 2, 1, 0)
  assert(value.momentum === 0, 'Strike Source must end M0', value)

  // If one empty Travel happens first, the Basic transaction commits M3->M2 and later Strike uses M2.
  await reset(client)
  await setAtMs(client, 650)
  await setCollisionSurfaces(client, false)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('chain')`), 'chain scenario rejected')
  await idleAt(client, 0, 0, 1)
  await setKinematics(client, 'E', 3)
  await fire(client, 3, 1)
  const laterEvents = await captureConflicts(client, (events) => events.some((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player' && event.impactM === 2), 'post-Travel M2 Strike')
  const laterStrike = laterEvents.find((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player')
  const laterTransfer = laterEvents.find((event) => event.kind === 'momentum-transfer' && event.sourceActorId === 'player')
  const forcedUse = laterEvents.find((event) => event.kind === 'momentum-event' && event.actorId === 'dummy-a' && event.cause === 'Forced Use')
  assert(laterStrike?.contactBehavior === 'Strike' && laterStrike?.impactM === 2, 'later Strike did not use post-first-Travel M2', laterStrike)
  assert(laterTransfer?.sourceBeforeM === 2 && laterTransfer?.sourceAfterM === 0 && laterTransfer?.targetAfterM === 2, 'later Strike direct Transfer wrong', laterTransfer)
  assert(forcedUse?.fromM === 2 && forcedUse?.toM === 1, 'Forced target did not perform one Forced Use before onward travel/contact', forcedUse)
  value = await idleAt(client, 1, 1, 1)
  assert(value.momentum === 0, 'blocked later Strike must still consume Source Momentum', value)

  console.log('Verified Spatial Inertia v1 in real Chrome: landing envelopes, first-Travel transactions, M2/M3 travel, shared Discrete/Hybrid logic, Drive Build candidate, adjacent/later Strike timing, Forced Use, MotionTrace, Incoming A/B, Axis/Thermal and canvas safety.')
} finally {
  try { client?.close() } catch {}
  try { chromeProcess?.kill('SIGTERM') } catch {}
  try { previewProcess?.kill('SIGTERM') } catch {}
}
