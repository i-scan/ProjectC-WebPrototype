import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const previewOrigin = 'http://127.0.0.1:4173'
const pageUrl = `${previewOrigin}/ProjectC-WebPrototype/#hex-prototype`
const debuggingOrigin = 'http://127.0.0.1:9222'
const artifactDir = resolve('artifacts')

function assert(condition, message, detail) {
  if (condition) return
  const suffix = detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

function which(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    which('google-chrome'),
    which('google-chrome-stable'),
    which('chromium'),
    which('chromium-browser'),
  ].filter(Boolean)
  assert(candidates.length > 0, 'Chrome / Chromium executable was not found')
  return candidates[0]
}

const sleep = (milliseconds) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, milliseconds)
})

async function waitFor(label, operation, attempts = 80, delay = 100) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(delay)
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`)
}

class CdpClient {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.events = new Map()
    this.socket = new WebSocket(url)
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chrome DevTools WebSocket open timed out')), 10000)
      this.socket.addEventListener('open', () => {
        clearTimeout(timeout)
        resolvePromise()
      }, { once: true })
      this.socket.addEventListener('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      }, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (payload.id) {
        const pending = this.pending.get(payload.id)
        if (!pending) return
        this.pending.delete(payload.id)
        clearTimeout(pending.timeout)
        if (payload.error) pending.reject(new Error(payload.error.message))
        else pending.resolve(payload.result)
        return
      }
      const listeners = this.events.get(payload.method)
      if (!listeners) return
      for (const listener of [...listeners]) listener(payload.params)
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Chrome DevTools ${method} timed out`))
      }, 15000)
      this.pending.set(id, { resolve: resolvePromise, reject, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  }
  return result.result.value
}

const snapshotExpression = `(() => {
  const root = document.querySelector('.hex-prototype')
  const layout = root?.querySelector('.visual-layout')
  const panel = root?.querySelector('.visual-right-panel')
  const tabs = root?.querySelector('.hex-inspector-tabs')
  const buttons = [...(tabs?.querySelectorAll(':scope > button') ?? [])]
  const coordinate = tabs?.querySelector('.hex-inspector-coordinate')
  const thermalRoot = root?.querySelector('.thermal-clock-inline-root')
  const thermalSelect = thermalRoot?.querySelector('select')
  const thermalButton = thermalRoot?.querySelector('.thermal-clock-action-grid button')
  const thermalTitle = thermalRoot?.querySelector('.thermal-clock-config-label > strong')
  const thermalValue = thermalRoot?.querySelector('.thermal-lab-state-value > strong')
  const typographySelectors = [
    '.thermal-clock-config-label > strong',
    '.thermal-clock-config-label > small',
    'select',
    '.thermal-lab-state-value > span',
    '.thermal-lab-state-value > strong',
    '.thermal-lab-section-heading span',
    '.thermal-lab-section-heading strong',
    '.thermal-clock-action-grid button > strong',
    '.thermal-clock-action-grid button > span',
    '.thermal-clock-action-grid button > small',
    '.thermal-clock-preview-steps b',
  ]
  const rect = (element) => {
    if (!element) return null
    const value = element.getBoundingClientRect()
    return {
      left: value.left,
      top: value.top,
      width: value.width,
      height: value.height,
      right: value.right,
      bottom: value.bottom,
    }
  }
  const style = (element) => element ? getComputedStyle(element) : null
  return {
    viewport: { width: innerWidth, height: innerHeight },
    rootClass: root?.className ?? null,
    layoutColumns: style(layout)?.gridTemplateColumns ?? null,
    panel: rect(panel),
    tabs: rect(tabs),
    buttons: buttons.map((button) => ({
      text: button.textContent.trim(),
      rect: rect(button),
      clientWidth: button.clientWidth,
      clientHeight: button.clientHeight,
      scrollWidth: button.scrollWidth,
      scrollHeight: button.scrollHeight,
      whiteSpace: style(button).whiteSpace,
      wordBreak: style(button).wordBreak,
      overflowWrap: style(button).overflowWrap,
      fontSize: style(button).fontSize,
      fontFamily: style(button).fontFamily,
    })),
    coordinate: coordinate ? {
      rect: rect(coordinate),
      fontSize: style(coordinate).fontSize,
      whiteSpace: style(coordinate).whiteSpace,
    } : null,
    thermal: thermalRoot ? {
      rootFontSize: style(thermalRoot).fontSize,
      rootFontFamily: style(thermalRoot).fontFamily,
      selectFontSize: style(thermalSelect).fontSize,
      selectFontFamily: style(thermalSelect).fontFamily,
      buttonFontSize: style(thermalButton).fontSize,
      buttonFontFamily: style(thermalButton).fontFamily,
      titleFontSize: style(thermalTitle).fontSize,
      valueFontSize: style(thermalValue).fontSize,
      typography: typographySelectors.map((selector) => {
        const element = thermalRoot.querySelector(selector)
        return {
          selector,
          fontSize: element ? style(element).fontSize : null,
        }
      }),
    } : null,
  }
})()`

