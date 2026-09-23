import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pageUrl = 'http://127.0.0.1:4183/ProjectC-WebPrototype/#thermal-lab'
const debugUrl = 'http://127.0.0.1:9233'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function until(label, operation, attempts = 180) {
  let error
  for (let index = 0; index < attempts; index += 1) {
    try {
      const value = await operation()
      if (value) return value
    } catch (cause) {
      error = cause
    }
    await sleep(40)
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
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

const closeState = (actual, expected, epsilon = 1e-5) =>
  Math.abs(actual.temperature - expected.temperature) <= epsilon
  && Math.abs(actual.drift - expected.drift) <= epsilon
  && Math.abs(actual.setPoint - expected.setPoint) <= epsilon

let server
let browser
let client
let profile

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
  assert(executable, 'Chrome/Edge is required (or set CHROME_BIN)')

  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4183', '--strictPort'], { stdio: 'ignore', windowsHide: true })
  await until('Vite preview', async () => (await fetch(pageUrl)).ok)

  profile = await mkdtemp(join(tmpdir(), 'projectc-thermal-dual-'))
  browser = spawn(executable, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9233',
    `--user-data-dir=${profile}`, '--window-size=1800,1400', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })

  await until('Chrome', async () => (await fetch(`${debugUrl}/json/version`)).ok)
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json()
  client = new Cdp(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Page.navigate', { url: pageUrl })

  const snapshot = () => client.evaluate('window.__PROJECTC_THERMAL_CLOCK__?.snapshot()')
  const initial = await until('Thermal Clock API', snapshot)
  assert(initial.dynamicsMode === 'oscillator', 'Legacy Oscillator must remain the default A/B baseline')

  assert(await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setMode('inertial'); true"), 'Could not request Inertial mode')
  const inertial = await until('Inertial mode', async () => {
    const state = await snapshot()
    return state?.dynamicsMode === 'inertial' && state
  })
  assert(inertial.solver === 'piecewise-analytic-inertial-relaxation-v1', 'Inertial solver marker missing')
  assert(Math.abs(inertial.inertialConfig.driftHalfLifeAt - 1) < 1e-9, 'Drift Half-Life baseline must be 1AT')
  assert(Math.abs(inertial.inertialConfig.recoveryHalfLifeAt - 3) < 1e-9, 'Recovery Half-Life baseline must be 3AT')

  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setAction('heat-ii')")
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setDeposit(0,0.5)")
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setDriveDurationAt(1)")
  const fullDrive = await until('Full Drive preview', async () => {
    const state = await snapshot()
    return state?.selectedAction === 'heat-ii' && state.driveDurationAt === 1 && state
  })
  assert(fullDrive.predictedReady.temperature > fullDrive.state.temperature, '1AT Hotward Drive did not raise next-Ready T')
  assert(fullDrive.predictedReady.drift > fullDrive.state.drift, '1AT Hotward Drive did not create residual Drift')

  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setDriveDurationAt(0.5)")
  const halfDrive = await until('Half Drive preview', async () => {
    const state = await snapshot()
    return Math.abs(state?.driveDurationAt - 0.5) < 1e-9 && state
  })
  assert(halfDrive.predictedReady.temperature < fullDrive.predictedReady.temperature, '0.5AT Drive should affect T less than 1AT Drive')
  assert(halfDrive.predictedReady.drift < fullDrive.predictedReady.drift, '0.5AT Drive should leave less residual Drift than 1AT Drive')

  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setAction('skip')")
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setDeposit(0,0.5)")
  const noDeposit = await until('No Deposit preview', async () => {
    const state = await snapshot()
    return state?.selectedAction === 'skip' && Math.abs(state.deposit) < 1e-9 && state
  })
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setDeposit(1,0.5)")
  const withDeposit = await until('Deposit preview', async () => {
    const state = await snapshot()
    return Math.abs(state?.deposit - 1) < 1e-9 && state
  })
  assert(withDeposit.predictedReady.temperature > noDeposit.predictedReady.temperature, 'Deposit did not increase T')
  assert(Math.abs(withDeposit.predictedReady.drift - noDeposit.predictedReady.drift) < 1e-7, 'Deposit must not modify Drift D')

  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setDeposit(0,0.5)")
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setAction('heat-ii')")
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setDriveDurationAt(1)")
  const beforeCommit = await until('Commit preview ready', async () => {
    const state = await snapshot()
    return state?.selectedAction === 'heat-ii' && state.driveDurationAt === 1 && Math.abs(state.deposit) < 1e-9 && state
  })
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.commit()")
  await until('Inertial playback started', async () => (await snapshot())?.playback)
  const committed = await until('Inertial Ready', async () => {
    const state = await snapshot()
    return !state?.playback && state.state.worldAt === beforeCommit.state.worldAt + 1 && state
  })
  assert(closeState(committed.state, beforeCommit.predictedReady, 1e-5), 'Inertial Preview != Commit')

  const numericBeforeSwitch = committed.state
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setMode('oscillator')")
  const legacyAgain = await until('Legacy A/B switch', async () => {
    const state = await snapshot()
    return state?.dynamicsMode === 'oscillator' && state
  })
  assert(closeState(legacyAgain.state, numericBeforeSwitch), 'Mode switch must preserve numeric T/D/S')
  assert(legacyAgain.state.worldAt === numericBeforeSwitch.worldAt, 'Mode switch advanced worldAt')

  // Shared-profile integration: publish Inertial from Thermal Clock, then enter
  // Gameplay in the same app session. Gameplay must consume the exact mode and
  // HD / HR values rather than reconstructing another thermal model.
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setMode('inertial')")
  await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.setInertialConfig({driftHalfLifeAt:0.75,recoveryHalfLifeAt:2.5})")
  const publishable = await until('publishable Inertial profile', async () => {
    const state = await snapshot()
    return state?.dynamicsMode === 'inertial'
      && Math.abs(state.inertialConfig.driftHalfLifeAt - 0.75) < 1e-9
      && Math.abs(state.inertialConfig.recoveryHalfLifeAt - 2.5) < 1e-9
      ? state : false
  })
  assert(await client.evaluate("window.__PROJECTC_THERMAL_CLOCK__.applyLive()"), 'Thermal Clock Apply Live rejected Inertial mode')
  const published = await until('Inertial Live profile', async () => {
    const state = await snapshot()
    return state?.liveProfile?.dynamicsMode === 'inertial'
      && Math.abs(state.liveProfile.inertial.driftHalfLifeAt - 0.75) < 1e-9
      && state
  })
  assert(published.liveProfile.revision > initial.liveProfile.revision, 'Apply Live did not advance shared profile revision')

  await client.evaluate("window.location.hash='#gameplay-lab'")
  const gameplaySnapshot = () => client.evaluate('window.__PROJECTC_GAMEPLAY_LAB__?.snapshot()')
  const gameplay = await until('Gameplay consumed Inertial Live profile', async () => {
    const state = await gameplaySnapshot()
    return state?.dynamicsMode === 'inertial'
      && state?.thermalAuthority === 'piecewise-analytic-inertial-relaxation-v1'
      && Math.abs(state.inertialConfig.driftHalfLifeAt - 0.75) < 1e-9
      && Math.abs(state.inertialConfig.recoveryHalfLifeAt - 2.5) < 1e-9
      ? state : false
  })

  assert(await client.evaluate("window.__PROJECTC_GAMEPLAY_LAB__.playAction('brace')"), 'Gameplay Inertial Brace could not start')
  const gameplayDrive = await until('Gameplay Thermal Drive playback', async () => {
    const state = await gameplaySnapshot()
    return !state?.ready
      && state.events.some((event) => event.type === 'ThermalDriveStart' && event.source === 'Active D Build')
      && state.events.some((event) => event.type === 'ThermalDriveEnd' && event.source === 'Active D Build')
      ? state : false
  })
  const gameplayDriveEnd = await until('Gameplay Inertial Brace Ready', async () => {
    const state = await gameplaySnapshot()
    return state?.ready && state.worldAt === gameplay.worldAt + 1 ? state : false
  })
  assert(gameplayDriveEnd.thermal.drift < gameplay.thermal.drift, 'Gameplay Inertial Brace did not create Coldward residual Drift')

  assert(await client.evaluate(`window.__PROJECTC_GAMEPLAY_LAB__.loadDebugScenario(${JSON.stringify({
    player: { id: 'player', hex: { q: 0, r: 0 }, hp: 100, downM: 2, downPrepared: true },
    enemies: [{ id: 'enemy-a', hex: { q: 1, r: 0 }, hp: 40, downM: 1, downPrepared: true, intent: 'skip', intentIndex: 0 }],
    thermal: { temperature: 1, drift: 0, setPoint: 1, worldAt: 0 },
    worldAt: 0,
    selectedActionId: 'release',
  })})`), 'Gameplay Deposit fixture rejected')
  await until('Gameplay Deposit fixture', async () => {
    const state = await gameplaySnapshot()
    return state?.ready && state.worldAt === 0 && state.player.downM === 2 ? state : false
  })
  assert(await client.evaluate("window.__PROJECTC_GAMEPLAY_LAB__.playAction('release',{q:1,r:0})"), 'Gameplay Inertial Release could not start')
  const gameplayDeposit = await until('Gameplay Collision Deposit', async () => {
    const state = await gameplaySnapshot()
    return !state?.ready
      && state.events.some((event) => event.type === 'ThermalDeposit' && event.source === 'Collision dissipatedM')
      ? state : false
  })
  assert(gameplayDeposit.events.some((event) => event.type === 'ThermalDriveStart' && event.source === 'Active D Spend / Convert'), 'Release D Spend did not create Inertial Drive')

  assert(client.errors.length === 0, `Browser runtime exceptions: ${JSON.stringify(client.errors)}`)
  console.log('Thermal dual-mode browser regression passed: local A/B, shared Inertial Apply Live → Gameplay, Drive/Deposit semantics, and Preview==Commit.')
} finally {
  try { client?.socket.close() } catch {}
  await stop(browser)
  await stop(server)
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
