import { spawn, spawnSync } from 'node:child_process'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/#thermal-lab'
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

  assert(result.status === 0, `Chrome Thermal Clock smoke failed: ${result.stderr || result.stdout}`)
  const dom = result.stdout
  assert(dom.includes('data-implementation="thermal-clock-continuous-v0-candidate"'), 'Thermal Clock implementation marker missing')
  assert(dom.includes('data-thermal-solver="piecewise-analytic-second-order-v1"'), 'Analytic solver marker missing')
  assert(dom.includes('data-thermal-at="global-continuous-at-v1"'), 'Global AT marker missing')
  assert(dom.includes('data-thermal-preview="preview-commit-shared-solver-v1"'), 'Preview/Commit shared solver marker missing')
  assert(dom.includes('data-thermal-ghost="integer-at-analytic-ghosts-v1"'), 'Analytic integer ghost marker missing')
  assert(dom.includes('data-thermal-pendulum="temperature-relative-set-point-v2"'), 'Revised Thermal Pendulum marker missing')
  assert(dom.includes('data-thermal-zone-track="pendulum-arc-v1"'), 'Temperature zones must follow pendulum track')
  assert(dom.includes('data-thermal-pendulum-forecast="selected-action-dashed-v1"'), 'Dashed selected-action pendulum forecast missing')
  assert(dom.includes('data-thermal-timeline="history-current-selected-future-v1"'), 'Unified Thermal history/forecast timeline missing')
  assert(dom.includes('data-thermal-integer-ghosts="timeline-v1"'), 'Integer AT timeline markers missing')
  assert(dom.includes('data-thermal-past-window'), 'Past AT display window control missing')
  assert(dom.includes('data-thermal-future-window'), 'Future AT display window control missing')
  assert(dom.includes('data-thermal-parameter-guide="v1"'), 'Parameter guide missing')
  assert(dom.includes('data-thermal-period-guide="adiabatic-underdamped-v1"'), 'Adiabatic period tuning guide missing')
  assert(dom.includes('P = 2π / √(kS − cBase²/4)'), 'Adiabatic period formula missing')
  assert(dom.includes('Future = selected card now, then no more impulses.'), 'Future forecast semantics missing')
  assert(dom.includes('data-thermal-board-reserved="true"'), 'Reserved board isolation marker missing')
  assert(dom.includes('Set Point slider = <b>DEBUG / BUILD PROXY</b>'), 'Set Point debug-proxy warning missing')
  assert(dom.includes('Environment does not rewrite S'), 'Environment/Set Point separation copy missing')
  assert(dom.includes('data-thermal-card="heat-i"') && dom.includes('data-thermal-card="heat-ii"') && dom.includes('data-thermal-card="heat-iii"'), 'Heat cards missing')
  assert(dom.includes('data-thermal-card="cool-i"') && dom.includes('data-thermal-card="cool-ii"') && dom.includes('data-thermal-card="cool-iii"'), 'Cool cards missing')
  assert(dom.includes('data-thermal-card="skip"'), 'Skip card missing')
  assert(dom.includes('data-thermal-environment'), 'Environment controls missing')
  assert(dom.includes('data-thermal-dynamics'), 'Dynamics controls missing')
  assert(dom.includes('data-thermal-diagnostics'), 'Derived diagnostics missing')
  assert(dom.includes('Light Oscillation') && dom.includes('Near Critical') && dom.includes('Overdamped'), 'Dynamics regime presets missing')
  assert(dom.includes('Adiabatic') && dom.includes('Strong Cold') && dom.includes('Strong Hot'), 'Environment presets missing')
  assert(!dom.includes('1AT Projection'), 'Obsolete 1AT Projection panel is still mounted')
  assert(!dom.includes('当前热力钟摆已经恢复到 Inertia Driving Lab 左栏'), 'Obsolete Thermal placeholder is still mounted')

  console.log('Thermal Clock browser smoke verified: pendulum-track temperature zones, dashed future swing, unified history/forecast timeline, adjustable AT windows, parameter guide and all existing Thermal controls are mounted.')
} finally {
  if (previewProcess && !previewProcess.killed) previewProcess.kill('SIGTERM')
}
