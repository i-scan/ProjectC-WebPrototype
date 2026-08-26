import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pageUrl = 'http://127.0.0.1:4181/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9230'
const artifactDir = resolve('artifacts')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`) }
const which = (command) => { const result = spawnSync('which', [command], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : '' }

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

async function waitFor(label, operation, attempts = 180, delay = 40) {
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
  const root=document.querySelector('.cell-world-prototype[data-implementation="cell-world-spatial-ab-v3"]');
  const board=root?.querySelector('.cell-world-board');
  return {
    ready:Boolean(root&&board&&board.querySelector('canvas')),
    playing:root?.dataset.playing==='true',
    worldAt:Number(root?.dataset.worldAt??-1),
    momentum:Number(root?.dataset.momentum??-1),
    axisId:root?.dataset.axisId??'',
    wallVisualContract:board?.dataset.wallVisualContract??'',
    wallReflectionPathContract:board?.dataset.wallReflectionPathContract??'',
    hardWallAxis:board?.dataset.hardWallAxis??'',
    hardWallYaw:Number(board?.dataset.hardWallYaw??NaN),
    playbackPathMode:board?.dataset.playbackPathMode??'',
    playbackProgress:Number(board?.dataset.playbackProgress??0),
    visualX:Number(board?.dataset.visualX??NaN),
    visualZ:Number(board?.dataset.visualZ??NaN),
  }
})()`
const snapshot = (client) => evaluate(client, snapshotExpression)

async function idleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt}`, async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value))
    return value
  })
}

async function setKinematics(client, axisId, level) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axisId)},${level})`), 'setKinematics failed')
  const expectedAxis = axisId === 'none' ? 'none' : axisId
  return waitFor(`kinematics ${axisId} M${level}`, async () => {
    const value = await snapshot(client)
    if (value.playing || value.axisId !== expectedAxis || value.momentum !== level) throw new Error(JSON.stringify(value))
    return value
  })
}

async function moveM0(client, q, r, worldAt) {
  await setKinematics(client, 'none', 0)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(${q},${r})`), `M0 move ${q},${r} rejected`)
  await idleAt(client, worldAt)
}

let previewProcess, chromeProcess, client
try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4181', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[wall-preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[wall-preview] ${chunk}`))
  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9230',
    `--user-data-dir=${join(tmpdir(), `projectc-wall-visual-${process.pid}`)}`, '--window-size=1600,1100', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  await waitFor('Chrome DevTools', async () => {
    const response = await fetch(`${debugUrl}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }, 240, 50)

  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: pageUrl })

  const initial = await waitFor('visible wall runtime', async () => {
    const value = await snapshot(client)
    if (!value.ready || value.hardWallAxis !== 'NS') throw new Error(JSON.stringify(value))
    return value
  })
  assert(initial.wallVisualContract === 'wall-axis-mesh-v1', 'visible wall contract missing', initial)
  assert(initial.wallReflectionPathContract === 'wall-pivot-polyline-v1', 'wall polyline contract missing', initial)
  assert(Math.abs(Math.abs(initial.hardWallYaw) - Math.PI / 2) < 0.002, 'NS wall mesh is not rotated onto the N-S tangent', initial)

  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('wall')`), 'wall scenario rejected')
  await waitFor('wall scenario ready', async () => {
    const value = await snapshot(client)
    if (value.playing || value.worldAt !== 0 || value.axisId !== 'E' || value.momentum !== 2) throw new Error(JSON.stringify(value))
    return value
  })
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(250)`), 'setup AT rejected')
  await moveM0(client, 0, 0, 1)
  await moveM0(client, 1, -1, 2)
  await moveM0(client, 2, -1, 3)
  await moveM0(client, 3, -1, 4)
  await moveM0(client, 4, -1, 5)
  await setKinematics(client, 'SW', 3)
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(1200)`), 'reflection AT rejected')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(3,0)`), 'oblique wall reflection rejected')

  const duringReflection = await waitFor('wall pivot polyline playback', async () => {
    const value = await snapshot(client)
    if (!value.playing || value.playbackPathMode !== 'wall-pivot-polyline-v1' || value.playbackProgress < 0.25 || value.playbackProgress > 0.78) {
      throw new Error(JSON.stringify(value))
    }
    return value
  }, 220, 30)

  const trajectory = await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`)
  const compact = trajectory.map((sample) => {
    const r = Math.round(sample.position.z / 0.8660254037844386)
    const q = Math.round(sample.position.x - r * 0.5)
    return `${q},${r}`
  }).filter((value, index, values) => index === 0 || value !== values[index - 1])
  assert(compact.join('|') === '4,-1|3,0|3,1|3,2|3,3', 'visible player reflection path no longer matches wall pivot geometry', compact)

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(artifactDir, 'wall-visible-reflection.png'), Buffer.from(screenshot.data, 'base64'))
  await writeFile(join(artifactDir, 'wall-visible-reflection.json'), `${JSON.stringify({ initial, duringReflection, trajectory: compact }, null, 2)}\n`)

  const final = await idleAt(client, 6)
  assert(final.axisId === 'SE' && final.momentum === 1, 'wall reflection final Axis/M changed', final)
  console.log('Verified visible NS wall orientation and unsmoothed wall-cell pivot playback in Chrome.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
