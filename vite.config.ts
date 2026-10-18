import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { roomApi } from './server/plugin.ts'

export default defineConfig({
  plugins: [react(), roomApi()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
})
