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
      this.socket.addEventListener('open', resolvePromise, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (payload.id) {
        const pending = this.pending.get(payload.id)
        if (!pending) return
        this.pending.delete(payload.id)
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
      this.pending.set(id, { resolve: resolvePromise, reject })
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
  assert(thermal.rootFontSize === '12px', `${label}: Thermal root font size is not 12px`, snapshot)
  assert(thermal.selectFontSize === '11px', `${label}: Thermal select font size is not 11px`, snapshot)
  assert(thermal.buttonFontSize === '11px', `${label}: Thermal action font size is not 11px`, snapshot)
  assert(thermal.titleFontSize === '13px', `${label}: Thermal title font size is not 13px`, snapshot)
  assert(thermal.valueFontSize === '16px' || thermal.valueFontSize === '20px', `${label}: Thermal value font scale is unexpected`, snapshot)
  const rootFamily = firstFamily(thermal.rootFontFamily)
  assert(firstFamily(thermal.selectFontFamily) === rootFamily, `${label}: Thermal select uses another font family`, snapshot)
  assert(firstFamily(thermal.buttonFontFamily) === rootFamily, `${label}: Thermal action uses another font family`, snapshot)
}

async function loadViewport(client, width) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await client.send('Page.navigate', { url: pageUrl })
  await waitFor(`Hex prototype at ${width}px`, async () => {
    const ready = await evaluate(client, `Boolean(document.querySelector('.hex-prototype .hex-inspector-tabs'))`)
    if (!ready) throw new Error('inspector tabs not mounted')
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
  assert(
    thermalSnapshot.panel.width >= hexSnapshot.panel.width + 140,
    `${width}px: Thermal inspector did not become meaningfully wider than Hex inspector`,
    { hexSnapshot, thermalSnapshot },
  )

  return { hex: hexSnapshot, thermal: thermalSnapshot }
}

let previewProcess
let chromeProcess
let client

try {
  previewProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
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
  }, null, 2))
} finally {
  client?.close()
  chromeProcess?.kill('SIGTERM')
  previewProcess?.kill('SIGTERM')
}
