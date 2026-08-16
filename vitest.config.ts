import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Vitest previously had no config of its own and fell through to vite.config.ts,
// which does:
//
//   define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production') }
//
// That define exists so the browser bundle gets React's production build. Under
// `vitest` it did the same thing: any shell exporting NODE_ENV=production (this
// project's Windows shells do) resolved `react` to react.production.js, which
// deliberately does NOT export `act`. @testing-library/react's act-compat then
// fell back to the react-dom/test-utils shim, whose production stub is literally
// `return React.act(callback)` — hence "TypeError: React.act is not a function".
//
// Note the runtime env was never the problem — vitest already sets
// process.env.NODE_ENV='test' inside the worker. The poison was purely the
// config-load-time read baked in by `define`. Pinning the define to 'test' is
// the whole fix.
export default mergeConfig(
  viteConfig,
  defineConfig({
    define: {
      'process.env.NODE_ENV': JSON.stringify('test')
    },
    test: {
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        // Only the modules that actually have tests. Deliberately NO global
        // threshold — a repo-wide gate here would just be a number nobody can
        // move, and it would fail every run for reasons unrelated to the change
        // being made.
        include: [
          'src/context/CartContext.tsx',
          'src/utils/wholesale-pricing.ts',
          'src/utils/shipping-calculator.ts',
          'src/utils/dpi-calculator.ts',
          'src/utils/cost-management.ts',
          'src/lib/product-kind.ts'
        ],
        // FLOORS, not targets, measured from the first real `npm test -- --coverage`
        // run (2026-08-16) and set a few points below the observed numbers so the
        // gate survives normal test-order/branch-count noise but still catches a
        // deleted or gutted suite.
        thresholds: {
          'src/context/CartContext.tsx': { statements: 70, branches: 40, functions: 75, lines: 70 },
          'src/utils/wholesale-pricing.ts': { statements: 90, branches: 90, functions: 95, lines: 90 },
          'src/utils/shipping-calculator.ts': { statements: 85, branches: 65, functions: 95, lines: 85 },
          'src/utils/dpi-calculator.ts': { statements: 85, branches: 75, functions: 95, lines: 85 },
          'src/utils/cost-management.ts': { statements: 65, branches: 90, functions: 75, lines: 65 },
          'src/lib/product-kind.ts': { statements: 95, branches: 90, functions: 95, lines: 95 }
        }
      }
    }
  })
)