function verifyTabs(snapshot, label) {
  assert(snapshot.buttons.length === 2, `${label}: expected two inspector tab buttons`, snapshot)
  const [hexButton, thermalButton] = snapshot.buttons
  assert(Math.abs(hexButton.rect.top - thermalButton.rect.top) <= 1, `${label}: tab buttons are not on the same row`, snapshot)
  assert(Math.abs(hexButton.rect.height - thermalButton.rect.height) <= 1, `${label}: tab buttons have different heights`, snapshot)
  for (const button of snapshot.buttons) {
    assert(button.whiteSpace === 'nowrap', `${label}: ${button.text} is allowed to wrap`, snapshot)
    assert(button.scrollHeight <= button.clientHeight + 1, `${label}: ${button.text} rendered on multiple lines`, snapshot)
  }
  assert(snapshot.coordinate, `${label}: coordinate readout is missing`, snapshot)
  assert(Math.abs(snapshot.coordinate.rect.top - hexButton.rect.top) <= 2, `${label}: coordinate readout wrapped onto another row`, snapshot)
}

function firstFamily(value) {
  return String(value).split(',')[0].replaceAll('"', '').trim().toLowerCase()
}

function verifyThermal(snapshot, label) {
  assert(snapshot.thermal, `${label}: Thermal inspector content was not rendered`, snapshot)
  const thermal = snapshot.thermal
  assert(thermal.rootFontSize === '10px', `${label}: Thermal root font size is not 10px`, snapshot)
  assert(thermal.selectFontSize === '10px', `${label}: Thermal select font size is not 10px`, snapshot)
  assert(thermal.buttonFontSize === '10px', `${label}: Thermal action control font size is not 10px`, snapshot)
  assert(thermal.titleFontSize === '10px', `${label}: Thermal title font size is not 10px`, snapshot)
  assert(thermal.valueFontSize === '12px' || thermal.valueFontSize === '14px', `${label}: Thermal value font scale is unexpected`, snapshot)
  const rootFamily = firstFamily(thermal.rootFontFamily)
  assert(firstFamily(thermal.selectFontFamily) === rootFamily, `${label}: Thermal select uses another font family`, snapshot)
  assert(firstFamily(thermal.buttonFontFamily) === rootFamily, `${label}: Thermal action uses another font family`, snapshot)

  const fontSizes = thermal.typography
    .map((entry) => Number.parseFloat(entry.fontSize))
    .filter(Number.isFinite)
  assert(fontSizes.length >= 8, `${label}: Thermal typography sample is incomplete`, snapshot)
  assert(Math.min(...fontSizes) >= 8, `${label}: Thermal typography contains text smaller than 8px`, snapshot)
  assert(Math.max(...fontSizes) <= 14, `${label}: Thermal typography contains text larger than 14px`, snapshot)
  assert(new Set(fontSizes).size <= 5, `${label}: Thermal typography uses too many unrelated sizes`, snapshot)
}

const actionChainSnapshotExpression = `(() => {
  const root = document.querySelector('.hex-prototype')
  const driveEast = root?.querySelector('[data-action-id="drive"][data-axis="E"]')
  const chainedRush = root?.querySelector('[data-action-id="rush-strike"][data-chain-compatible="true"]')
  const board = root?.querySelector('.hex-board-frame')
  const playbackControl = root?.querySelector('[data-at-playback-control="v1"]')
  const playbackInput = playbackControl?.querySelector('input[type="range"]')
  const objectives = [...(root?.querySelectorAll('.visual-objectives > div') ?? [])]
  const boardRect = board?.getBoundingClientRect()
  return {
    rulesetId: root?.dataset.rulesetId ?? null,
    implementationId: root?.dataset.implementationId ?? null,
    worldTimeAt: Number(root?.dataset.worldTimeAt ?? Number.NaN),
    chainOpen: root?.dataset.chainOpen === 'true',
    boardHeight: boardRect?.height ?? 0,
    driveEastEnabled: Boolean(driveEast && !driveEast.disabled),
    playback: playbackInput ? {
      min: playbackInput.min,
      max: playbackInput.max,
      step: playbackInput.step,
      value: playbackInput.value,
      text: playbackControl.textContent.trim(),
    } : null,
    chainWindowText: root?.querySelector('.ut2-chain-window')?.textContent.trim() ?? null,
    chainedRush: chainedRush ? {
      enabled: !chainedRush.disabled,
      target: chainedRush.dataset.targetActor,
      axis: chainedRush.dataset.axis,
      text: chainedRush.textContent.trim(),
    } : null,
    objectives: objectives.map((entry) => ({
      text: entry.textContent.trim(),
      done: entry.classList.contains('done'),
    })),
  }
})()`

