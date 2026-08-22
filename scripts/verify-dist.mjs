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

// Current production entry is intentionally focused on the Basic Move spatial
// comparison. Historical UT5/UT6/legacy inspectors remain reproducible source
// history but are no longer required to be bundled or exposed in navigation.
assert(script.includes('inertia-reachable-field-ab-v1'), 'reachable-field A/B implementation marker is missing')
assert(script.includes('Inertia Reachable Field A/B'), 'reachable-field experiment heading is missing')
assert(script.includes('A · Discrete Field'), 'Discrete Field comparison mode is missing')
assert(script.includes('B · Hybrid Spatial'), 'Hybrid Spatial comparison mode is missing')
assert(script.includes('M0 · adjacent ring'), 'M0 reachable-field profile is missing')
assert(script.includes('compact 3×3-ish / rear closed'), 'M1 reachable-field profile is missing')
assert(script.includes('teardrop'), 'M2/M3 teardrop profile is missing')
assert(script.includes('continuous curve / free endpoint inside Cell'), 'Hybrid continuous-path preview contract is missing')
assert(script.includes('Cell-center stepped path'), 'Discrete path preview contract is missing')
assert(script.includes('图形性能实验室'), 'graphics performance lab navigation entry is missing')

// The cleanup is part of the current production contract: historical labs may
// remain in source, but they must not be pulled into the focused main bundle.
assert(!script.includes('axis-inertia-sandbox-v1'), 'historical UT5 lab was unexpectedly bundled')
assert(!script.includes('inertia-driving-navigation-v4'), 'superseded multi-AT navigation UI was unexpectedly bundled')
assert(!script.includes('data-inspector-layout-contract'), 'historical inspector contract was unexpectedly bundled')

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
assert(styleMatch, 'built CSS entry was not found')
const stylePath = styleMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
await stat(resolve(distDir, stylePath))
const style = await readFile(resolve(distDir, stylePath), 'utf8')

assert(/\.inertia-field-ab/.test(style), 'reachable-field A/B layout styling is missing')
assert(/\.inertia-field-board/.test(style), 'focused Three.js board styling is missing')
assert(/\.ifab-mode-switch/.test(style), 'A/B mode switch styling is missing')
assert(/\.build-revision/.test(style), 'build revision styling is missing')
assert(!/font-size\s*:\s*6px\s*!important/.test(style), 'obsolete 6px Thermal override is still bundled')

console.log(`Verified focused inertia A/B dist for ${info.branch}@${info.shortCommit}.`)
