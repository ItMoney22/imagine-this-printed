import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest only defaults NODE_ENV to 'test' when it is UNSET, and several shells
// on this project (CI images, the dispatch runner) export NODE_ENV=production.
// That leaks into module resolution: `react` then resolves to its production
// CJS build, which does not export `act`, and every React Testing Library
// render dies with "React.act is not a function". Forcing it here — before the
// config is consumed, so the value is inherited by the test workers — makes
// `npm test` behave identically no matter what the caller's environment says.
process.env.NODE_ENV = 'test'

// UNIT test config (npm test / npm run test:watch).
//
// Kept as a separate root file rather than a `test` block inside vite.config.ts
// so the two suites can never bleed into each other: this one is scoped to
// src/**/*.test.{ts,tsx} and runs in jsdom with the default fast timeouts, while
// e2e/vitest.config.ts owns the slow browser/network suite (node env, 120s).
// Before this split, a bare `vitest run` had no test block to read and fell back
// to Vitest's default include glob, which swept up the e2e suite — that suite
// talks to live Supabase and expects a 120s timeout, so `npm test` was really
// running integration tests against production data.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'unit',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Belt-and-braces: `include` alone already excludes e2e/, but an explicit
    // exclude means a future glob widening can't silently re-adopt it.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'backend/**', 'scripts/**'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    css: false,
    coverage: {
      // Requires `npm i -D @vitest/coverage-v8` (not installed yet — see the
      // follow-up task in TASK_NOTES). No global percentage gate on this first
      // pass: 200+ src files are still untested, so a repo-wide threshold would
      // only ever be a red X. The bar for now is behavioural — every exported
      // function in the modules listed below has assertions.
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/context/CartContext.tsx',
        'src/utils/founder-earnings.ts',
        'src/lib/itc-pricing.ts',
      ],
    },
  },
})
