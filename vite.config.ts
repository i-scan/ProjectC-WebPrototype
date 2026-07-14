import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ProjectC-WebPrototype/',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
