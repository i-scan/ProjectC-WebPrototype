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
  assert(dom.includes('data-trajectory-path="cell-center-steering-polyline-v1"'), 'Cell-center trajectory path marker missing')
  assert(dom.includes('data-spatial-mode="discrete"'), 'Trajectory Lab must expose discrete Hex6 authority')
  assert(dom.includes('data-steer-input="direct-cell-click"'), 'Direct Cell-click Steering marker missing')
  assert(dom.includes('data-trajectory-action="steer"'), 'Move / Steer action missing')
  assert(dom.includes('data-trajectory-action="drive"'), 'Drive action missing')
  assert(dom.includes('data-trajectory-action="heavy-drive"'), 'Heavy Drive action missing')
  assert(dom.includes('data-trajectory-action="skip"'), 'Skip action missing')
  assert(!dom.includes('data-trajectory-action="coast"'), 'Coast must remain Skip state semantics, not a separate card')
  assert(dom.includes('all 6 directions'), 'M0 full Hex6 Move explanation missing')
  assert(dom.includes('Every path bend occurs at a Cell center'), 'Cell-center polyline legend missing')
  assert(dom.includes('Short terminal segment = predicted Ready Axis'), 'Preview Ready Axis terminal marker explanation missing')
  assert(dom.includes('data-control-model="reachable-shape"') && dom.includes('data-control-model="process-steering"'), 'Reachable Shape / Process Steering A/B controls missing')
  assert(dom.includes('data-response-curve="linear"') && dom.includes('data-response-curve="smoothstep"'), 'Response curve debug A/B missing')
  assert(dom.includes('data-trajectory-board-radius'), 'Trajectory board radius control missing')
  assert(dom.includes('data-motion-freeze="m2"'), 'Default M2 motion-state marker missing')
  assert(dom.includes('data-axis-style="actor-body-screen-arrow-v5"'), 'Board3D Axis HUD did not mount')

  console.log('Trajectory Lab browser smoke verified: Cell-center path, free M0 Move, Drive/Heavy Drive, Skip and direct directional input are mounted.')
} finally {
  if (previewProcess && !previewProcess.killed) previewProcess.kill('SIGTERM')
}
