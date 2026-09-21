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
  const boardRebuildsBeforePlayback = Number(await client.evaluate("document.querySelector('.cell-world-board').dataset.boardRebuildCount || '0'"))
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
  assert(Number(board.boardRebuildCount) === boardRebuildsBeforePlayback, 'Board3D rebuilt during playback; array prop identity regression')
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
  // Browser-level authority proof: load a deterministic H3/E state next to the
  // same world wall used by Trajectory Lab. Gameplay must expose the Trajectory
  // reflection event and adopt its M / Axis settlement rather than an old local path.
  assert(await client.evaluate(`window.__PROJECTC_GAMEPLAY_LAB__.loadDebugScenario(${JSON.stringify({
    player: { id: 'player', hex: { q: 2, r: 0 }, hp: 100, hM: 3, axisId: 'E' },
    enemies: [],
    worldAt: 0,
    selectedActionId: 'move',
  })})`), 'Reflection fixture rejected')
  await until('reflection fixture', async () => { const s = await snapshot(); return s?.ready && s.worldAt === 0 && s.player.hex.q === 2 && s.player.hM === 3 && s })
  await moveToCell({ q: 3, r: 0 })
  const reflectionPreview = await until('Trajectory reflection preview', async () => {
    const state = await snapshot()
    return state?.previewFinal && state.events?.some((event) => event.type === 'SurfaceReflection') ? state : false
  })
  assert(reflectionPreview.spatialAuthority === 'val-012-process-steering-ab-v1-candidate', 'Gameplay did not use Trajectory runtime authority')
  await clickCell({ q: 3, r: 0 })
  const reflectionMid = await until('reflection playback', async () => {
    const state = await snapshot()
    return !state?.ready && state.progress > 0.25 && state.progress < 0.85
      && state.events.some((event) => event.type === 'SurfaceReflection') ? state : false
  })
  const reflectionFx = await client.evaluate("({...document.querySelector('.cell-world-board').dataset})")
  assert(Number(reflectionFx.collisionFxEventCount) >= 1, 'Trajectory reflection FX missing in Gameplay')
  const reflectionEnd = await readyAt(1)
  assert(reflectionEnd.player.hM === 2, 'Trajectory M3→M2 settlement missing after reflected Move')
  assert(reflectionEnd.player.axisId !== 'E', 'Trajectory reflected Axis was not adopted by Gameplay')

  // Exact manual-regression fixture: HM3 strikes a stationary M0 target.
  // This is deliberately the same passive-target contract used by Trajectory
  // Lab; enemy simultaneous initiative belongs to the separate Encounter layer.
  assert(await client.evaluate("window.__PROJECTC_GAMEPLAY_LAB__.setWalls(false)"), 'Could not disable walls for HM3/M0 fixture')
  await until('walls disabled', async () => (await snapshot())?.wallsEnabled === false && await snapshot())
  assert(await client.evaluate(`window.__PROJECTC_GAMEPLAY_LAB__.loadDebugScenario(${JSON.stringify({
    player: { id: 'player', hex: { q: 0, r: 0 }, hp: 100, hM: 3, axisId: 'E' },
    enemies: [{ id: 'enemy-a', hex: { q: 1, r: 0 }, hp: 40, hM: 0, axisId: null, intent: 'skip', intentIndex: 0 }],
    worldAt: 0,
    selectedActionId: 'move',
  })})`), 'HM3/M0 strike fixture rejected')
  await until('HM3/M0 fixture', async () => {
    const state = await snapshot()
    return state?.ready && state.worldAt === 0 && state.player.hM === 3
      && state.enemies?.[0]?.hex?.q === 1 && state.enemies?.[0]?.hM === 0 && state
  })
  await moveToCell({ q: 3, r: 0 })
  const encounterPreview = await until('HM3/M0 Trajectory contact preview', async () => {
    const state = await snapshot()
    return state?.spatialPreviewFinal?.player?.hex?.q === 1
      && state.previewCellConflict?.targetActorId === 'enemy-a'
      ? state : false
  })
  await clickCell({ q: 3, r: 0 })
  const encounter = await until('HM3/M0 strike playback', async () => {
    const state = await snapshot()
    return !state?.ready
      && state.events.some((event) => event.type === 'Encounter' && event.kind === 'TrajectoryStrike')
      && state.events.some((event) => event.type === 'ForcedMotion' && event.actorId === 'enemy-a') ? state : false
  })
  assert(encounter.events.some((event) => event.type === 'MomentumTransfer' && event.actorId === 'player'), 'Trajectory Strike transfer missing')
  assert(encounter.player.hex.q === 0 && encounter.enemies[0].hex.q === 1, 'Authoritative Ready state mutated during playback')
  const fxBoard = await client.evaluate("({...document.querySelector('.cell-world-board').dataset})")
  assert(Number(fxBoard.collisionFxEventCount) >= 2, 'Encounter-driven FX missing')
  const encounterShot = await client.send('Page.captureScreenshot', { format: 'png' })
  await writeFile('artifacts/gameplay-encounter-mid.png', Buffer.from(encounterShot.data, 'base64'))
  const encounterEnd = await readyAt(1)
  assert(JSON.stringify(encounterEnd.player) === JSON.stringify(encounterPreview.previewFinal.player), 'HM3 Strike Preview/Commit player mismatch')
  assert(JSON.stringify(encounterEnd.enemies) === JSON.stringify(encounterPreview.previewFinal.enemies), 'HM3 Strike Preview/Commit enemy mismatch')
  assert(encounterEnd.player.hex.q === 1 && encounterEnd.player.hM === 0, 'HM3 source did not settle into collision Cell as M0')
  assert(encounterEnd.enemies[0].hex.q > 1, 'M0 target was not displaced by HM3')

  // Contact + forced wall reflection must use the same Trajectory contact
  // resolver and must never snap the target back to its Ready Cell.
  assert(await client.evaluate("window.__PROJECTC_GAMEPLAY_LAB__.setWalls(true)"), 'Could not enable walls for forced reflection fixture')
  await until('walls enabled for forced reflection', async () => (await snapshot())?.wallsEnabled === true && await snapshot())
  assert(await client.evaluate(`window.__PROJECTC_GAMEPLAY_LAB__.loadDebugScenario(${JSON.stringify({
    player: { id: 'player', hex: { q: -2, r: 0 }, hp: 100, hM: 3, axisId: 'E' },
    enemies: [{ id: 'enemy-a', hex: { q: 0, r: 0 }, hp: 40, hM: 0, axisId: null, intent: 'skip', intentIndex: 0 }],
    worldAt: 0,
    selectedActionId: 'move',
  })})`), 'Forced reflection fixture rejected')
  await until('forced reflection fixture', async () => {
    const state = await snapshot()
    return state?.ready && state.player.hex.q === -2 && state.enemies?.[0]?.hex.q === 0 && state
  })
  await moveToCell({ q: 1, r: 0 })
  const forcedReflectionPreview = await until('forced reflection preview', async () => {
    const state = await snapshot()
    return state?.previewFinal
      && state.events.some((event) => event.type === 'Encounter' && event.kind === 'TrajectoryStrike')
      && state.events.some((event) => event.type === 'SurfaceReflection' && event.actorId === 'enemy-a')
      ? state : false
  })
  await clickCell({ q: 1, r: 0 })
  const forcedReflectionMid = await until('forced reflection playback', async () => {
    const state = await snapshot()
    return !state?.ready
      && state.events.some((event) => event.type === 'ForcedMotion' && event.actorId === 'enemy-a')
      && state.events.some((event) => event.type === 'SurfaceReflection' && event.actorId === 'enemy-a')
      ? state : false
  })
  const forcedReflectionEnd = await readyAt(1)
  assert(JSON.stringify(forcedReflectionEnd.player) === JSON.stringify(forcedReflectionPreview.previewFinal.player), 'Forced reflection Preview/Commit player mismatch')
  assert(JSON.stringify(forcedReflectionEnd.enemies) === JSON.stringify(forcedReflectionPreview.previewFinal.enemies), 'Forced reflection Preview/Commit enemy mismatch')
  assert(forcedReflectionEnd.enemies[0].hex.q !== 0 || forcedReflectionEnd.enemies[0].hex.r !== 0, 'Forced reflection target snapped back to Ready Cell')

  await click('[data-gameplay-action-id="brace"].action-card')
  await until('Brace immediate playback', async () => !(await snapshot()).ready)
  await readyAt(2)
  await click('[data-gameplay-action-id="skip"].action-card')
  await readyAt(3)
  await client.evaluate("[...document.querySelectorAll('.session-buttons button')].find(e=>e.textContent==='Undo').click()")
  await readyAt(2)
  await client.evaluate("[...document.querySelectorAll('.session-buttons button')].find(e=>e.textContent==='Reset').click()")
  const reset = await readyAt(0)
  assert(reset.player.hp === 100 && reset.historyEntries === 0, 'Reset failed')
  assert(client.errors.length === 0, `Browser exceptions: ${JSON.stringify(client.errors)}`)
  await writeFile('artifacts/gameplay-playback.json', JSON.stringify({ initial, middle, board, end, reflectionPreview, reflectionMid, reflectionFx, reflectionEnd, encounter, encounterEnd, forcedReflectionPreview, forcedReflectionMid, forcedReflectionEnd, fxBoard, reset, browserErrors: client.errors }, null, 2))
  console.log('Gameplay browser regression passed: shared Trajectory path/contact/forced-reflection authority, shared Thermal runtime, real playback, input lock, Undo/Reset.')
} finally {
  client?.socket.close()
  await stop(browser)
  await stop(server)
  // Only this test's mkdtemp directory is eligible for recursive cleanup.
  if (temporaryProfile && dirname(resolve(temporaryProfile)) === resolve(tmpdir()) && basename(temporaryProfile).startsWith('projectc-gameplay-')) {
    await rm(temporaryProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}
