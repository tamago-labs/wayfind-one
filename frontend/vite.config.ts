import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // daemon API (planned, see docs/PLAN.md) serves localhost:7777
      '/api': 'http://localhost:7777',
    },
  },
})
