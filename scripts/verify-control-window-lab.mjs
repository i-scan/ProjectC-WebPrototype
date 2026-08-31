import { spawn, spawnSync } from 'node:child_process'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/#control-window-lab'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const which = (command) => {
  const result = spawnSync('which', [command], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function chromeExecutable() {
  const executable = [
    process.env.CHROME_BIN,
    which('google-chrome'),
    which('google-chrome-stable'),
    which('chromium'),
    which('chromium-browser'),
  ].find(Boolean)
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
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForPreview()

  const result = spawnSync(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,1100',
    '--dump-dom',
    pageUrl,
  ], { encoding: 'utf8', timeout: 30000 })

  assert(result.status === 0, `Chrome Control Window smoke failed: ${result.stderr || result.stdout}`)
  const dom = result.stdout
  assert(dom.includes('data-implementation="control-window-motion-commitment-v3-candidate"'), 'Control Window v3 implementation marker missing')
  assert(dom.includes('Control Window Lab'), 'Control Window Lab title/tab missing')
  assert(dom.includes('data-control-threshold="M1"'), 'Default M1 Control threshold marker missing')
  assert(dom.includes('data-cw-action="move"') && dom.includes('data-cw-action="drive"'), 'Move / Drive cards missing')
  assert(dom.includes('data-cw-action="heavy-drive"'), 'Heavy Drive card missing')
  assert(dom.includes('data-cw-action="skip"'), 'Skip card missing')
  assert(dom.includes('data-run-persistent'), 'Persistent Motion resolver control missing')
  assert(dom.includes('data-cw-enemy-count="2"'), 'Two wandering targets are not mounted')
  assert(dom.includes('data-cw-wall-count="') && !dom.includes('data-cw-wall-count="0"'), 'Authored wall obstacles are not connected')
  assert(dom.includes('data-cw-wander="on"'), 'Target wander should default ON')
  assert(dom.includes('data-cw-board-radius="6"'), 'Default board radius marker missing')
  assert(dom.includes('data-cw-board-radius-slider'), 'Board radius control missing')
  assert(dom.includes('control-window-bidirectional-strike-v2'), 'Bidirectional collision rule marker missing')
  assert(dom.includes('bidirectional collision candidate'), 'Player knockback candidate marker missing')

  console.log('Control Window Lab v3 browser smoke verified.')
} finally {
  if (previewProcess && !previewProcess.killed) previewProcess.kill('SIGTERM')
}