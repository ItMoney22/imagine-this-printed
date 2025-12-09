import { chromium, Browser } from 'playwright'
import type { GlobalSetupContext } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    browser: Browser
    baseUrl: string
  }
}

export default async function globalSetup(ctx: GlobalSetupContext) {
  // Global setup for E2E tests
  console.log('\n🚀 Starting E2E test suite...')
  console.log('📍 Base URL:', process.env.E2E_BASE_URL || 'http://localhost:5173')
  console.log('📍 API URL:', process.env.VITE_API_BASE || 'http://localhost:4000')
}

export async function teardown() {
  console.log('\n🏁 E2E test suite completed')
}
