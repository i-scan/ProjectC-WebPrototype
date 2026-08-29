import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pageUrl = 'http://127.0.0.1:4184/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9234'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`) }
const which = (command) => { const result = spawnSync('which', [command], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : '' }

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

async function waitFor(label, operation, attempts = 260, delay = 40) {
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

const state = (client) => evaluate(client, `(() => {
  const api=window.__PROJECTC_PROTOTYPE__;
  const snapshot=api?.snapshot?.();
  const root=document.querySelector('.cell-world-prototype[data-implementation="spatial-inertia-v1-candidate"]');
  const panel=document.querySelector('.target-state-overlay[data-rule="target-m-axis-overlay-v1"]');
  const r=Math.round((snapshot?.position?.z??0)/0.8660254037844386);
  const q=Math.round((snapshot?.position?.x??0)-r*0.5);
  return {
    ready:Boolean(api&&snapshot&&root&&panel),
    playing:root?.dataset.playing==='true',
    worldAt:Number(root?.dataset.worldAt??-1),
    q,r,
    actors:(snapshot?.actors??[]).map(a=>({id:a.id,label:a.label,q:a.hex.q,r:a.hex.r,m:Number.isFinite(a.momentumLevel)?a.momentumLevel:0,axis:a.axisId??null})),
    rows:[...document.querySelectorAll('.target-state-row')].map(row=>({id:row.dataset.targetActorId,m:Number(row.dataset.targetM),axis:row.dataset.targetAxis,text:row.textContent})),
    composition:document.querySelector('.target-composition-preview')?.textContent??'',
  };
})()`)

async function idle(client, worldAt, q = null, r = null) {
  return waitFor(`idle ${worldAt}`, async () => {
    const value = await state(client)
    if (!value.ready || value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    if (q !== null && (value.q !== q || value.r !== r)) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setKinematics(client, axis, level) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axis)},${level})`), `setKinematics ${axis} M${level} rejected`)
  await waitFor(`kinematics ${axis} M${level}`, async () => {
    const snapshot = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.snapshot()`)
    if (snapshot.momentum !== level || snapshot.axisId !== (axis === 'none' ? null : axis)) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })
}

async function fire(client, q, r, expectedWorldAt, expectedQ, expectedR) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},${r})`), `fireAt(${q},${r}) rejected`)
  return idle(client, expectedWorldAt, expectedQ, expectedR)
}

async function setCollisionSurfaces(client, enabled) {
  const desired = enabled ? 'ON' : 'OFF'
  assert(await evaluate(client, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces')); if(!b)return false; if(!b.textContent.includes('${desired}'))b.click(); return true; })()`), 'Collision Surfaces control missing')
  await waitFor(`Collision ${desired}`, async () => {
    const label = await evaluate(client, `([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'))?.textContent??'')`)
    if (!label.includes(desired)) throw new Error(label)
    return label
  })
}

function actor(value, id = 'dummy-a') { return value.actors.find((entry) => entry.id === id) }
function row(value, id = 'dummy-a') { return value.rows.find((entry) => entry.id === id) }

let previewProcess, chromeProcess, client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4184', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9234',
    `--user-data-dir=${join(tmpdir(), `projectc-target-inertia-${process.pid}`)}`, '--window-size=1500,1000', 'about:blank',
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

  let value = await idle(client, 0)
  assert(value.rows.length === 3, 'Target inertia overlay must show all three default actors', value)
  for (const entry of value.rows) assert(entry.m === 0 && entry.axis === 'none', 'Reset targets must visibly start M0 / Axis —', entry)

  // Use the one-target wall scenario with collision geometry disabled so displacement is unambiguous.
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`), 'wall scenario rejected')
  await idle(client, 0, -1, 0)
  await setCollisionSurfaces(client, false)
  await setKinematics(client, 'none', 0)
  await fire(client, 0, 0, 1, 0, 0)

  // Adjacent M1 against a stationary M0 target: exactly one target Cell.
  await setKinematics(client, 'E', 1)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1,0)`), 'adjacent M1 Strike rejected')
  await waitFor('M1 composition preview', async () => {
    const current = await state(client)
    if (!current.composition.includes('Existing M0') || !current.composition.includes('Incoming M1') || !current.composition.includes('→ M1')) throw new Error(JSON.stringify(current))
    return current
  })
  value = await idle(client, 2, 1, 0)
  assert(actor(value)?.q === 2 && actor(value)?.r === 0 && actor(value)?.m === 0 && actor(value)?.axis === 'E', 'stationary target struck by M1 must move exactly 1 Cell', value)
  assert(row(value)?.m === 0 && row(value)?.axis === 'E', 'overlay did not update post-M1 target state', value)

  // Reset, then adjacent M2 against stationary M0: exactly two target Cells and residual M1.
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`), 'second wall scenario rejected')
  await idle(client, 0, -1, 0)
  await setKinematics(client, 'none', 0)
  await fire(client, 0, 0, 1, 0, 0)
  await setKinematics(client, 'E', 2)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(1,0)`), 'adjacent M2 Strike rejected')
  await waitFor('M2 composition preview', async () => {
    const current = await state(client)
    if (!current.composition.includes('Existing M0') || !current.composition.includes('Incoming M2') || !current.composition.includes('→ M2')) throw new Error(JSON.stringify(current))
    return current
  })
  value = await idle(client, 2, 1, 0)
  assert(actor(value)?.q === 3 && actor(value)?.r === 0 && actor(value)?.m === 1 && actor(value)?.axis === 'E', 'stationary target struck by M2 must move exactly 2 Cells and retain M1', value)
  assert(row(value)?.m === 1 && row(value)?.axis === 'E', 'overlay did not expose residual M1 after M2 Forced Move', value)

  // Move next to that same target without resetting it, then strike with M1.
  // Existing E M1 + Incoming E M1 -> composed M2, so the observed 2-Cell displacement is intentional composition, not doubled Strike distance.
  await setKinematics(client, 'none', 0)
  await fire(client, 2, 0, 3, 2, 0)
  value = await idle(client, 3, 2, 0)
  assert(actor(value)?.q === 3 && actor(value)?.m === 1, 'target inertia should persist while player repositions', value)
  await setKinematics(client, 'E', 1)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(3,0)`), 'persistent-M adjacent M1 Strike rejected')
  await waitFor('persistent M1 composition preview', async () => {
    const current = await state(client)
    if (!current.composition.includes('Existing M1 E') || !current.composition.includes('Incoming M1 E') || !current.composition.includes('→ M2 E')) throw new Error(JSON.stringify(current))
    return current
  })
  value = await idle(client, 4, 3, 0)
  assert(actor(value)?.q === 5 && actor(value)?.r === 0 && actor(value)?.m === 1, 'Existing M1 + Incoming M1 must compose to a 2-Cell Forced Move', value)

  console.log('Verified Target inertia UI and adjacent Strike distances in Chrome: M1->M0 travels 1, M2->M0 travels 2, and persisted E M1 + incoming E M1 composes to M2 / 2 Travel.')
} finally {
  try { client?.close() } catch {}
  try { chromeProcess?.kill('SIGTERM') } catch {}
  try { previewProcess?.kill('SIGTERM') } catch {}
}
