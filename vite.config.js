import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const commit = process.env.VITE_BUILD_COMMIT || 'local'
const branch = process.env.VITE_BUILD_BRANCH || 'local'

export default defineConfig({
  plugins: [react()],
  base: '/ProjectC-WebPrototype/',
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_BRANCH__: JSON.stringify(branch),
  },
})