async function verifyActionChain(client) {
  await evaluate(client, `document.querySelector('#hex-inspector-tab').click(); true`)
  const initial = await evaluate(client, actionChainSnapshotExpression)
  assert(initial.rulesetId === 'VAL-012-UT2', 'UT2 ruleset marker is missing', initial)
  assert(initial.implementationId === 'action-chain-phase-v1', 'UT2 implementation marker is missing', initial)
  assert(initial.worldTimeAt === 0, 'UT2 fixed scenario did not start at world time 0', initial)
  assert(initial.boardHeight >= 300, 'Hex board collapsed below its playable height', initial)
  assert(initial.driveEastEnabled, 'Fixed scenario must allow Drive on the E axis', initial)
  assert(initial.playback?.min === '0' && initial.playback?.max === '4', 'AT playback range is incorrect', initial)
  assert(initial.playback?.step === '0.25', 'AT playback must use quarter-rate steps', initial)
  assert(initial.playback?.value === '1', 'AT playback baseline must start at 1x', initial)
  assert(initial.playback?.text.includes('680 ms/AT'), 'AT playback duration is not visible', initial)

  await evaluate(client, `document.querySelector('[data-action-id="drive"][data-axis="E"]').click(); true`)
  await waitFor('Drive chain window', async () => {
    const ready = await evaluate(client, `(() => {
      const root = document.querySelector('.hex-prototype')
      const rush = root?.querySelector('[data-action-id="rush-strike"][data-chain-compatible="true"]')
      return root?.dataset.chainOpen === 'true' && Boolean(rush && !rush.disabled)
    })()`)
    if (!ready) throw new Error('Chain Window or chained Rush Strike is not ready')
    return true
  })

  const afterDrive = await evaluate(client, actionChainSnapshotExpression)
  assert(afterDrive.worldTimeAt === 2, 'Drive must consume two phased AT', afterDrive)
  assert(afterDrive.chainOpen, 'Drive Outro must open a Chain Window', afterDrive)
  assert(afterDrive.chainWindowText?.includes('Pending Momentum 2'), 'Pending Momentum 2 is not visible', afterDrive)
  assert(afterDrive.chainWindowText?.includes('AT2 → AT1'), 'Rush Strike chain discount is not visible', afterDrive)
  assert(afterDrive.chainedRush?.target === 'hunter', 'Fixed target is not chain-compatible after Drive', afterDrive)
  assert(afterDrive.chainedRush?.axis === 'E', 'Rush Strike chain axis is not preserved', afterDrive)
  assert(afterDrive.chainedRush?.text.includes('Chain AT1'), 'Chained Rush Strike does not show AT1', afterDrive)

  await evaluate(client, `document.querySelector('[data-action-id="rush-strike"][data-chain-compatible="true"]').click(); true`)
  await waitFor('Rush Strike completion', async () => {
    const complete = await evaluate(client, `(() => {
      const root = document.querySelector('.hex-prototype')
      const hunter = root?.querySelector('[data-action-id="rush-strike"][data-target-actor="hunter"]')
      return root?.dataset.chainOpen === 'false' && root?.dataset.worldTimeAt === '3' && Boolean(hunter && !hunter.disabled)
    })()`)
    if (!complete) throw new Error('Rush Strike has not completed at world time 3')
    return true
  })

  const afterRush = await evaluate(client, actionChainSnapshotExpression)
  assert(afterRush.worldTimeAt === 3, 'Same-axis Rush Strike must consume one AT', afterRush)
  assert(!afterRush.chainOpen, 'Rush Strike must consume Pending Momentum and close the chain', afterRush)
  assert(afterRush.objectives.some((entry) => entry.done && entry.text.includes('Rush Strike')), 'Rush Strike objective did not complete', afterRush)
  return { initial, afterDrive, afterRush }
}

