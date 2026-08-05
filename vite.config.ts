import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const commit = env.VITE_BUILD_COMMIT || 'local'
  const branch = env.VITE_BUILD_BRANCH || 'local'
  const buildStatus = commit === 'local' ? 'local' : 'verified'

  return {
    base: '/ProjectC-WebPrototype/',
    plugins: [
      react(),
      {
        name: 'projectc-build-metadata',
        transformIndexHtml: {
          order: 'pre',
          handler: () => [
            {
              tag: 'meta',
              attrs: { name: 'projectc-build-commit', content: commit },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: { name: 'projectc-build-branch', content: branch },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: { name: 'projectc-build-status', content: buildStatus },
              injectTo: 'head',
            },
          ],
        },
      },
    ],
    test: {
      environment: 'node',
    },
  }
})
