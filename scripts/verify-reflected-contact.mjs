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
  const state=window.__PROJECTC_PROTOTYPE__?.snapshot?.();
  return {
    ready:Boolean(root&&state),
    playing:root?.dataset.playing==='true',
    worldAt:Number(root?.dataset.worldAt??-1),
    actionId:state?.actionId??'',
    momentum:state?.momentum??-1,
    axisId:state?.axisId??'none',
    actors:state?.actors??[],
  }
})()`)

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
    `--user-data-dir=${join(tmpdir(), `projectc-reflected-contact-${process.pid}`)}`, '--window-size=1400,1000', 'about:blank',
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
  await waitFor('prototype runtime', async () => {
    const value = await snapshot(client)
    if (!value.ready) throw new Error(JSON.stringify(value))
    return value
  })

  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('reflection-chain')`), 'reflection-chain scenario rejected')
  await waitFor('reflection-chain state', async () => {
    const value = await snapshot(client)
    if (value.playing || value.momentum !== 3 || value.axisId !== 'SW' || value.actors.length !== 2) throw new Error(JSON.stringify(value))
    return value
  })
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAction('basic-move')`), 'Basic Move rejected')
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(900)`), 'AT 900 rejected')
  await sleep(80)

  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.fireAt(-1,1)`), 'reflection-chain action rejected')
  await waitFor('reflection-chain playback', async () => {
    const value = await snapshot(client)
    if (!value.playing) throw new Error(JSON.stringify(value))
    return value
  })
  await sleep(520)

  const evidence = await evaluate(client, `(() => ({
    conflicts: window.__PROJECTC_PROTOTYPE__.conflicts(),
    trajectories: window.__PROJECTC_PROTOTYPE__.actorTrajectories(),
    windows: window.__PROJECTC_PROTOTYPE__.actorPlaybackWindows(),
    root: (() => { const root=document.querySelector('.cell-world-prototype'); return {
      playing:root?.dataset.playing,
      playbackProgress:document.querySelector('.cell-world-board')?.dataset.playbackProgress,
      actorWindowCount:document.querySelector('.cell-world-board')?.dataset.actorPlaybackWindowCount,
    } })(),
  }))()`)

  const reflected = evidence.conflicts.filter((event) => event.kind === 'momentum-transfer' && event.sourceActorId === 'dummy-a' && event.targetActorId === 'dummy-b' && event.model === 'reflected-actor-current-m-exchange-v1')
  assert(reflected.length === 1, 'reflected Actor transfer must occur exactly once', evidence)
  assert(reflected[0].sourceBeforeM === 2 && reflected[0].sourceAfterM === 1 && reflected[0].targetAfterM === 2, 'reflected current-M exchange mismatch', reflected[0])

  const aPath = evidence.trajectories['dummy-a'] ?? []
  const bPath = evidence.trajectories['dummy-b'] ?? []
  assert(aPath.length > 2 && bPath.length > 1, 'both Actors need real playback trajectories', evidence.trajectories)
  assert(aPath.at(-1)?.q === 0 && aPath.at(-1)?.r === 2, 'A over-travelled after becoming M1', aPath)
  assert(!aPath.some((cell) => cell.q === 0 && cell.r === 3), 'A must not consume the old M3 remainder', aPath)
  assert(bPath.at(-1)?.q === 0 && bPath.at(-1)?.r === 3, 'B must be visibly/logically knocked away', bPath)

  const aWindow = evidence.windows['dummy-a']
  const bWindow = evidence.windows['dummy-b']
  assert(aWindow && bWindow, 'reflected contact needs playback windows for both Actors', evidence.windows)
  assert(bWindow.start - aWindow.start < 0.08, 'B playback starts too late and can appear to disappear under A', evidence.windows)
  assert(bWindow.start < aWindow.end, 'Actor playback windows must overlap at reflected contact', evidence.windows)
  assert(Number(evidence.root.actorWindowCount) >= 2, 'board did not expose both Actor playback windows', evidence.root)

  console.log('Verified reflected contact in Chrome: current-M caps remaining travel, target trajectory is preserved, and contact playback windows overlap.')
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
