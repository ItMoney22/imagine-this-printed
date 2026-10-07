import { describe, it, expect } from 'vitest'
import { REAL_KEYS } from './vitest.hermetic-env'

// The setup file runs before this file loads, so a key exported by the caller
// (zero-engine exports david-trinidad-com's) is already gone here (task e086c595).
describe('hermetic test env', () => {
  it('no real provider or outbound key reaches a test', () => {
    for (const key of REAL_KEYS) expect(process.env[key], key).toBeUndefined()
  })

  it('covers the key that made the Etsy repair tests call a paid model', () => {
    expect(REAL_KEYS).toContain('OPENAI_API_KEY')
    expect(REAL_KEYS).toContain('OPENROUTER_API_KEY')
  })
})
