const [pageUrlArgument, expectedCommit] = process.argv.slice(2)

if (!pageUrlArgument || !expectedCommit) {
  throw new Error('Usage: node scripts/verify-deployment.mjs <page-url> <full-commit-sha>')
}

const pageUrl = new URL(pageUrlArgument.endsWith('/') ? pageUrlArgument : `${pageUrlArgument}/`)
const maxAttempts = Number.parseInt(process.env.DEPLOY_VERIFY_ATTEMPTS || '60', 10)
const retryDelayMs = Number.parseInt(process.env.DEPLOY_VERIFY_DELAY_MS || '5000', 10)

if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
  throw new Error(`DEPLOY_VERIFY_ATTEMPTS must be a positive integer; received ${process.env.DEPLOY_VERIFY_ATTEMPTS}`)
}
if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
  throw new Error(`DEPLOY_VERIFY_DELAY_MS must be a non-negative integer; received ${process.env.DEPLOY_VERIFY_DELAY_MS}`)
}

function verificationUrl(url, label, attempt) {
  const requestUrl = new URL(url)
  requestUrl.searchParams.set(
    'verify',
    `${expectedCommit}-${label}-${attempt}-${Date.now()}`,
  )
  return requestUrl
}

async function fetchFreshText(url, label, attempt) {
  const requestUrl = verificationUrl(url, label, attempt)
  const response = await fetch(requestUrl, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
  if (!response.ok) throw new Error(`${requestUrl} returned HTTP ${response.status}`)
  return response.text()
}

async function retry(label, operation, attempts = maxAttempts) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      console.log(`${label} is not ready (${attempt}/${attempts}): ${error.message}`)
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    }
  }
  throw lastError
}

const infoUrl = new URL('build-info.json', pageUrl)
const info = await retry('build-info.json', async (attempt) => {
  const candidate = JSON.parse(await fetchFreshText(infoUrl, 'build-info', attempt))
  if (candidate.commit !== expectedCommit) {
    throw new Error(`published commit is ${candidate.commit}`)
  }
  if (candidate.status !== 'verified') throw new Error(`published status is ${candidate.status}`)
  if (candidate.branch !== 'main') throw new Error(`published branch is ${candidate.branch}`)
  return candidate
})

const revisionUrl = new URL(info.revisionUrl)
revisionUrl.searchParams.set('revision', expectedCommit)
const html = await retry('revision page', async (attempt) => {
  const candidate = await fetchFreshText(revisionUrl, 'revision-html', attempt)
  if (!candidate.includes(`name="projectc-build-commit" content="${expectedCommit}"`)) {
    throw new Error('HTML commit metadata does not match')
  }
  if (!candidate.includes('name="projectc-build-status" content="verified"')) {
    throw new Error('HTML is not marked as verified')
  }
  return candidate
})

const scriptMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)
if (!scriptMatch) throw new Error('published JavaScript entry was not found')
const scriptUrl = new URL(scriptMatch[1], pageUrl.origin)
await retry('published JavaScript bundle', async (attempt) => {
  const script = await fetchFreshText(scriptUrl, 'javascript', attempt)
  if (!script.includes('data-build-revision')) throw new Error('visible revision marker is missing from the published app')
  if (!script.includes(expectedCommit)) throw new Error('published app bundle does not contain the expected commit')
  if (!script.includes('hex-inspector-coordinate')) throw new Error('React-owned inspector coordinate is missing')
  if (!script.includes('inspector-panel-')) throw new Error('React-owned inspector panel mode is missing')
  if (!script.includes('thermal-clock-config-label')) throw new Error('rebuilt Thermal configuration controls are missing')
  if (!script.includes('data-inspector-layout-contract')) throw new Error('runtime inspector layout contract marker is missing')
  if (!script.includes('runtime-v3')) throw new Error('stable-width inspector layout contract version is missing')
  if (!script.includes('VAL-012-UT3')) throw new Error('current UT3 ruleset marker is missing')
  if (!script.includes('momentum-collision-lab-v1')) throw new Error('current Momentum implementation marker is missing')
  if (!script.includes('Momentum 规则实验场景')) throw new Error('UT3 diagnostic scene is missing')
  if (!script.includes('Active Momentum')) throw new Error('Active Momentum UI is missing')
  if (!script.includes('Pending Momentum')) throw new Error('Pending Momentum UI is missing')
  if (!script.includes('Chain Window')) throw new Error('Chain Window UI is missing')
  if (!script.includes('data-action-id')) throw new Error('action-chain browser verification hooks are missing')
  if (!script.includes('data-at-playback-control')) throw new Error('AT playback speed control is missing')
  if (!script.includes('ms/AT')) throw new Error('AT playback duration readout is missing')
  if (!script.includes('460px')) throw new Error('desktop unified inspector width is missing')
  if (!script.includes('430px')) throw new Error('laptop unified inspector width is missing')
  if (!script.includes('--tc-body: 10px')) throw new Error('compact Thermal base type scale is missing')
  if (!script.includes('--tc-value-emphasis: 14px')) throw new Error('compact Thermal emphasis scale is missing')
  if (!script.includes('white-space: nowrap !important')) throw new Error('runtime single-line tab contract is missing')
  if (script.includes('RightInspectorChrome')) throw new Error('obsolete DOM-patching inspector component is still bundled')
  return script
})

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
if (!styleMatch) throw new Error('published CSS entry was not found')
const styleUrl = new URL(styleMatch[1], pageUrl.origin)
await retry('published stylesheet', async (attempt) => {
  const style = await fetchFreshText(styleUrl, 'stylesheet', attempt)
  if (!/\.inspector-thermal/.test(style)) throw new Error('shared Thermal inspector styling is missing from CSS')
  if (!/hex-inspector-coordinate/.test(style)) throw new Error('shared coordinate styling is missing from CSS')
  if (/font-size\s*:\s*6px\s*!important/.test(style)) throw new Error('obsolete 6px Thermal override is still deployed')
  return style
})

console.log(`Verified production ${info.branch}@${info.shortCommit}`)
console.log(`Latest: ${info.latestUrl}`)
console.log(`Revision check: ${info.revisionUrl}`)
