import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser preview (npm run preview) uses the mock bridge — useful for design QA
// without launching Electron.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: { '@renderer': resolve(__dirname, 'src/renderer/src') }
  },
  plugins: [react()],
  server: { port: 5173, strictPort: true }
})
