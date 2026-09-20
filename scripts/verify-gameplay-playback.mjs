import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const url = 'http://127.0.0.1:4182/ProjectC-WebPrototype/#gameplay-lab'
const debugUrl = 'http://127.0.0.1:9232'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
async function until(label, operation) {
  let error
  for (let index = 0; index < 160; index += 1) {
    try { const value = await operation(); if (value) return value } catch (cause) { error = cause }
    await sleep(50)
  }
  throw new Error(`${label}: timed out ${error?.message ?? ''}`)
}
function chromeExecutable() {
  const which = (name) => spawnSync('which', [name], { encoding: 'utf8' }).stdout?.trim()
  return [process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(which),
  ].find((path) => path && existsSync(path))
}
class Cdp {
  constructor(url) { this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); this.errors = [] }
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
let server, browser, client, temporaryProfile
const stop = async (child) => {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 3000) })
}
try {
  const executable = chromeExecutable()
  assert(executable, 'Chrome/Edge is required (or set CHROME_BIN)')
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], { stdio: 'ignore', windowsHide: true })
  await until('preview', async () => (await fetch(url)).ok)
  temporaryProfile = await mkdtemp(join(tmpdir(), 'projectc-gameplay-'))
  browser = spawn(executable, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9232', `--user-data-dir=${temporaryProfile}`,
    '--window-size=1800,1200', 'about:blank'], { stdio: 'ignore', windowsHide: true })
  await until('Chrome', async () => (await fetch(`${debugUrl}/json/version`)).ok)
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
  client = new Cdp(target.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1200, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url })
  const snapshot = () => client.evaluate('window.__PROJECTC_GAMEPLAY_LAB__?.snapshot()')
  await until('Gameplay Lab', snapshot)
  const click = async (selector) => {
    const point = await client.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const moveToCell = async (hex) => {
    await client.evaluate("document.querySelector('.cell-world-board').scrollIntoView({block:'center'})")
    const point = await client.evaluate(`document.querySelector('.cell-world-board').projectCell(${JSON.stringify(hex)})`)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    return point
  }
  const clickCell = async (hex) => {
    const point = await moveToCell(hex)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const readyAt = (at) => until(`Ready ${at}`, async () => { const s = await snapshot(); return s?.ready && s.worldAt === at && s })
  assert(!await client.evaluate("Boolean(document.querySelector('.gameplay-commit'))"), 'External Commit button must be removed')
  const initial = await snapshot()
  assert(initial.timeline === 'gameplay-at-plan-p0-candidate', 'GameplayATPlan contract missing')
  // Give slow software-rendered CI enough frames to inspect event boundaries and locked-input behavior.
  await client.evaluate(`(() => {
    const input=document.querySelector('[aria-label="Gameplay AT playback duration"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'3000');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await until('playback speed control', () => client.evaluate("document.querySelector('.cell-world-board').dataset.atVisualMs === '3000'"))
  await click('[data-gameplay-action-id="drive"].action-card')
  await moveToCell({ q: 1, r: 0 })
  const preview = await until('hover Preview', async () => { const s = await snapshot(); return s?.previewFinal && s })
  assert(preview.worldAt === 0 && preview.player.hex.q === 0, 'Hover advanced authoritative state')
  await clickCell({ q: 1, r: 0 })
  const middle = await until('mid-AT playback', async () => { const s = await snapshot(); return !s?.ready && s.progress > 0.25 && s.progress < 0.65 && s })
  assert(middle.worldAt === 0 && middle.player.hex.q === 0, 'Authoritative state committed before playback end')
  assert(middle.visual.player.position.x > 0 && middle.visual.player.position.x < middle.playbackFinal.position.x, 'Actor did not move during playback')
  assert(await client.evaluate("[...document.querySelectorAll('.action-card,.gameplay-controls-card input,.gameplay-environment-card button')].every(e=>e.matches(':disabled'))"), 'Input must be locked during playback')
  const board = await until('Board3D sampled timeline', async () => {
    const value = await client.evaluate("({...document.querySelector('.cell-world-board').dataset})")
    const state = await snapshot()
    return !state.ready && state.progress < 0.75
      && Number(value.visualX) > 0 && Number(value.visualX) < state.playbackFinal.position.x
      ? value : false
  })
  await mkdir('artifacts', { recursive: true })
  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  await writeFile('artifacts/gameplay-playback-mid.png', Buffer.from(shot.data, 'base64'))
  // Disabled buttons and extra target clicks must not create a queued second AT.
  await client.evaluate("document.querySelector('[data-gameplay-action-id=brace].action-card').click()")
  await clickCell({ q: 0, r: 1 })
  const end = await readyAt(1)
  assert(JSON.stringify(end.player) === JSON.stringify(preview.previewFinal.player), 'Preview/Commit player mismatch')
  assert(JSON.stringify(end.thermal) === JSON.stringify(preview.previewFinal.thermal), 'Preview/Commit Thermal mismatch')
  assert(JSON.stringify(end.enemies) === JSON.stringify(preview.previewFinal.enemies), 'Preview/Commit enemies mismatch')
  assert(end.historyEntries === 1, 'Repeated input caused multiple commits')
  // A second Drive reaches enemy-a. Attack, contact and forced travel have
  // different timestamps, and the target moves only after the collision.
  await clickCell({ q: 2, r: 0 })
  const encounter = await until('contact playback', async () => { const s = await snapshot(); return !s?.ready && s.progress > 0.74 && s.progress < 0.9 && s })
  assert(encounter.events.some((event) => event.type === 'AttackPayload'), 'Enemy Attack payload missing')
  assert(encounter.events.some((event) => event.type === 'ForcedMotion'), 'Collision Forced Motion missing')
  assert(encounter.visual.actors['enemy-a'].position.x > 2, 'Target not moving after contact')
  assert(encounter.enemies[0].hex.q === 2, 'Target authoritative state changed before Ready')
  const fxBoard = await client.evaluate("({...document.querySelector('.cell-world-board').dataset})")
  assert(Number(fxBoard.collisionFxEventCount) >= 3, 'Encounter-driven FX missing')
  const encounterShot = await client.send('Page.captureScreenshot', { format: 'png' })
  await writeFile('artifacts/gameplay-encounter-mid.png', Buffer.from(encounterShot.data, 'base64'))
  await readyAt(2)
  await click('[data-gameplay-action-id="brace"].action-card')
  await until('Brace immediate playback', async () => !(await snapshot()).ready)
  await readyAt(3)
  await click('[data-gameplay-action-id="skip"].action-card')
  await readyAt(4)
  await client.evaluate("[...document.querySelectorAll('.session-buttons button')].find(e=>e.textContent==='Undo').click()")
  await readyAt(3)
  await client.evaluate("[...document.querySelectorAll('.session-buttons button')].find(e=>e.textContent==='Reset').click()")
  const reset = await readyAt(0)
  assert(reset.player.hp === 100 && reset.historyEntries === 0, 'Reset failed')
  assert(client.errors.length === 0, `Browser exceptions: ${JSON.stringify(client.errors)}`)
  await writeFile('artifacts/gameplay-playback.json', JSON.stringify({ initial, middle, board, end, encounter, fxBoard, reset, browserErrors: client.errors }, null, 2))
  console.log('Gameplay P0 browser regression passed: real hover/click, frame movement, exact Preview/Commit, input lock, single commit, immediate Brace/Skip, Undo/Reset.')
} finally {
  client?.socket.close()
  await stop(browser)
  await stop(server)
  // Only this test's mkdtemp directory is eligible for recursive cleanup.
  if (temporaryProfile && dirname(resolve(temporaryProfile)) === resolve(tmpdir()) && basename(temporaryProfile).startsWith('projectc-gameplay-')) {
    await rm(temporaryProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}
