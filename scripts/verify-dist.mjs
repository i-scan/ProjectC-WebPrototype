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

console.log(`Verified dist for ${info.branch}@${info.shortCommit}.`)
