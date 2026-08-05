const [pageUrlArgument, expectedCommit] = process.argv.slice(2)

if (!pageUrlArgument || !expectedCommit) {
  throw new Error('Usage: node scripts/verify-deployment.mjs <page-url> <full-commit-sha>')
}

const pageUrl = new URL(pageUrlArgument.endsWith('/') ? pageUrlArgument : `${pageUrlArgument}/`)
const cacheBust = `${expectedCommit}-${Date.now()}`

async function fetchText(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.text()
}

async function retry(label, operation) {
  let lastError
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      console.log(`${label} is not ready (${attempt}/18): ${error.message}`)
      if (attempt < 18) await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
  throw lastError
}

const infoUrl = new URL('build-info.json', pageUrl)
infoUrl.searchParams.set('verify', cacheBust)

const info = await retry('build-info.json', async () => {
  const candidate = JSON.parse(await fetchText(infoUrl))
  if (candidate.commit !== expectedCommit) {
    throw new Error(`published commit is ${candidate.commit}`)
  }
  if (candidate.status !== 'verified') throw new Error(`published status is ${candidate.status}`)
  if (candidate.branch !== 'main') throw new Error(`published branch is ${candidate.branch}`)
  return candidate
})

const revisionUrl = new URL(info.revisionUrl)
revisionUrl.searchParams.set('revision', expectedCommit)
revisionUrl.searchParams.set('verify', cacheBust)
const html = await retry('revision page', async () => {
  const candidate = await fetchText(revisionUrl)
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
scriptUrl.searchParams.set('verify', cacheBust)
const script = await fetchText(scriptUrl)
if (!script.includes('data-build-revision')) throw new Error('visible revision marker is missing from the published app')
if (!script.includes(expectedCommit)) throw new Error('published app bundle does not contain the expected commit')
if (!script.includes('hex-inspector-coordinate')) throw new Error('React-owned inspector coordinate is missing')
if (!script.includes('inspector-panel-')) throw new Error('React-owned inspector panel mode is missing')
if (!script.includes('thermal-clock-config-label')) throw new Error('rebuilt Thermal configuration controls are missing')
if (!script.includes('data-inspector-layout-contract')) throw new Error('runtime inspector layout contract marker is missing')
if (!script.includes('runtime-v3')) throw new Error('stable-width inspector layout contract version is missing')
if (!script.includes('460px')) throw new Error('desktop unified inspector width is missing')
if (!script.includes('430px')) throw new Error('laptop unified inspector width is missing')
if (!script.includes('--tc-body: 10px')) throw new Error('compact Thermal base type scale is missing')
if (!script.includes('--tc-value-emphasis: 14px')) throw new Error('compact Thermal emphasis scale is missing')
if (!script.includes('white-space: nowrap !important')) throw new Error('runtime single-line tab contract is missing')
if (script.includes('RightInspectorChrome')) throw new Error('obsolete DOM-patching inspector component is still bundled')

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
if (!styleMatch) throw new Error('published CSS entry was not found')
const styleUrl = new URL(styleMatch[1], pageUrl.origin)
styleUrl.searchParams.set('verify', cacheBust)
const style = await fetchText(styleUrl)
if (!/\.inspector-thermal/.test(style)) throw new Error('shared Thermal inspector styling is missing from CSS')
if (!/hex-inspector-coordinate/.test(style)) throw new Error('shared coordinate styling is missing from CSS')
if (/font-size\s*:\s*6px\s*!important/.test(style)) throw new Error('obsolete 6px Thermal override is still deployed')

console.log(`Verified production ${info.branch}@${info.shortCommit}`)
console.log(`Latest: ${info.latestUrl}`)
console.log(`Revision check: ${info.revisionUrl}`)
