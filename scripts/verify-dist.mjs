import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const expectedCommit = process.env.EXPECTED_COMMIT || process.env.VITE_BUILD_COMMIT || 'local'
const distDir = resolve('dist')
const info = JSON.parse(await readFile(resolve(distDir, 'build-info.json'), 'utf8'))
const html = await readFile(resolve(distDir, 'index.html'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(info.schemaVersion === 1, 'build-info.json schemaVersion is not 1')
assert(info.commit === expectedCommit, `build-info commit ${info.commit} != ${expectedCommit}`)
assert(info.status === (expectedCommit === 'local' ? 'local' : 'verified'), 'unexpected build status')
assert(info.revisionUrl.includes(`revision=${encodeURIComponent(expectedCommit)}`), 'revision URL does not identify the build commit')
assert(html.includes(`name="projectc-build-commit" content="${expectedCommit}"`), 'index.html commit metadata is missing')
assert(html.includes(`name="projectc-build-status" content="${info.status}"`), 'index.html status metadata is missing')
assert(!html.includes('/src/main.tsx'), 'index.html still references the Vite development entry')

const scriptMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)
assert(scriptMatch, 'built JavaScript entry was not found')
const scriptPath = scriptMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
await stat(resolve(distDir, scriptPath))
const script = await readFile(resolve(distDir, scriptPath), 'utf8')
assert(script.includes('data-build-revision'), 'visible build revision marker is missing from the app bundle')
assert(script.includes(expectedCommit), 'app bundle does not contain the expected build commit')

// Active UT5 Inertia Lab contract. UT4 remains source-history only and is not
// required in the tree-shaken production bundle.
assert(script.includes('VAL-012-UT5'), 'UT5 ruleset marker is missing')
assert(script.includes('axis-inertia-sandbox-v1'), 'UT5 implementation marker is missing')
assert(script.includes('惯性实验室 · UT5'), 'UT5 live route heading is missing')
assert(script.includes('Unified Axis Inertia'), 'UT5 unified axis identity is missing')
assert(script.includes('Player Actions'), 'UT5 persistent action hand is missing')
assert(script.includes('Thermal Debug'), 'UT5 Thermal Debug controls are missing')
assert(script.includes('Spatial Debug'), 'UT5 Spatial Debug controls are missing')
assert(script.includes('Reaction A/B'), 'UT5 Reaction experiment controls are missing')
assert(script.includes('Inject 0 AT'), 'UT5 event-only Hit control is missing')
assert(script.includes('Hit + Resolve 1 AT'), 'UT5 same-AT Hit control is missing')
assert(script.includes('Nobody Dies'), 'UT5 lab survival convenience is missing')
assert(script.includes('Action / Event Log'), 'UT5 diagnostic log is missing')
assert(script.includes('Hold Position'), 'UT5 Hold Position action is missing')
assert(script.includes('Heavy Release'), 'UT5 Heavy Release action is missing')
assert(script.includes('Drive Intro'), 'UT5 Drive Intro semantics are missing')
assert(script.includes('Blocked Crash · no auto redirect'), 'UT5 no-auto-redirect Drive rule is missing')
assert(script.includes('Failed Occupancy Fallback'), 'UT5 failed occupancy A/B rule is missing')
assert(script.includes('Reaction Sidestep'), 'UT5 reaction sidestep A/B rule is missing')
assert(script.includes('Down free build'), 'UT5 Down Momentum build marker is missing')
assert(script.includes('same-AT Thermal Evolution'), 'UT5 same-AT thermal ordering marker is missing')

// Hex6 remains a separately supported prototype route.
assert(script.includes('hex-inspector-coordinate'), 'React-owned inspector coordinate is missing')
assert(script.includes('inspector-panel-'), 'React-owned inspector panel mode is missing')
assert(script.includes('thermal-clock-config-label'), 'rebuilt Thermal configuration controls are missing')
assert(script.includes('data-inspector-layout-contract'), 'runtime inspector layout contract marker is missing')
assert(script.includes('runtime-v3'), 'stable-width inspector layout contract version is missing')
assert(script.includes('momentumByActorId'), 'actor Spatial/Momentum indicator data is missing')
assert(script.includes('Chain Window'), 'visible Chain Window marker is missing')
assert(script.includes('World Time'), 'visible global time marker is missing')
assert(script.includes('460px'), 'desktop unified inspector width is missing')
assert(script.includes('430px'), 'laptop unified inspector width is missing')
assert(script.includes('--tc-body: 10px'), 'compact Thermal base type scale is missing')
assert(script.includes('--tc-value-emphasis: 14px'), 'compact Thermal emphasis scale is missing')
assert(script.includes('white-space: nowrap !important'), 'runtime single-line tab contract is missing')
assert(!script.includes('RightInspectorChrome'), 'obsolete DOM-patching inspector component is still bundled')

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
assert(styleMatch, 'built CSS entry was not found')
const stylePath = styleMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
await stat(resolve(distDir, stylePath))
const style = await readFile(resolve(distDir, stylePath), 'utf8')

assert(/\.coupled-inertia-lab/.test(style), 'inertia lab styling is missing from CSS')
assert(/\.ut4-action-hand/.test(style), 'shared inertia action-hand styling is missing from CSS')
assert(/\.ut4-controlled-pendulum/.test(style), 'shared controlled pendulum styling is missing from CSS')
assert(/\.inspector-thermal/.test(style), 'shared Thermal inspector styling is missing from CSS')
assert(/hex-inspector-coordinate/.test(style), 'shared coordinate styling is missing from CSS')
assert(!/font-size\s*:\s*6px\s*!important/.test(style), 'obsolete 6px Thermal override is still bundled')

console.log(`Verified dist for ${info.branch}@${info.shortCommit}.`)
