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
assert(script.includes('hex-inspector-coordinate'), 'React-owned inspector coordinate is missing')
assert(script.includes('inspector-panel-'), 'React-owned inspector panel mode is missing')
assert(script.includes('thermal-clock-config-label'), 'rebuilt Thermal configuration controls are missing')
assert(!script.includes('RightInspectorChrome'), 'obsolete DOM-patching inspector component is still bundled')

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
assert(styleMatch, 'built CSS entry was not found')
const stylePath = styleMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
await stat(resolve(distDir, stylePath))
const style = await readFile(resolve(distDir, stylePath), 'utf8')
assert(style.includes('inspector-thermal'), 'Thermal inspector width mode is missing from CSS')
assert(style.includes('hex-inspector-coordinate'), 'shared coordinate styling is missing from CSS')
assert(style.includes('520px'), 'desktop Thermal inspector width is not present in CSS')
assert(style.includes('flex-wrap:nowrap'), 'inspector tabs are not locked to one line')
assert(style.includes('--tc-body:12px'), 'Thermal base type scale is missing')
assert(style.includes('--tc-value-emphasis:20px'), 'Thermal emphasis type scale is missing')
assert(!style.includes('font-size:6px!important'), 'obsolete 6px Thermal override is still bundled')

console.log(`Verified dist for ${info.branch}@${info.shortCommit}.`)
