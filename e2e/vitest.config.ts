import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// E2E test config (npm run test:e2e) — deliberately NOT the default config.
// This suite launches a real browser and talks to live Supabase / the local
// backend, so it needs the long timeouts below and must never be swept into
// `npm test`. The unit suite lives in the root vitest.config.ts.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  // Pin the root to the repo, not this config's directory, so `include` below
  // resolves the same way no matter which cwd the script is invoked from.
  root: repoRoot,
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['e2e/**/*.test.ts'],
    testTimeout: 120000, // 2 minutes for E2E tests
    hookTimeout: 60000,
    reporters: ['verbose'],
    globalSetup: './e2e/setup/global-setup.ts',
  },
})
