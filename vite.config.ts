import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Disable the inline module-preload polyfill — it violates the
    // script-src 'self' CSP and modern browsers don't need it.
    modulePreload: { polyfill: false },
  },
  server: {
    watch: {
      ignored: ['**/.claude/**', '**/node_modules/**'],
    },
  },
})
