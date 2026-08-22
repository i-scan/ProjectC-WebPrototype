const [pageUrlArgument, expectedCommit] = process.argv.slice(2)

if (!pageUrlArgument || !expectedCommit) {
  throw new Error('Usage: node scripts/verify-deployment.mjs <page-url> <full-commit-sha>')
}

const pageUrl = new URL(pageUrlArgument.endsWith('/') ? pageUrlArgument : `${pageUrlArgument}/`)
const maxAttempts = Number.parseInt(process.env.DEPLOY_VERIFY_ATTEMPTS || '60', 10)
const retryDelayMs = Number.parseInt(process.env.DEPLOY_VERIFY_DELAY_MS || '5000', 10)

if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`DEPLOY_VERIFY_ATTEMPTS must be a positive integer; received ${process.env.DEPLOY_VERIFY_ATTEMPTS}`)
if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) throw new Error(`DEPLOY_VERIFY_DELAY_MS must be a non-negative integer; received ${process.env.DEPLOY_VERIFY_DELAY_MS}`)

function verificationUrl(url, label, attempt) {
  const requestUrl = new URL(url)
  requestUrl.searchParams.set('verify', `${expectedCommit}-${label}-${attempt}-${Date.now()}`)
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
      if (attempt < attempts && retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
  throw lastError
}

const infoUrl = new URL('build-info.json', pageUrl)
const info = await retry('build-info.json', async (attempt) => {
  const candidate = JSON.parse(await fetchFreshText(infoUrl, 'build-info', attempt))
  if (candidate.commit !== expectedCommit) throw new Error(`published commit is ${candidate.commit}`)
  if (candidate.status !== 'verified') throw new Error(`published status is ${candidate.status}`)
  if (candidate.branch !== 'main') throw new Error(`published branch is ${candidate.branch}`)
  return candidate
})

const revisionUrl = new URL(info.revisionUrl)
revisionUrl.searchParams.set('revision', expectedCommit)
const html = await retry('revision page', async (attempt) => {
  const candidate = await fetchFreshText(revisionUrl, 'revision-html', attempt)
  if (!candidate.includes(`name="projectc-build-commit" content="${expectedCommit}"`)) throw new Error('HTML commit metadata does not match')
  if (!candidate.includes('name="projectc-build-status" content="verified"')) throw new Error('HTML is not marked as verified')
  return candidate
})

const scriptMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)
if (!scriptMatch) throw new Error('published JavaScript entry was not found')
const scriptUrl = new URL(scriptMatch[1], pageUrl.origin)
await retry('published JavaScript bundle', async (attempt) => {
  const script = await fetchFreshText(scriptUrl, 'javascript', attempt)
  if (!script.includes('data-build-revision')) throw new Error('visible revision marker is missing from the published app')
  if (!script.includes(expectedCommit)) throw new Error('published app bundle does not contain the expected commit')

  if (!script.includes('impulse-inertia-input-v2')) throw new Error('impulse v2 implementation marker is missing')
  if (!script.includes('Inertia Driving Playground')) throw new Error('impulse playground heading is missing')
  if (!script.includes('Motion Cards · Force / Angle Input')) throw new Error('impulse action hand is missing')
  if (!script.includes('Hover = Preview · Click legal Cell = Resolve 1 AT')) throw new Error('click-to-resolve interaction marker is missing')
  if (!script.includes('Click board to fire')) throw new Error('click-to-fire hand state is missing')
  if (script.includes('Apply Impulse · Resolve 1 AT')) throw new Error('obsolete Apply confirmation is still published')
  if (!script.includes('data-click-to-resolve')) throw new Error('click-to-resolve root contract is missing')
  if (!script.includes('data-shared-board')) throw new Error('shared-board root contract is missing')
  if (!script.includes('Cell-center playback')) throw new Error('Discrete playback identity is missing')
  if (!script.includes('continuous playback')) throw new Error('Hybrid playback identity is missing')
  if (!script.includes('Counter Impulse')) throw new Error('counter impulse card is missing')
  if (!script.includes('Hard Turn')) throw new Error('hard-turn card is missing')
  if (!script.includes('Spatial Playback A/B')) throw new Error('Discrete/Hybrid comparison controls are missing')
  if (!script.includes('Collision Course')) throw new Error('collision test preset is missing')
  if (!script.includes('2D') || !script.includes('3D')) throw new Error('restored renderer switch is missing')
  if (!script.includes('Board Radius')) throw new Error('restored board radius control is missing')
  if (!script.includes('Thermal State')) throw new Error('restored thermal debug section is missing')
  if (!script.includes('Spatial Debug')) throw new Error('restored spatial debug section is missing')
  if (!script.includes('图形性能实验室')) throw new Error('graphics performance lab navigation entry is missing')

  if (script.includes('inertia-driving-navigation-v4')) throw new Error('superseded multi-AT navigation UI is still published')
  if (script.includes('Inertia Reachable Field A/B')) throw new Error('superseded focused reachable-field page is still published')
  return script
})

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
if (!styleMatch) throw new Error('published CSS entry was not found')
const styleUrl = new URL(styleMatch[1], pageUrl.origin)
await retry('published stylesheet', async (attempt) => {
  const style = await fetchFreshText(styleUrl, 'stylesheet', attempt)
  if (!/\.impulse-inertia-lab/.test(style)) throw new Error('impulse lab styling is missing')
  if (!/\.impulse-fire-status/.test(style)) throw new Error('click-to-resolve status styling is missing')
  if (/\.impulse-commit-row/.test(style)) throw new Error('obsolete Apply-row styling is still published')
  if (!/\.ut6-action-hand/.test(style)) throw new Error('restored UT6 action-hand styling is missing')
  if (!/\.hex-view-switch/.test(style)) throw new Error('restored 2D/3D view switch styling is missing')
  if (!/\.build-revision/.test(style)) throw new Error('build revision styling is missing')
  if (/font-size\s*:\s*6px\s*!important/.test(style)) throw new Error('obsolete 6px Thermal override is still deployed')
  return style
})

console.log(`Verified production ${info.branch}@${info.shortCommit}`)
console.log(`Latest: ${info.latestUrl}`)
console.log(`Revision check: ${info.revisionUrl}`)