async function loadViewport(client, width) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const viewportUrl = `${previewOrigin}/ProjectC-WebPrototype/?viewport=${width}#hex-prototype`
  await client.send('Page.navigate', { url: viewportUrl })
  await waitFor(`Hex prototype at ${width}px`, async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.hex-prototype .hex-inspector-tabs'))`)
    if (!ready) throw new Error('inspector tabs not mounted')
    const contract = await evaluate(client, `Boolean(document.querySelector('style[data-inspector-layout-contract="runtime-v3"]'))`)
    if (!contract) throw new Error('runtime inspector contract not mounted')
    return true
  })

  await evaluate(client, `document.querySelector('#hex-inspector-tab').click(); true`)
  await waitFor(`Hex tab reset at ${width}px`, async () => {
    const active = await evaluate(client, `document.querySelector('.hex-prototype')?.classList.contains('inspector-hex')`)
    if (!active) throw new Error('hex root class not active')
    return true
  })
  await sleep(250)

  const hexSnapshot = await evaluate(client, snapshotExpression)
  verifyTabs(hexSnapshot, `${width}px Hex`)

  await evaluate(client, `document.querySelector('#thermal-inspector-tab').click(); true`)
  await waitFor(`Thermal tab at ${width}px`, async () => {
    const active = await evaluate(client, `document.querySelector('.hex-prototype')?.classList.contains('inspector-thermal')`)
    if (!active) throw new Error('thermal root class not active')
    const content = await evaluate(client, `Boolean(document.querySelector('.thermal-clock-inline-root select'))`)
    if (!content) throw new Error('thermal content not mounted')
    return true
  })
  await sleep(300)

  const thermalSnapshot = await evaluate(client, snapshotExpression)
  verifyTabs(thermalSnapshot, `${width}px Thermal`)
  verifyThermal(thermalSnapshot, `${width}px Thermal`)

  const expectedPanelWidth = width === 1920 ? 460 : 430
  assert(
    Math.abs(hexSnapshot.panel.width - expectedPanelWidth) <= 1,
    `${width}px: Hex inspector width is not ${expectedPanelWidth}px`,
    { hexSnapshot, thermalSnapshot },
  )
  assert(
    Math.abs(thermalSnapshot.panel.width - expectedPanelWidth) <= 1,
    `${width}px: Thermal inspector width is not ${expectedPanelWidth}px`,
    { hexSnapshot, thermalSnapshot },
  )
  assert(
    Math.abs(thermalSnapshot.panel.width - hexSnapshot.panel.width) <= 1,
    `${width}px: inspector width changes when switching tabs`,
    { hexSnapshot, thermalSnapshot },
  )

  return { hex: hexSnapshot, thermal: thermalSnapshot }
}

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  previewProcess.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
  previewProcess.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))

  await waitFor('Vite preview', async () => {
    const response = await fetch(pageUrl, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  })

  const userDataDir = join(tmpdir(), `projectc-chrome-${process.pid}`)
  chromeProcess = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1920,1080',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => process.stderr.write(`[chrome] ${chunk}`))

  const version = await waitFor('Chrome DevTools', async () => {
    const response = await fetch(`${debuggingOrigin}/json/version`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })

  const targetResponse = await fetch(`${debuggingOrigin}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
  assert(targetResponse.ok, 'Failed to create Chrome inspection target')
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')

  const results = {}
  for (const width of [1920, 1366]) {
    results[width] = await loadViewport(client, width)
    if (width === 1920) results.actionChain = await verifyActionChain(client)
  }

  await mkdir(artifactDir, { recursive: true })
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  await writeFile(join(artifactDir, 'inspector-layout.png'), Buffer.from(screenshot.data, 'base64'))
  await writeFile(join(artifactDir, 'inspector-layout.json'), `${JSON.stringify(results, null, 2)}\n`)

  console.log('Browser inspector layout verified at 1920px and 1366px.')
  console.log(JSON.stringify({
    desktop: {
      hexWidth: results[1920].hex.panel.width,
      thermalWidth: results[1920].thermal.panel.width,
    },
    laptop: {
      hexWidth: results[1366].hex.panel.width,
      thermalWidth: results[1366].thermal.panel.width,
    },
    thermalType: results[1920].thermal.thermal,
    actionChain: {
      afterDriveAt: results.actionChain.afterDrive.worldTimeAt,
      afterRushAt: results.actionChain.afterRush.worldTimeAt,
      axis: results.actionChain.afterDrive.chainedRush.axis,
    },
  }, null, 2))
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
