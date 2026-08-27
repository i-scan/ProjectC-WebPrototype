import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pageUrl = 'http://127.0.0.1:4182/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9231'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`) }
const which = (command) => { const result = spawnSync('which', [command], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : '' }

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

async function waitFor(label, operation, attempts = 220, delay = 35) {
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
  const state=window.__PROJECTC_PROTOTYPE__?.snapshot?.();
  return {
    ready:Boolean(root&&state),
    playing:root?.dataset.playing==='true',
    worldAt:Number(root?.dataset.worldAt??-1),
    q:Math.round((state?.position?.x??0) - Math.round((state?.position?.z??0)/0.8660254037844386)*0.5),
    r:Math.round((state?.position?.z??0)/0.8660254037844386),
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
  await syncSet(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(250)`, (v) => v.atVisualMs === 250, 'AT 250')

  for (const [q, worldAt] of [[1, 1], [2, 2]]) {
    await syncSet(client, `window.__PROJECTC_PROTOTYPE__.setKinematics('none',0)`, (v) => v.momentum === 0, `M0 before ${q},0`)
    assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},0)`), `move to ${q},0 rejected`)
    await waitIdle(client, worldAt, q, 0)
  }
}

let previewProcess, chromeProcess, client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9231',
    `--user-data-dir=${join(tmpdir(), `projectc-wall-budget-${process.pid}`)}`, '--window-size=1400,1000', 'about:blank',
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
  await client.send('Page.navigate', { url: pageUrl })
  await waitFor('prototype runtime', async () => {
    const value = await snapshot(client)
    if (!value.ready) throw new Error(JSON.stringify(value))
    return value
  })

  // Start immediately west of the N-S wall at (3,0). Basic Action spend/build
  // creates Current M before the wall collision is resolved.
  const cases = [
    { level: 1, q: 2 }, // M1 builds to M2, wall reflection -> M1, budget already exhausted.
    { level: 2, q: 2 }, // M2 spends to M1, wall reflection -> M0: no extra reflected Cell.
    { level: 3, q: 1 }, // M3 spends to M2, wall reflection -> M1: one reflected Cell remains.
  ]
  for (const testCase of cases) {
    await prepareAdjacentToWall(client)
    await syncSet(
      client,
      `window.__PROJECTC_PROTOTYPE__.setKinematics('E',${testCase.level})`,
      (v) => v.axisId === 'E' && v.momentum === testCase.level,
      `E M${testCase.level}`,
    )
    assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(3,0)`), `M${testCase.level} wall action rejected`)
    const final = await waitIdle(client, 3, testCase.q, 0)
    assert(final.q === testCase.q && final.r === 0, `M${testCase.level} wall budget mismatch`, final)
  }

  console.log('Verified browser wall travel uses post-spend Current M: M2 adds no reflected Cell; M3 adds exactly one.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
