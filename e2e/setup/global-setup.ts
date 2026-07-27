import type { Browser } from 'puppeteer'
import type { GlobalSetupContext } from 'vitest/node'

// NOTE: this file used to `import { chromium, Browser } from 'playwright'`.
// playwright is NOT a dependency of this repo — puppeteer is, and puppeteer is
// what e2e/ai-product-builder.test.ts actually launches. The bad import only
// survived because `chromium` was unused and esbuild elides unused imports; it
// would have thrown the moment anyone referenced it, and it made the declared
// ProvidedContext type resolve against a package that isn't installed.

declare module 'vitest' {
  export interface ProvidedContext {
    browser: Browser
    baseUrl: string
  }
}

export default async function globalSetup(_ctx: GlobalSetupContext) {
  // Global setup for E2E tests
  console.log('\n🚀 Starting E2E test suite...')
  console.log('📍 Base URL:', process.env.E2E_BASE_URL || 'http://localhost:5173')
  console.log('📍 API URL:', process.env.VITE_API_BASE || 'http://localhost:4000')
}

export async function teardown() {
  console.log('\n🏁 E2E test suite completed')
}
