import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pageUrl = 'http://127.0.0.1:4183/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9232'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`) }
const which = (command) => { const result = spawnSync('which', [command], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : '' }

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

async function waitFor(label, operation, attempts = 240, delay = 40) {
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

const snapshot = (client) => evaluate(client, `(() => {
  const root=document.querySelector('.cell-world-prototype[data-implementation="cell-world-spatial-ab-v3"]');
  const api=window.__PROJECTC_PROTOTYPE__;
  const state=api?.snapshot?.();
  const r=Math.round((state?.position?.z??0)/0.8660254037844386);
  const q=Math.round((state?.position?.x??0)-r*0.5);
  return {
    ready:Boolean(root&&state&&api?.motionTrace),
    bridge:api?.__motionTraceBridge??'',
    playing:root?.dataset.playing==='true',
    worldAt:Number(root?.dataset.worldAt??-1),
    q,r,
    axisId:state?.axisId??'none',
    momentum:state?.momentum??-1,
    actionId:state?.actionId??'',
    atVisualMs:state?.atVisualMs??0,
  }
})()`)

async function waitIdle(client, worldAt, q, r) {
  return waitFor(`idle ${worldAt} at ${q},${r}`, async () => {
    const value = await snapshot(client)
    if (!value.ready || value.playing || value.worldAt !== worldAt || value.q !== q || value.r !== r) throw new Error(JSON.stringify(value))
    return value
  })
}

async function syncSet(client, expression, check, label) {
  assert(await evaluate(client, expression), `${label} rejected`)
  return waitFor(label, async () => {
    const value = await snapshot(client)
    if (value.playing || !check(value)) throw new Error(JSON.stringify(value))
    return value
  })
}

async function prepareAdjacentToWall(client) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reset()`), 'reset rejected')
  await waitIdle(client, 0, 0, 0)
  await syncSet(client, `window.__PROJECTC_PROTOTYPE__.setAction('basic-move')`, (v) => v.actionId === 'basic-move', 'Basic Move')
  await syncSet(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(900)`, (v) => v.atVisualMs === 900, 'AT 900')
  for (const [q, worldAt] of [[1, 1], [2, 2]]) {
    await syncSet(client, `window.__PROJECTC_PROTOTYPE__.setKinematics('none',0)`, (v) => v.momentum === 0, `M0 before ${q},0`)
    assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},0)`), `move to ${q},0 rejected`)
    await waitIdle(client, worldAt, q, 0)
  }
}

function assertStep(step, expected, label) {
  assert(step?.kind === expected.kind, `${label} kind`, step)
  assert(step?.cost === expected.cost, `${label} cost`, step)
  assert(step?.remainingBefore === expected.before && step?.remainingAfter === expected.after, `${label} remaining`, step)
  assert(step?.from?.q === expected.from[0] && step?.from?.r === expected.from[1], `${label} from`, step)
  assert(step?.to?.q === expected.to[0] && step?.to?.r === expected.to[1], `${label} to`, step)
  if (expected.mBefore !== undefined) assert(step?.momentumBefore === expected.mBefore, `${label} momentumBefore`, step)
  if (expected.mAfter !== undefined) assert(step?.momentumAfter === expected.mAfter, `${label} momentumAfter`, step)
}

let previewProcess, chromeProcess, client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4183', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9232',
    `--user-data-dir=${join(tmpdir(), `projectc-motion-trace-${process.pid}`)}`, '--window-size=1400,1000', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  await waitFor('Chrome DevTools', async () => {
    const response = await fetch(`${debugUrl}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create Chrome target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Page.navigate', { url: pageUrl })
  const ready = await waitFor('motion trace runtime', async () => {
    const value = await snapshot(client)
    if (!value.ready || value.bridge !== 'motion-trace-debug-bridge-v1') throw new Error(JSON.stringify(value))
    return value
  })
  assert(ready.bridge === 'motion-trace-debug-bridge-v1', 'motion trace bridge missing', ready)

  // Player starts E M3 immediately west of the wall. Basic spend produces
  // Current M2 first; wall reflection makes it M1, so exactly one reflected
  // full Cell remains after the wall-cell round-trip.
  await prepareAdjacentToWall(client)
  await syncSet(client, `window.__PROJECTC_PROTOTYPE__.setKinematics('E',3)`, (v) => v.axisId === 'E' && v.momentum === 3, 'E M3')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(3,0)`), 'M3 wall action rejected')
  const playerTrace = await waitFor('player M3 authoritative trace', async () => {
    const trace = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.motionTrace('player')`)
    if (!Array.isArray(trace) || trace.length !== 2) throw new Error(JSON.stringify(trace))
    return trace
  })
  assertStep(playerTrace[0], { kind: 'wall-cell-step', cost: 1, before: 3, after: 1, from: [2,0], to: [2,0], mBefore: 2, mAfter: 1 }, 'player #0')
  assertStep(playerTrace[1], { kind: 'cell-step', cost: 1, before: 1, after: 0, from: [2,0], to: [1,0], mBefore: 1, mAfter: 1 }, 'player #1')
  await waitIdle(client, 3, 1, 0)

  // Keep raw M2 knockback-wall coverage separate from Basic M2 impact semantics:
  // the player is made M3, whose Basic spend creates Current M2 and transfers M2
  // to dummy-a before the target reaches the wall.
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`), 'wall scenario rejected')
  await waitFor('wall scenario ready', async () => {
    const value = await snapshot(client)
    if (value.playing || value.q !== -1 || value.r !== 0 || value.momentum !== 2) throw new Error(JSON.stringify(value))
    return value
  })
  await syncSet(client, `window.__PROJECTC_PROTOTYPE__.setKinematics('E',3)`, (v) => v.axisId === 'E' && v.momentum === 3, 'wall scenario E M3')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(2,0)`), 'wall knockback rejected')
  const actorTrace = await waitFor('dummy-a authoritative trace', async () => {
    const trace = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.motionTrace('dummy-a')`)
    if (!Array.isArray(trace) || trace.length !== 2) throw new Error(JSON.stringify(trace))
    return trace
  })
  assertStep(actorTrace[0], { kind: 'cell-step', cost: 1, before: 2, after: 1, from: [1,0], to: [2,0], mBefore: 2, mAfter: 2 }, 'dummy-a #0')
  assertStep(actorTrace[1], { kind: 'wall-cell-step', cost: 1, before: 1, after: 0, from: [2,0], to: [2,0], mBefore: 2, mAfter: 1 }, 'dummy-a #1')

  console.log('Verified Current-M per-Cell motion traces in Chrome for Basic wall travel and true M2 knocked-Actor wall travel.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
