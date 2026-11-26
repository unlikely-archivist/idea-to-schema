import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In dev, send /api calls to the Hono server so the page and API share an origin (no CORS).
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
})
