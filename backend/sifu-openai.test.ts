import { describe, it, expect, vi } from 'vitest'
import { applySifuAnswer, askSifu, loadOpenAIKeyFromSifu, SIFU_OPENAI_URL } from './sifu-openai'

// The store's OpenAI key comes from Sifu at boot (task bef81073). What matters:
//   1. No SIFU_APP_TOKEN = nothing changes (the cut-over is switched on by setting the token on Render).
//   2. A grant replaces the env key; a refusal blanks it (AI off, store up); unreachable keeps the break-glass copy.
//   3. The key never reaches a log line.
const FIXTURE = 'fixture-store-value-0001' // never shaped like a real key

describe('loadOpenAIKeyFromSifu', () => {
  it('does nothing without SIFU_APP_TOKEN', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'from-env' }
    const ask = vi.fn()
    loadOpenAIKeyFromSifu(env, ask)
    expect(ask).not.toHaveBeenCalled()
    expect(env.OPENAI_API_KEY).toBe('from-env')
  })

  it('asks the production route by default, or SIFU_OPENAI_URL when set', () => {
    const ask = vi.fn(() => ({ status: 200, granted: true, key: FIXTURE }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadOpenAIKeyFromSifu({ SIFU_APP_TOKEN: 't' }, ask)
    loadOpenAIKeyFromSifu({ SIFU_APP_TOKEN: 't', SIFU_OPENAI_URL: 'http://localhost:3001/api/sifu/openai-app' }, ask)
    expect(ask.mock.calls.map((c) => c[0])).toEqual([SIFU_OPENAI_URL, 'http://localhost:3001/api/sifu/openai-app'])
    expect(log.mock.calls.flat().join(' ')).not.toContain(FIXTURE)
    log.mockRestore()
  })
})

describe('applySifuAnswer', () => {
  it('a grant replaces whatever the env held', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'from-env' }
    const line = applySifuAnswer(env, { status: 200, granted: true, key: FIXTURE })
    expect(env.OPENAI_API_KEY).toBe(FIXTURE)
    expect(line).not.toContain(FIXTURE)
  })

  it('a refusal blanks the key even when the env had one: Sifu cut the store off', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'from-env' }
    expect(applySifuAnswer(env, { status: 403, granted: false, reason: 'stray' })).toContain('refused')
    expect(env.OPENAI_API_KEY).toBe('')
  })

  it('Sifu unreachable keeps the break-glass env key, or blanks it when there is none', () => {
    const kept: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'from-env' }
    expect(applySifuAnswer(kept, { status: 404 })).toContain('break-glass')
    expect(kept.OPENAI_API_KEY).toBe('from-env')
    const none: NodeJS.ProcessEnv = {}
    expect(applySifuAnswer(none, { status: 0, error: 'ECONNREFUSED' })).toContain('AI features are off')
    expect(none.OPENAI_API_KEY).toBe('')
  })
})

describe('askSifu', () => {
  it('reports an unreachable Sifu as status 0 instead of throwing', () => {
    const a = askSifu('http://127.0.0.1:9/api/sifu/openai-app', 'fixture-token')
    expect(a.status).toBe(0)
  })
})
