import { spawn, spawnSync } from 'node:child_process'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/#gameplay-lab'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const which = (command) => {
  const result = spawnSync('which', [command], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function chromeExecutable() {
  const executable = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].find(Boolean)
  assert(executable, 'Chrome / Chromium executable was not found')
  return executable
}

async function waitForPreview(attempts = 180) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(pageUrl)
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(40)
  }
  throw lastError ?? new Error('Vite preview did not become ready')
}

let previewProcess
try {
  previewProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await waitForPreview()

  const result = spawnSync(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--window-size=1800,1400', '--virtual-time-budget=1800', '--run-all-compositor-stages-before-draw', '--dump-dom', pageUrl,
  ], { encoding: 'utf8', timeout: 30000 })

  assert(result.status === 0, `Chrome Gameplay Lab smoke failed: ${result.stderr || result.stdout}`)
  const dom = result.stdout
  assert(dom.includes('data-implementation="gameplay-momentum-thermal-v1-candidate"'), 'Gameplay v1 implementation marker missing')
  assert(dom.includes('data-shared-thermal-runtime="shared-thermal-profile-runtime-v1-candidate"'), 'Shared Thermal runtime marker missing')
  assert(dom.includes('data-profile-id="thermal-baseline-a"'), 'Active Thermal Profile id missing')
  assert(dom.includes('data-momentum-band="NO AXIS"'), 'Initial Momentum band marker missing')
  assert(dom.includes('Gameplay × Momentum × Thermal v1'), 'Gameplay v1 heading missing')
  assert(dom.includes('data-gameplay-thermal-pendulum="shared-runtime-v1"'), 'Gameplay Thermal Pendulum missing')
  for (const actionId of ['move', 'drive', 'attack', 'brace', 'launch', 'release', 'skip']) {
    assert(dom.includes(`data-gameplay-action-id="${actionId}"`), `Gameplay action ${actionId} missing`)
  }
  assert(dom.includes('v1 Experiment Controls'), 'Gameplay experiment controls missing')
  assert(dom.includes('M-T Factor'), 'M-T Factor control missing')
  assert(dom.includes('Collision Heat'), 'Collision Heat control missing')
  assert(dom.includes('Collision Damage OFF'), 'Collision Damage toggle missing')
  assert(dom.includes('Domain Build ON'), 'Domain Natural Build toggle missing')
  assert(dom.includes('Telegraphed Enemies'), 'Telegraphed enemy panel missing')
  assert(dom.includes('Next: MOVE') && dom.includes('Next: BRACE'), 'Initial enemy intents missing')
  assert(dom.includes('data-gameplay-resolution-trace="momentum-thermal-v1"'), 'Cause-aware Resolution Trace missing')
  assert(dom.includes('HM0 Axis → No Axis → DM0 Skip chain'), 'Skip chain scope marker missing')

  console.log('Gameplay Lab browser smoke verified: Momentum v1 actions, state chain, experiment controls, telegraphed enemies and shared Thermal runtime are mounted.')
} finally {
  if (previewProcess && !previewProcess.killed) previewProcess.kill('SIGTERM')
}
