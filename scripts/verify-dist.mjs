import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const expectedCommit = process.env.EXPECTED_COMMIT || process.env.VITE_BUILD_COMMIT || 'local'
const distDir = resolve('dist')
const info = JSON.parse(await readFile(resolve(distDir, 'build-info.json'), 'utf8'))
const html = await readFile(resolve(distDir, 'index.html'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(info.schemaVersion === 2, 'build-info schema is not rebuild v2')
assert(info.implementation === 'continuous-inertia-v1', 'build-info implementation mismatch')
assert(info.commit === expectedCommit, `build commit ${info.commit} != ${expectedCommit}`)
assert(info.status === (expectedCommit === 'local' ? 'local' : 'verified'), 'unexpected build status')

const scriptMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)
assert(scriptMatch, 'built JavaScript entry missing')
const scriptPath = scriptMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
await stat(resolve(distDir, scriptPath))
const script = await readFile(resolve(distDir, scriptPath), 'utf8')
assert(script.includes('continuous-inertia-v1'), 'continuous inertia implementation marker missing')
assert(script.includes(expectedCommit), 'bundle commit marker missing')
assert(script.includes('Continuous Inertia Playground'), 'current playground heading missing')
assert(script.includes('Position + Velocity'), 'continuous authoritative state marker missing')
assert(script.includes('Card + Aim'), 'current input model marker missing')

for (const legacy of [
  'ImpulseInertiaPlayground',
  'InertiaFieldBoard',
  'Reachable Field',
  'Basic Move',
  'Actor Loop UT6',
  'UT5',
  'UT7',
  'Discrete/Hybrid',
  'Apply Impulse',
  'Graphics Lab',
]) assert(!script.includes(legacy), `legacy runtime marker still bundled: ${legacy}`)

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
assert(styleMatch, 'built stylesheet missing')
const stylePath = styleMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
const style = await readFile(resolve(distDir, stylePath), 'utf8')
assert(style.includes('.continuous-board-host'), 'continuous board styling missing')
assert(style.includes('.action-hand'), 'current action-hand styling missing')

console.log(`Verified clean continuous inertia dist for ${info.branch}@${info.shortCommit}.`)
