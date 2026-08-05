import { mkdir, writeFile } from 'node:fs/promises'

const commit = process.env.VITE_BUILD_COMMIT || 'local'
const branch = process.env.VITE_BUILD_BRANCH || 'local'
const builtAt = process.env.VITE_BUILD_TIME || new Date().toISOString()
const repository = process.env.VITE_BUILD_REPOSITORY || 'local'
const runId = process.env.VITE_BUILD_RUN_ID || ''
const runNumber = process.env.VITE_BUILD_RUN_NUMBER || ''
const runUrl = process.env.VITE_BUILD_RUN_URL || ''
const latestUrl = process.env.VITE_SITE_BASE_URL || 'http://localhost:5173/ProjectC-WebPrototype/'

if (commit !== 'local' && !/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error(`VITE_BUILD_COMMIT must be a full Git SHA; received ${commit}`)
}

const revisionUrl = new URL(latestUrl)
revisionUrl.searchParams.set('revision', commit)

const buildInfo = {
  schemaVersion: 1,
  commit,
  shortCommit: commit === 'local' ? 'local' : commit.slice(0, 7),
  branch,
  builtAt,
  repository,
  runId,
  runNumber,
  runUrl,
  status: commit === 'local' ? 'local' : 'verified',
  deploymentMode: commit === 'local' ? 'vite-local' : 'github-pages',
  latestUrl,
  revisionUrl: revisionUrl.toString(),
}

await mkdir('public', { recursive: true })
await writeFile('public/build-info.json', `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8')
console.log(`Wrote build metadata for ${branch}@${buildInfo.shortCommit}.`)
