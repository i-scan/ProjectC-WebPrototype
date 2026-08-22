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

// Current production entry uses impulse/aim input. Cell click finalizes the aim
// and resolves immediately. Both A/B modes use the original full HexThreeBoard;
// only the actor playback path is simplified in Hybrid.
assert(script.includes('impulse-inertia-input-v3'), 'impulse v3 implementation marker is missing')
assert(script.includes('Inertia Driving Playground'), 'impulse playground heading is missing')
assert(script.includes('Motion Cards · Force / Angle Input'), 'impulse action hand is missing')
assert(script.includes('Hover = Preview · Click legal Cell = Resolve 1 AT'), 'click-to-resolve interaction marker is missing')
assert(script.includes('Click board to fire'), 'click-to-fire hand state is missing')
assert(!script.includes('Apply Impulse · Resolve 1 AT'), 'obsolete second-confirm Apply button is still bundled')
assert(script.includes('data-click-to-resolve'), 'click-to-resolve root contract is missing')
assert(script.includes('data-shared-board'), 'shared-board root contract is missing')
assert(script.includes('hex-three-board'), 'original HexThreeBoard identity is missing')
assert(script.includes('cell-by-cell playback'), 'Discrete playback identity is missing')
assert(script.includes('continuous segment playback'), 'Hybrid playback identity is missing')
assert(script.includes('Counter Impulse'), 'counter impulse card is missing')
assert(script.includes('Hard Turn'), 'hard-turn card is missing')
assert(script.includes('Spatial Playback A/B'), 'Discrete/Hybrid comparison controls are missing')
assert(script.includes('Collision Course'), 'collision test preset is missing')
assert(script.includes('2D') && script.includes('3D'), 'restored renderer switch is missing')
assert(script.includes('Board Radius'), 'restored board radius control is missing')
assert(script.includes('Thermal State'), 'restored thermal debug section is missing')
assert(script.includes('Spatial Debug'), 'restored spatial debug section is missing')
assert(script.includes('图形性能实验室'), 'graphics performance lab navigation entry is missing')

assert(!script.includes('inertia-driving-navigation-v4'), 'superseded multi-AT navigation UI was unexpectedly bundled')
assert(!script.includes('Inertia Reachable Field A/B'), 'superseded focused reachable-field page was unexpectedly bundled')

const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
assert(styleMatch, 'built CSS entry was not found')
const stylePath = styleMatch[1].replace(/^\/ProjectC-WebPrototype\//, '')
await stat(resolve(distDir, stylePath))
const style = await readFile(resolve(distDir, stylePath), 'utf8')

assert(/\.impulse-inertia-lab/.test(style), 'impulse lab styling is missing')
assert(/\.impulse-fire-status/.test(style), 'click-to-resolve status styling is missing')
assert(!/\.impulse-commit-row/.test(style), 'obsolete Apply-row styling is still bundled')
assert(/\.ut6-action-hand/.test(style), 'restored UT6 action-hand styling is missing')
assert(/\.hex-view-switch/.test(style), 'restored 2D/3D view switch styling is missing')
assert(/\.hex-board-host/.test(style), 'original HexThreeBoard host styling is missing')
assert(/\.build-revision/.test(style), 'build revision styling is missing')
assert(!/font-size\s*:\s*6px\s*!important/.test(style), 'obsolete 6px Thermal override is still bundled')

console.log(`Verified HexThreeBoard click-to-resolve impulse lab for ${info.branch}@${info.shortCommit}.`)
