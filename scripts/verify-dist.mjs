import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const expectedCommit = process.env.EXPECTED_COMMIT || process.env.VITE_BUILD_COMMIT || 'local'
const distDir = resolve('dist')
const info = JSON.parse(await readFile(resolve(distDir, 'build-info.json'), 'utf8'))
const html = await readFile(resolve(distDir, 'index.html'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(info.schemaVersion === 5, 'build-info schema is not movement-correction v5')
assert(info.implementation === 'cell-world-spatial-ab-v3', 'build-info implementation mismatch')
assert(info.commit === expectedCommit, `build commit ${info.commit} != ${expectedCommit}`)
assert(info.status === (expectedCommit === 'local' ? 'local' : 'verified'), 'unexpected build status')

const scriptMatches = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
assert(scriptMatches.length, 'built JavaScript entries missing')
let script = ''
for (const match of scriptMatches) {
  const scriptPath = match[1].replace(/^\/ProjectC-WebPrototype\//, '')
  await stat(resolve(distDir, scriptPath))
  script += `\n${await readFile(resolve(distDir, scriptPath), 'utf8')}`
}

for (const marker of [
  'cell-world-spatial-ab-v3',
  'Inertia Driving Playground',
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
  'wall-cell-roundtrip-costs-one-v2',
  'reflected-actor-current-m-exchange-v1',
  'cell-motion-trace-v1',
  'authoritative-cell-travel-budget-v1',
  'single-cell-entry-resolution-v1',
  'cell-conflict-consumes-motion-trace-v1',
  'motion-trace-event-v1',
  'motion-trace-debug-bridge-v1',
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
  'Landing Cell Input',
  'forward-range-spend',
  'equal-mass-1d',
  'M Exchange',
  'setAxisDisplay',
  'data-down-axis-controls',
  'actorPlaybackWindows',
  'playerPlaybackEnd',
  'data-thermal-period',
  'setThermalPeriod',
  '热力钟摆',
  'ProjectC Web Prototype',
  'Thermal Clock Lab',
]) assert(script.includes(marker), `current runtime marker missing: ${marker}`)
assert(script.includes(expectedCommit), 'bundle commit marker missing')

for (const obsolete of [
  'InertiaFieldBoard',
  'Actor Loop UT6',
  'Apply Impulse',
  'unified-v2',
  'axis-build-turn-radius-v2',
  'actor-world-arrow-v3',
  'actor-screen-arrow-v4',
  'animated-actor-path-v2',
  'connected-envelope-v3',
  'physical-multi-bounce-v1',
  'exchange → preflight → animate → commit',
]) assert(!script.includes(obsolete), `obsolete runtime marker still bundled: ${obsolete}`)

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
assert(styleMatch, 'built stylesheet missing')
const stylePath = styleMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
const style = await readFile(resolve(distDir, stylePath), 'utf8')
for (const marker of [
  '.continuous-board-host',
  '.spatial-ab-card',
  '.actor-vitals',
  '.thermal-pendulum',
  '.app-switcher',
  '.build-revision',
  '[data-action-id=basic-move]',
]) assert(style.includes(marker), `restored UI styling missing: ${marker}`)

console.log(`Verified authoritative Cell motion trace + travel budget, wall/Actor reflection rules, and existing Axis/Hold runtime for ${info.branch}@${info.shortCommit}.`)
