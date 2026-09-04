import { spawn, spawnSync } from 'node:child_process'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/#trajectory-lab'
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

async function waitForPreview(attempts = 160) {
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
    '--window-size=1600,1100', '--virtual-time-budget=900', '--dump-dom', pageUrl,
  ], { encoding: 'utf8', timeout: 30000 })

  assert(result.status === 0, `Chrome Trajectory smoke failed: ${result.stderr || result.stdout}`)
  const dom = result.stdout
  assert(dom.includes('data-implementation="val-012-process-steering-ab-v1-candidate"'), 'Trajectory implementation marker missing')
  assert(dom.includes('Trajectory Lab'), 'Trajectory Lab title/tab missing')
  assert(dom.includes('data-trajectory-ready="action-complete-ready-v1"'), 'Action-complete Ready rule marker missing')
  assert(dom.includes('data-trajectory-steering="max-60deg-per-action-v1"'), '60deg/Action steering marker missing')
  assert(dom.includes('data-trajectory-dissipation="persistent-start-m-minus-1-v1"'), 'Passive Dissipation marker missing')
  assert(dom.includes('data-cell-authority="ready-cell-center-v1"'), 'Cell-authoritative Ready marker missing')
  assert(dom.includes('data-trajectory-path="canonical-turn-timing-path-v3"'), 'Cell-center anchored authority curve marker missing')
  assert(dom.includes('data-trajectory-preview="canonical-result-corridor-curve-v3"'), 'Visited-Cell corridor preview marker missing')
  assert(dom.includes('data-spatial-mode="discrete"'), 'Trajectory Lab must expose discrete Hex6 authority')
  assert(dom.includes('data-steer-input="direct-cell-click"'), 'Direct Cell-click Steering marker missing')
  assert(dom.includes('data-trajectory-action="steer"'), 'Move / Steer action missing')
  assert(dom.includes('data-trajectory-action="drive"'), 'Drive action missing')
  assert(dom.includes('data-trajectory-action="heavy-drive"'), 'Heavy Drive action missing')
  assert(dom.includes('data-trajectory-action="skip"'), 'Skip action missing')
  assert(dom.includes('data-action-layout="driving-row"'), 'Trajectory action cards must use compact Driving Lab row layout')
  assert(!dom.includes('Steering Response'), 'Obsolete response-shape UI must not remain visible')
  assert(!dom.includes('data-trajectory-action="coast"'), 'Coast must remain Skip state semantics, not a separate card')
  assert(dom.includes('<dt>M0 Move</dt><dd>free Hex6</dd>'), 'M0 free Hex6 Move authority missing')
  assert(dom.includes('Blue may miss intermediate centers but never enters an unvisited Cell'), 'Relaxed safe-corridor preview legend missing')
  assert(dom.includes('Preview ends near final Cell center, biased toward Ready Axis'), 'Near-center preview ending legend missing')
  assert(dom.includes('data-control-model="reachable-shape"') && dom.includes('data-control-model="process-steering"'), 'Reachable Shape / Process Steering A/B controls missing')
  assert(dom.includes('data-trajectory-board-radius'), 'Trajectory board radius control missing')
  assert(dom.includes('data-motion-freeze="m2"'), 'Default M2 motion-state marker missing')
  assert(dom.includes('data-axis-style="actor-body-screen-arrow-v5"'), 'Board3D Axis HUD did not mount')

  console.log('Trajectory Lab browser smoke verified: first-segment inertia, center-anchored steering curve, free M0 Move, Drive/Heavy Drive and Skip are mounted.')
} finally {
  if (previewProcess && !previewProcess.killed) previewProcess.kill('SIGTERM')
}
