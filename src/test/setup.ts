import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Deliberately NOT using vitest `globals: true`, so React Testing Library's
// auto-cleanup (which only registers itself when a global afterEach exists)
// never fires. Wiring it explicitly here keeps test files free of ambient
// globals — they import { describe, it, expect } from 'vitest' like normal
// modules, which also means tsc -b typechecks them without extra `types` entries.
afterEach(() => {
  cleanup()
  // CartContext persists to localStorage on every state change. Without this,
  // a cart from one test rehydrates into the next one's provider.
  window.localStorage.clear()
})
