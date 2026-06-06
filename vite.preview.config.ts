import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Standalone Vite server for browser-based VISUAL VERIFICATION of the renderer
 * only. The real app runs through electron-vite (see electron.vite.config.ts).
 * window.claudedeck is absent in the browser; components guard for that.
 */
export default defineConfig({
  root: 'src/renderer',
  resolve: { alias: { '@': resolve('src/renderer') } },
  plugins: [react()],
  server: { port: 5199, strictPort: true },
})
