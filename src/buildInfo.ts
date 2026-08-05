const commit = import.meta.env.VITE_BUILD_COMMIT || 'local'
const branch = import.meta.env.VITE_BUILD_BRANCH || 'local'

export const buildInfo = Object.freeze({
  commit,
  shortCommit: commit === 'local' ? 'local' : commit.slice(0, 7),
  branch,
  builtAt: import.meta.env.VITE_BUILD_TIME || 'local',
  repository: import.meta.env.VITE_BUILD_REPOSITORY || 'local',
  runUrl: import.meta.env.VITE_BUILD_RUN_URL || '',
  status: commit === 'local' ? 'local' : 'verified',
})
