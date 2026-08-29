const [pageUrlArgument, expectedCommit] = process.argv.slice(2)
if (!pageUrlArgument || !expectedCommit) throw new Error('Usage: verify-deployment <page-url> <commit>')

const baseUrl = new URL(pageUrlArgument.endsWith('/') ? pageUrlArgument : `${pageUrlArgument}/`)
const attempts = Number(process.env.DEPLOY_VERIFY_ATTEMPTS || 60)
const delayMs = Number(process.env.DEPLOY_VERIFY_DELAY_MS || 4000)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fresh(url, attempt) {
  const request = new URL(url)
  request.searchParams.set('verify', `${expectedCommit}-${attempt}-${Date.now()}`)
  const response = await fetch(request, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache', Expires: '0' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${request}`)
  return response.text()
}

const requiredMarkers = [
  'spatial-inertia-v1-candidate',
  'Spatial Inertia v1 Candidate',
  'Basic Move',
  'Hold',
  'Initiative Actions',
  'Spatial Presentation A/B',
  'Incoming Composition A/B',
  'Cell Inspector',
  'reachable-landing-cell-v1',
  'initiative-first-travel-transaction-v1',
  'val-012-spatial-inertia-v1-candidate',
  'first-successful-travel-transaction-v1',
  'drive-build-inertia-prototype-candidate-v1',
  'contact-strike-direct-transfer-v1',
  'forced-use-on-first-travel-v1',
  'incoming-momentum-composition-ab-v1',
  'true-vector',
  'hex-lookup',
  'hex-angle-lookup-prototype-candidate-v1',
  'spatial-inertia-v1-contact-resolution',
  'forced-move-cell-motion-v1',
  'clipped-cell-mirror-v2',
  'contact-ray-step-budget-v3',
  'wall-cell-pivot-budget-v1',
  'wall-cell-roundtrip-costs-one-v2',
  'cell-motion-trace-v1',
  'authoritative-cell-travel-budget-v1',
  'single-cell-entry-resolution-v1',
  'motion-trace-event-v1',
  'motion-trace-debug-bridge-v1',
  'wall-axis-mesh-v1',
  'wall-pivot-polyline-v1',
  'obstacle-wall-cell-pivot',
  'wallCellTravelCost',
  'boundary-corner-chamfer',
  'reserved-cell-stop',
  'actor-body-screen-arrow-v5',
  'actor-axis-hud',
  'unified-arrow-v1',
  'blue-dashed-no-arrow-v3',
  'cell-target-path-v3',
  'lifted-outline-v3',
  'yellow-dashed-path-v2',
  'contact-staggered-fast-v3',
  'surface-reflection',
  'Landing Cell Input',
  'M Transfer',
  'setIncomingCompositionMode',
  'data-incoming-composition-controls',
  'setAxisDisplay',
  'data-down-axis-controls',
  'actorPlaybackWindows',
  'playerPlaybackEnd',
  'data-thermal-period',
  'setThermalPeriod',
  'ProjectC Web Prototype',
  'Thermal Clock Lab',
  '热力钟摆',
]

const obsoleteMarkers = [
  'clipped-mirror-multi-bounce-v2',
  'reflected-actor-current-m-exchange-v1',
  'cell-conflict-consumes-motion-trace-v1',
  'stepwise-clipped-mirror-v2',
  'forward-range-spend',
  'equal-mass-1d',
  'chain-decay-prototype',
  'connected-envelope-m-spend-v4',
  'cell-target-curved-composition',
]

let lastError
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const infoText = await fresh(new URL('build-info.json', baseUrl), attempt)
    const info = JSON.parse(infoText)
    if (info.commit !== expectedCommit) throw new Error(`published commit is ${info.commit}`)
    if (info.implementation !== 'spatial-inertia-v1-candidate') throw new Error(`published implementation is ${info.implementation}`)

    const html = await fresh(baseUrl, attempt)
    const matches = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
    if (!matches.length) throw new Error('published bundle missing')
    let bundle = ''
    for (const match of matches) {
      const bundleUrl = new URL(match[1], baseUrl.origin)
      bundle += `\n${await fresh(bundleUrl, attempt)}`
    }
    if (!bundle.includes(expectedCommit)) throw new Error('published bundle commit mismatch')

    for (const marker of requiredMarkers) {
      if (!bundle.includes(marker)) throw new Error(`published bundle missing ${marker}`)
    }
    for (const obsolete of obsoleteMarkers) {
      if (bundle.includes(obsolete)) throw new Error(`published bundle still contains obsolete marker ${obsolete}`)
    }

    console.log(`Verified production main@${expectedCommit.slice(0, 8)} · Spatial Inertia v1 candidate runtime and published bundle`)
    process.exit(0)
  } catch (error) {
    lastError = error
    console.log(`deployment not ready (${attempt}/${attempts}): ${error.message}`)
    if (attempt < attempts) await sleep(delayMs)
  }
}
throw lastError
