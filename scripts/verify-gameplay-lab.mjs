import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/#gameplay-lab'
const debugUrl = 'http://127.0.0.1:9230'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function until(label, operation, attempts = 200, delay = 50) {
  let error
  for (let index = 0; index < attempts; index += 1) {
    try {
      const value = await operation()
      if (value) return value
    } catch (cause) {
      error = cause
    }
    await sleep(delay)
  }
  throw new Error(`${label}: timed out ${error?.message ?? ''}`)
}

function chromeExecutable() {
  const which = (name) => spawnSync('which', [name], { encoding: 'utf8' }).stdout?.trim()
  return [
    process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(which),
  ].find((path) => path && existsSync(path))
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.errors = []
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (message) => {
      const value = JSON.parse(String(message.data))
      if (value.method === 'Runtime.exceptionThrown') this.errors.push(value.params.exceptionDetails)
      const pending = this.pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(value.id)
      value.error ? pending.reject(new Error(value.error.message)) : pending.resolve(value.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 10000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
}

let previewProcess, chromeProcess, client, temporaryProfile
const stop = async (child) => {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => {
    child.once('exit', resolve)
    child.kill()
    setTimeout(resolve, 3000)
  })
}

try {
  const executable = chromeExecutable()
  assert(executable, 'Chrome / Edge is required (or set CHROME_BIN)')

  previewProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  await until('Vite preview', async () => (await fetch(pageUrl)).ok)

  temporaryProfile = await mkdtemp(join(tmpdir(), 'projectc-gameplay-smoke-'))
  chromeProcess = spawn(executable, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9230',
    `--user-data-dir=${temporaryProfile}`, '--window-size=1800,1400', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })

  await until('Chrome DevTools', async () => (await fetch(`${debugUrl}/json/version`)).ok)
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json()
  client = new Cdp(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Page.navigate', { url: pageUrl })

  const snapshot = await until('Gameplay runtime', async () => {
    if (client.errors.length) throw new Error(JSON.stringify(client.errors.at(-1)))
    const value = await client.evaluate('window.__PROJECTC_GAMEPLAY_LAB__?.snapshot?.()')
    return value?.implementation === 'gameplay-momentum-thermal-v1-candidate' ? value : false
  })

  const mounted = await client.evaluate(`(() => {
    const root = document.querySelector('.gameplay-lab[data-implementation="gameplay-momentum-thermal-v1-candidate"]')
    const board = document.querySelector('.cell-world-board')
    const text = document.body.innerText
    return {
      root: Boolean(root),
      sharedThermal: root?.dataset.sharedThermalRuntime ?? '',
      profileId: root?.dataset.profileId ?? '',
      momentumBand: root?.dataset.momentumBand ?? '',
      heading: text.includes('Gameplay × Momentum × Thermal v1'),
      pendulum: Boolean(document.querySelector('[data-gameplay-thermal-pendulum="shared-runtime-v1"]')),
      actions: [...document.querySelectorAll('[data-gameplay-action-id]')].map((e) => e.dataset.gameplayActionId),
      experimentControls: text.includes('v1 Experiment Controls'),
      mtFactor: text.includes('M-T Factor'),
      collisionHeat: text.includes('Collision Heat'),
      collisionDamageOff: text.includes('Collision Damage OFF'),
      domainBuildOn: text.includes('Domain Build ON'),
      enemies: text.includes('Telegraphed Enemies'),
      moveIntent: text.includes('Next: MOVE'),
      braceIntent: text.includes('Next: BRACE'),
      resolutionTrace: Boolean(document.querySelector('[data-gameplay-resolution-trace="momentum-thermal-v1"]')),
      skipChain: text.includes('HM0 Axis → No Axis → DM0 Skip chain'),
      board: Boolean(board),
      boardRebuildCount: Number(board?.dataset.boardRebuildCount ?? 0),
    }
  })()`)

  assert(mounted.root, 'Gameplay v1 root missing')
  assert(mounted.sharedThermal === 'shared-thermal-profile-runtime-v1-candidate', 'Shared Thermal runtime marker missing')
  assert(mounted.profileId === 'thermal-baseline-a', 'Active Thermal Profile id missing')
  assert(mounted.momentumBand === 'NO AXIS', 'Initial Momentum band marker missing')
  assert(mounted.heading, 'Gameplay v1 heading missing')
  assert(mounted.pendulum, 'Shared Thermal Pendulum missing')
  for (const actionId of ['move', 'drive', 'attack', 'brace', 'launch', 'release', 'skip']) {
    assert(mounted.actions.includes(actionId), `Gameplay action ${actionId} missing`)
  }
  assert(mounted.experimentControls && mounted.mtFactor && mounted.collisionHeat, 'Gameplay experiment controls missing')
  assert(mounted.collisionDamageOff && mounted.domainBuildOn, 'Gameplay experiment toggle baseline missing')
  assert(mounted.enemies && mounted.moveIntent && mounted.braceIntent, 'Initial telegraphed enemy intents missing')
  assert(mounted.resolutionTrace, 'Cause-aware Resolution Trace missing')
  assert(mounted.skipChain, 'Skip chain scope marker missing')
  assert(mounted.board && mounted.boardRebuildCount >= 1, 'Board3D did not mount')
  assert(snapshot.ready && snapshot.worldAt === 0, 'Gameplay initial Ready snapshot changed')
  assert(client.errors.length === 0, `Browser exceptions: ${JSON.stringify(client.errors)}`)

  console.log('Gameplay Lab browser smoke verified through CDP: Momentum v1 actions, shared Thermal V3 pendulum/runtime, telegraphed enemies, controls and Board3D are mounted.')
} finally {
  try { client?.socket.close() } catch {}
  await stop(chromeProcess)
  await stop(previewProcess)
  if (temporaryProfile && dirname(resolve(temporaryProfile)) === resolve(tmpdir()) && basename(temporaryProfile).startsWith('projectc-gameplay-smoke-')) {
    await rm(temporaryProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}
