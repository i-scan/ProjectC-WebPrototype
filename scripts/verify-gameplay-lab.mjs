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
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await waitForPreview()

  const result = spawnSync(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--window-size=1800,1400', '--virtual-time-budget=1600', '--run-all-compositor-stages-before-draw', '--dump-dom', pageUrl,
  ], { encoding: 'utf8', timeout: 30000 })

  assert(result.status === 0, `Chrome Gameplay Lab smoke failed: ${result.stderr || result.stdout}`)
  const dom = result.stdout
  assert(dom.includes('data-implementation="gameplay-thermal-integration-v0-candidate"'), 'Gameplay Lab implementation marker missing')
  assert(dom.includes('data-shared-thermal-runtime="shared-thermal-profile-runtime-v1-candidate"'), 'Shared Thermal runtime marker missing')
  assert(dom.includes('data-profile-id="thermal-baseline-a"'), 'Active Thermal Profile id missing')
  assert(dom.includes('Gameplay Lab'), 'Gameplay Lab heading missing')
  assert(dom.includes('data-gameplay-thermal-pendulum="shared-runtime-v1"'), 'Gameplay Thermal Pendulum missing')
  assert(dom.includes('data-gameplay-profile="shared-live-v1"'), 'Gameplay shared profile panel missing')
  assert(dom.includes('data-gameplay-action-id="basic-move"'), 'Gameplay Basic Move card missing')
  assert(dom.includes('data-gameplay-action-id="heat-ii"') && dom.includes('data-thermal-action-id="heat-ii"'), 'Heat II semantic-id card missing')
  assert(dom.includes('data-gameplay-action-id="cool-ii"') && dom.includes('data-thermal-action-id="cool-ii"'), 'Cool II semantic-id card missing')
  assert(dom.includes('Gameplay Actions · Shared Thermal IDs'), 'Shared-ID card hand heading missing')
  assert(dom.includes('Environment Context'), 'Gameplay environment context missing')
  assert(dom.includes('Resolution Trace'), 'Gameplay resolution trace missing')
  assert(dom.includes('Board presentation reused from Driving Lab A'), 'Driving-style board reference missing')
  assert(dom.includes('Thermal Clock → Apply Live updates this panel'), 'Cross-lab live-profile explanation missing')

  console.log('Gameplay Lab browser smoke verified: Driving-style layout, board, Thermal Pendulum, shared semantic action IDs and live Thermal Profile panel are mounted.')
} finally {
  if (previewProcess && !previewProcess.killed) previewProcess.kill('SIGTERM')
}
