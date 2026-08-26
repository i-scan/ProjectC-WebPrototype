const [pageUrlArgument, expectedCommit] = process.argv.slice(2)
if (!pageUrlArgument || !expectedCommit) throw new Error('Usage: verify-deployment <page-url> <commit>')

const baseUrl = new URL(pageUrlArgument.endsWith('/') ? pageUrlArgument : `${pageUrlArgument}/`)
const attempts = Number(process.env.DEPLOY_VERIFY_ATTEMPTS || 60)
const delayMs = Number(process.env.DEPLOY_VERIFY_DELAY_MS || 4000)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fresh(url, attempt) {
  const request = new URL(url)
  request.searchParams.set('verify', `${expectedCommit}-${attempt}-${Date.now()}`)
  const response = await fetch(request, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache, no-store' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${request}`)
  return response.text()
}

let lastError
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const infoText = await fresh(new URL('build-info.json', baseUrl), attempt)
    const info = JSON.parse(infoText)
    if (info.commit !== expectedCommit) throw new Error(`published commit is ${info.commit}`)
    if (info.implementation !== 'cell-world-spatial-ab-v3') throw new Error(`published implementation is ${info.implementation}`)

    const html = await fresh(baseUrl, attempt)
    const match = html.match(/<script[^>]+src="([^"]+\.js)"/)
    if (!match) throw new Error('published bundle missing')
    const bundleUrl = new URL(match[1], baseUrl.origin)
    const bundle = await fresh(bundleUrl, attempt)
    if (!bundle.includes(expectedCommit)) throw new Error('published bundle commit mismatch')

    for (const marker of [
      'cell-world-spatial-ab-v3',
      'Basic Move',
      'Hold',
      '原地等待 · M-1',
      'Basic Command + Momentum Cards',
      'Spatial Model A/B',
      'Cell Inspector',
      'reachable-cell-target-v4',
      'connected-envelope-m-spend-v4',
      'cell-target-curved-composition',
      'clipped-mirror-multi-bounce-v2',
      'clipped-cell-mirror-v2',
      'contact-ray-step-budget-v3',
      'wall-cell-pivot-budget-v1',
      'wall-axis-mesh-v1',
      'wall-pivot-polyline-v1',
      'obstacle-wall-cell-pivot',
      'wallCellTravelCost',
      'boundary-corner-chamfer',
      'stepwise-clipped-mirror-v2',
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
      'surface-stop',
      'forward-range-spend',
      'equal-mass-1d',
      'M Exchange',
      'setAxisDisplay',
      'data-down-axis-controls',
      'actorPlaybackWindows',
      'playerPlaybackEnd',
      'Landing Cell Input',
      'data-thermal-period',
      'setThermalPeriod',
      'ProjectC Web Prototype',
      'Thermal Clock Lab',
      '热力钟摆',
    ]) {
      if (!bundle.includes(marker)) throw new Error(`published bundle missing ${marker}`)
    }

    console.log(`Verified production main@${expectedCommit.slice(0, 8)} · visible wall axis + pivot polyline + internal wall Cell travel`)
    process.exit(0)
  } catch (error) {
    lastError = error
    console.log(`deployment not ready (${attempt}/${attempts}): ${error.message}`)
    if (attempt < attempts) await sleep(delayMs)
  }
}
throw lastError
