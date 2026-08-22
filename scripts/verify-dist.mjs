import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const expectedCommit = process.env.EXPECTED_COMMIT || process.env.VITE_BUILD_COMMIT || 'local'
const distDir = resolve('dist')
const info = JSON.parse(await readFile(resolve(distDir, 'build-info.json'), 'utf8'))
const html = await readFile(resolve(distDir, 'index.html'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(info.schemaVersion === 3, 'build-info schema is not cell-world v3')
assert(info.implementation === 'cell-world-spatial-ab-v1', 'build-info implementation mismatch')
assert(info.commit === expectedCommit, `build commit ${info.commit} != ${expectedCommit}`)
assert(info.status === (expectedCommit === 'local' ? 'local' : 'verified'), 'unexpected build status')

const scriptMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)
assert(scriptMatch, 'built JavaScript entry missing')
const scriptPath = scriptMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
await stat(resolve(distDir, scriptPath))
const script = await readFile(resolve(distDir, scriptPath), 'utf8')
for (const marker of [
  'cell-world-spatial-ab-v1',
  'Inertia Driving Playground',
  'Motion Cards · Force / Cell Aim',
  'Spatial Model A/B',
  'Cell Inspector',
  'Discrete',
  'Hybrid',
  'Card + Aim Cell',
]) assert(script.includes(marker), `current runtime marker missing: ${marker}`)
assert(script.includes(expectedCommit), 'bundle commit marker missing')

for (const legacy of [
  'InertiaFieldBoard',
  'Reachable Field',
  'Basic Move',
  'Actor Loop UT6',
  'Apply Impulse',
  'Graphics Lab',
]) assert(!script.includes(legacy), `obsolete runtime marker still bundled: ${legacy}`)

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
assert(styleMatch, 'built stylesheet missing')
const stylePath = styleMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
const style = await readFile(resolve(distDir, stylePath), 'utf8')
assert(style.includes('.continuous-board-host'), 'shared board styling missing')
assert(style.includes('.spatial-ab-card'), 'spatial A/B styling missing')
assert(style.includes('.actor-vitals'), 'restored actor/world UI styling missing')

console.log(`Verified cell-world spatial A/B dist for ${info.branch}@${info.shortCommit}.`)
