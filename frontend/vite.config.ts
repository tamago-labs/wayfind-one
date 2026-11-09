import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '1.0.0'),
  },
  server: {
    port: 5173,
    proxy: {
      // daemon API (planned, see docs/PLAN.md) serves localhost:7777
      '/api': 'http://localhost:7777',
    },
  },
})
