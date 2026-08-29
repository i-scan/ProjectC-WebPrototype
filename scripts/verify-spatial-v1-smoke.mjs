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
  const executable = [
    process.env.CHROME_BIN,
    which('google-chrome'),
    which('google-chrome-stable'),
    which('chromium'),
    which('chromium-browser'),
  ].find(Boolean)
  assert(executable, 'Chrome / Chromium executable was not found')
  return executable
}

async function waitFor(label, operation, attempts = 260, delay = 35) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try { return await operation() } catch (error) {
      lastError = error
      if (i + 1 < attempts) await sleep(delay)
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
    const id = this.nextId++
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

const snapshot = (client) => evaluate(client, `(() => {
  const root=document.querySelector('.cell-world-prototype[data-implementation="spatial-inertia-v1-candidate"]');
  const board=root?.querySelector('.cell-world-board');
  const canvas=board?.querySelector('canvas');
  const rect=canvas?.getBoundingClientRect();
  const state=window.__PROJECTC_PROTOTYPE__?.snapshot?.();
  const r=Math.round((state?.position?.z??0)/0.8660254037844386);
  const q=Math.round((state?.position?.x??0)-r*0.5);
  return {
    ready:Boolean(root&&board&&canvas&&state&&window.__PROJECTC_PROTOTYPE__?.motionTrace),
    implementation:root?.dataset.implementation??'',
    authority:root?.dataset.authority??'',
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
    spatialMode:state?.spatialMode??'',
    actionId:state?.actionId??'',
    atVisualMs:state?.atVisualMs??0,
    canvasWidth:Number(rect?.width??0),
    canvasHeight:Number(rect?.height??0),
    axisStyle:board?.dataset.axisStyle??'',
    incomingControls:root?.querySelectorAll('[data-incoming-composition-select]').length??0,
    bridge:window.__PROJECTC_PROTOTYPE__?.__motionTraceBridge??''
  };
})()`)

async function idle(client, worldAt, q = null, r = null) {
  return waitFor(`idle ${worldAt}`, async () => {
    const value = await snapshot(client)
    if (!value.ready || value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    if (q !== null && (value.q !== q || value.r !== r)) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setApi(client, expression, predicate, label) {
  assert(await evaluate(client, expression), `${label} rejected`)
  return waitFor(label, async () => {
    const value = await snapshot(client)
    if (value.playing || !predicate(value)) throw new Error(JSON.stringify(value))
    return value
  })
}

const setKinematics = (client, axis, level) => setApi(
  client,
  `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axis)},${level})`,
  (value) => value.axisId === (axis === 'none' ? 'none' : axis) && value.momentum === level,
  `${axis} M${level}`,
)
const setAction = (client, action) => setApi(
  client,
  `window.__PROJECTC_PROTOTYPE__.setAction(${JSON.stringify(action)})`,
  (value) => value.actionId === action,
  `action ${action}`,
)
const setMode = (client, mode) => setApi(
  client,
  `window.__PROJECTC_PROTOTYPE__.setSpatialMode(${JSON.stringify(mode)})`,
  (value) => value.spatialMode === mode,
  `mode ${mode}`,
)
const setComposition = (client, mode) => setApi(
  client,
  `window.__PROJECTC_PROTOTYPE__.setIncomingCompositionMode(${JSON.stringify(mode)})`,
  (value) => value.incomingComposition === mode,
  `composition ${mode}`,
)

async function setAtMs(client, ms) {
  return setApi(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${ms})`, (value) => value.atVisualMs === ms, `AT ${ms}`)
}

async function setSurfaces(client, enabled) {
  const desired = enabled ? 'ON' : 'OFF'
  assert(await evaluate(client, `(() => {
    const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'));
    if(!b)return false;
    if(!b.textContent.includes('${desired}'))b.click();
    return true;
  })()`), 'Collision Surfaces control missing')
  await waitFor(`surfaces ${desired}`, async () => {
    const label = await evaluate(client, `([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'))?.textContent??'')`)
    if (!label.includes(desired)) throw new Error(label)
    return true
  })
}

async function reset(client) {
  assert(await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reset()'), 'reset rejected')
  return idle(client, 0)
}

const keyOf = (entry) => {
  const hex = entry.finalHex ?? entry.targetHex
  return `${hex.q},${hex.r}`
}
const pathOf = (entry) => (entry?.pathCells ?? []).map((hex) => `${hex.q},${hex.r}`).join('|')

async function reach(client) {
  return evaluate(client, 'window.__PROJECTC_PROTOTYPE__.reachability()')
}

async function fire(client, q, r) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},${r})`), `fire ${q},${r} rejected`)
}

async function conflictsDuringPlayback(client, predicate, label) {
  return waitFor(label, async () => {
    const events = await evaluate(client, 'window.__PROJECTC_PROTOTYPE__.conflicts()')
    if (!Array.isArray(events) || !predicate(events)) throw new Error(JSON.stringify(events))
    return events
  }, 200, 20)
}

let previewProcess
let chromeProcess
let client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9229',
    `--user-data-dir=${join(tmpdir(), `projectc-v1-smoke-${process.pid}`)}`,
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
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('v1 runtime', async () => {
    const value = await snapshot(client)
    if (!value.ready || value.canvasWidth < 500 || value.canvasHeight < 280) throw new Error(JSON.stringify(value))
    return value
  })
  assert(initial.implementation === 'spatial-inertia-v1-candidate', 'implementation marker wrong', initial)
  assert(initial.authority === 'spatial-inertia-v1-cell-axis-momentum', 'authority marker wrong', initial)
  assert(initial.basicRules === 'initiative-first-travel-transaction-v1', 'Basic transaction marker wrong', initial)
  assert(initial.driveRule === 'drive-build-inertia-prototype-candidate-v1', 'Drive marker wrong', initial)
  assert(initial.contactRule === 'contact-strike-direct-transfer-v1', 'Strike marker wrong', initial)
  assert(initial.forcedMoveRule === 'forced-use-on-first-travel-v1', 'Forced marker wrong', initial)
  assert(initial.incomingComposition === 'true-vector' && initial.incomingControls === 2, 'Incoming A/B UI wrong', initial)
  assert(initial.axisStyle === 'actor-body-screen-arrow-v5', 'Axis HUD wrong', initial)
  assert(initial.bridge === 'motion-trace-debug-bridge-v1', 'MotionTrace bridge wrong', initial)

  await setAtMs(client, 250)
  await setSurfaces(client, false)
  await setComposition(client, 'hex-lookup')
  await setComposition(client, 'true-vector')

  // M2/M3 routes and action transactions.
  await reset(client)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  let reachable = await reach(client)
  let forward = reachable.find((entry) => keyOf(entry) === '2,0')
  assert(pathOf(forward) === '1,0|2,0', 'M2 route must remain Travel2', forward)
  await fire(client, 2, 0)
  let value = await idle(client, 1, 2, 0)
  assert(value.momentum === 1 && value.axisId === 'E', 'M2 Basic final state wrong', value)

  await reset(client)
  await setAtMs(client, 600)
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 3)
  reachable = await reach(client)
  forward = reachable.find((entry) => keyOf(entry) === '3,0')
  assert(pathOf(forward) === '1,0|2,0|3,0', 'M3 route must remain Travel3', forward)
  await fire(client, 3, 0)
  const playerTrace = await waitFor('M3 motion trace', async () => {
    const trace = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.motionTrace('player')`)
    if (!Array.isArray(trace) || trace.length !== 3) throw new Error(JSON.stringify(trace))
    return trace
  }, 200, 20)
  assert(playerTrace[0]?.momentumBefore === 3 && playerTrace[0]?.momentumAfter === 2 && playerTrace[0]?.remainingBefore === 3 && playerTrace[0]?.remainingAfter === 2, 'first-Travel M3→M2 transaction missing', playerTrace)
  value = await idle(client, 1, 3, 0)
  assert(value.momentum === 2 && value.axisId === 'E', 'M3 Basic final state wrong', value)

  // Hybrid is presentation only for migrated Basic.
  await reset(client)
  await setAtMs(client, 250)
  await setMode(client, 'hybrid')
  await setAction(client, 'basic-move')
  await setKinematics(client, 'E', 2)
  reachable = await reach(client)
  forward = reachable.find((entry) => keyOf(entry) === '2,0')
  assert(pathOf(forward) === '1,0|2,0', 'Hybrid Basic route diverged', forward)
  await fire(client, 2, 0)
  value = await idle(client, 1, 2, 0)
  assert(value.spatialMode === 'hybrid' && value.momentum === 1, 'Hybrid Basic result diverged', value)

  // Drive candidate builds M3 without enlarging the declared M2 route.
  await reset(client)
  await setAtMs(client, 250)
  await setAction(client, 'drive')
  await setKinematics(client, 'E', 2)
  reachable = await reach(client)
  forward = reachable.find((entry) => keyOf(entry) === '2,0')
  assert(pathOf(forward) === '1,0|2,0', 'Drive candidate retroactively enlarged route', forward)
  await fire(client, 2, 0)
  value = await idle(client, 1, 2, 0)
  assert(value.momentum === 3 && value.axisId === 'E', 'Drive candidate did not build M3', value)

  // Adjacent Strike preempts pending Basic transaction and transfers M3.
  await reset(client)
  await setAtMs(client, 600)
  await setSurfaces(client, false)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`), 'wall scenario rejected')
  await idle(client, 0, -1, 0)
  await setKinematics(client, 'none', 0)
  await fire(client, 0, 0)
  await idle(client, 1, 0, 0)
  await setKinematics(client, 'E', 3)
  await fire(client, 3, 0)
  let events = await conflictsDuringPlayback(client, (list) => list.some((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player' && event.impactM === 3), 'adjacent M3 Strike')
  let strike = events.find((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player')
  let transfer = events.find((event) => event.kind === 'momentum-transfer' && event.sourceActorId === 'player')
  assert(strike?.contactBehavior === 'Strike' && strike?.impactM === 3, 'adjacent Strike timing wrong', strike)
  assert(transfer?.sourceBeforeM === 3 && transfer?.sourceAfterM === 0 && transfer?.targetAfterM === 3, 'adjacent Strike transfer wrong', transfer)
  value = await idle(client, 2, 1, 0)
  assert(value.momentum === 0, 'adjacent Strike Source must end M0', value)

  // One empty Travel first commits M3→M2; later Strike therefore uses M2.
  await reset(client)
  await setAtMs(client, 600)
  await setSurfaces(client, false)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('chain')`), 'chain scenario rejected')
  await idle(client, 0, 0, 1)
  await setKinematics(client, 'E', 3)
  await fire(client, 3, 1)
  events = await conflictsDuringPlayback(client, (list) => list.some((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player' && event.impactM === 2), 'later M2 Strike')
  strike = events.find((event) => event.kind === 'cell-conflict' && event.sourceActorId === 'player')
  transfer = events.find((event) => event.kind === 'momentum-transfer' && event.sourceActorId === 'player')
  const forcedUse = events.find((event) => event.kind === 'momentum-event' && event.actorId === 'dummy-a' && event.cause === 'Forced Use')
  assert(strike?.impactM === 2 && strike?.contactBehavior === 'Strike', 'post-Travel Strike timing wrong', strike)
  assert(transfer?.sourceBeforeM === 2 && transfer?.sourceAfterM === 0 && transfer?.targetAfterM === 2, 'later Strike transfer wrong', transfer)
  assert(forcedUse?.fromM === 2 && forcedUse?.toM === 1, 'Forced Use missing', forcedUse)
  value = await idle(client, 1, 2, 1)
  assert(value.momentum === 0, 'later Strike Source must end M0', value)

  console.log('Verified Spatial Inertia v1 browser smoke: M2/M3 travel, first-Travel transaction, shared Hybrid logic, Drive candidate, Incoming A/B, adjacent/later Strike timing, Forced Use, MotionTrace, Axis and canvas.')
} finally {
  try { client?.close() } catch {}
  try { chromeProcess?.kill('SIGTERM') } catch {}
  try { previewProcess?.kill('SIGTERM') } catch {}
}
