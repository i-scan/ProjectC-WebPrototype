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
    if (info.implementation !== 'cell-world-spatial-ab-v1') throw new Error(`published implementation is ${info.implementation}`)
    const html = await fresh(baseUrl, attempt)
    const match = html.match(/<script[^>]+src="([^"]+\.js)"/)
    if (!match) throw new Error('published bundle missing')
    const bundleUrl = new URL(match[1], baseUrl.origin)
    const bundle = await fresh(bundleUrl, attempt)
    if (!bundle.includes(expectedCommit)) throw new Error('published bundle commit mismatch')
    for (const marker of ['cell-world-spatial-ab-v1', 'Spatial Model A/B', 'Cell Inspector', 'Motion Cards · Force / Cell Aim']) {
      if (!bundle.includes(marker)) throw new Error(`published bundle missing ${marker}`)
    }
    console.log(`Verified production main@${expectedCommit.slice(0, 8)} · cell-world spatial A/B`)
    process.exit(0)
  } catch (error) {
    lastError = error
    console.log(`deployment not ready (${attempt}/${attempts}): ${error.message}`)
    if (attempt < attempts) await sleep(delayMs)
  }
}
throw lastError
