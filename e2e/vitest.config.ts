import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 120000, // 2 minutes for E2E tests
    hookTimeout: 60000,
    reporters: ['verbose'],
    globalSetup: './e2e/setup/global-setup.ts',
  },
})
