import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}', 'lib/**/*.test.ts'],
    // Integration tests live under tests/integration/ and need a real local
    // Supabase + Docker. Run them via `npm run test:integration` (separate
    // config). The default `npm test` runs unit tests only.
    exclude: ['tests/integration/**', 'node_modules/**', '.next/**', '.next-old/**'],
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
