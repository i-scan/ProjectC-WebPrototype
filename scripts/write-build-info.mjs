import { mkdir, writeFile } from 'node:fs/promises'

const commit = process.env.VITE_BUILD_COMMIT || 'local'
const branch = process.env.VITE_BUILD_BRANCH || 'local'
const buildTime = process.env.VITE_BUILD_TIME || new Date().toISOString()
const baseUrl = process.env.VITE_SITE_BASE_URL || 'http://localhost:5173/ProjectC-WebPrototype/'
const latestUrl = new URL(baseUrl).toString()
const revisionUrl = new URL(latestUrl)
revisionUrl.searchParams.set('revision', commit)

await mkdir('public', { recursive: true })
await writeFile('public/build-info.json', `${JSON.stringify({
  schemaVersion: 2,
  implementation: 'continuous-inertia-v1',
  commit,
  shortCommit: commit === 'local' ? 'local' : commit.slice(0, 8),
  branch,
  status: commit === 'local' ? 'local' : 'verified',
  buildTime,
  latestUrl,
  revisionUrl: revisionUrl.toString(),
}, null, 2)}\n`)
