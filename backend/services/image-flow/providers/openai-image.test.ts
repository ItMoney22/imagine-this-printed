// Tests for the OpenAI-direct image provider's model chain.
//
// WHY A CHAIN AT ALL
// OpenAI ships image models faster than this account gets access to them
// (gpt-image-2.5 landed while the code still hardcoded gpt-image-2, which had
// itself replaced gpt-image-1 the same way). Every house pipeline — the Step
// Flow's on-person shots, the admin product builder, Imagination Station's
// premium tier, the metal mockups — comes through these two functions, so the
// preference order lives here once instead of in each of them.
//
// The two properties that matter are opposites of each other:
//   1. a model this account cannot see must fall through to the next one, so a
//      newly-announced model can be made the default before access lands, and
//   2. any OTHER failure must NOT fall through — a moderation block or a rate
//      limit re-sent down the chain is the same rejected prompt paid for three
//      times.

import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.OPENAI_API_KEY ||= 'test-key'

const generate = vi.fn()
const edit = vi.fn()

vi.mock('openai', () => {
  class FakeOpenAI {
    images = { generate, edit }
  }
  return {
    default: FakeOpenAI,
    toFile: async (buf: any, name: string, o: any) => ({ buf, name, ...o }),
  }
})

vi.mock('../../google-cloud-storage.js', () => ({
  uploadImageFromBase64: async (_data: string, path: string) => ({ publicUrl: `https://cdn.test/${path}` }),
}))

const {
  runOpenAIImage,
  editOpenAIImage,
  resolveModelChain,
  isModelUnavailable,
  clearModelAvailabilityCache,
  paramsForModel,
  DEFAULT_OPENAI_IMAGE_CHAIN,
  OPENAI_IMAGE_PRECISION_MODEL,
} = await import('./openai-image.js')

/** An OpenAI "this account can't use that model" rejection. */
function modelMissing(model: string): any {
  const err: any = new Error(`The model \`${model}\` does not exist or you do not have access to it.`)
  err.status = 404
  err.error = { code: 'model_not_found', message: err.message }
  return err
}

/** A content-filter rejection that happens to name the model — the trap the old predicate fell into. */
function moderationBlocked(model: string): any {
  const err: any = new Error(`Your request was rejected by the safety system (model: ${model}).`)
  err.status = 400
  err.error = { code: 'moderation_blocked', message: err.message }
  return err
}

const ok = { data: [{ b64_json: 'aGVsbG8=' }] }

beforeEach(() => {
  generate.mockReset()
  edit.mockReset()
  clearModelAvailabilityCache()
  global.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
    headers: { get: () => 'image/png' },
  })) as any
})

describe('the default chain', () => {
  it('leads with GPT Image 2.5 Flare and keeps the older models behind it', () => {
    // Flare is OpenAI's fast/high-quality default; the two behind it are what
    // this account was already using, so losing 2.5 access degrades instead of
    // breaking.
    expect(DEFAULT_OPENAI_IMAGE_CHAIN).toEqual(['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1'])
  })

  it('names the precision model for the call sites that want detail over speed', () => {
    expect(OPENAI_IMAGE_PRECISION_MODEL).toBe('gpt-image-2.5-sunburst')
  })
})

describe('resolveModelChain', () => {
  it('puts a pinned model first and keeps the rest as fallbacks', () => {
    expect(resolveModelChain('gpt-image-2.5-sunburst', ['a', 'b'])).toEqual(['gpt-image-2.5-sunburst', 'a', 'b'])
  })

  it('does not repeat a pinned model that is already in the chain', () => {
    expect(resolveModelChain('b', ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('falls back to the configured chain when nothing is pinned', () => {
    expect(resolveModelChain(undefined, ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('isModelUnavailable', () => {
  it('is true for a model this account cannot see', () => {
    expect(isModelUnavailable(modelMissing('gpt-image-2.5-flare'))).toBe(true)
  })

  it('is FALSE for a moderation block that merely names the model', () => {
    // The old predicate matched the literal string "gpt-image-2" anywhere in
    // the message, so a safety rejection quoting the model sent the same
    // prompt down the chain and paid for it again.
    expect(isModelUnavailable(moderationBlocked('gpt-image-2.5-flare'))).toBe(false)
  })

  it('is false for a rate limit', () => {
    const err: any = new Error('Rate limit reached')
    err.status = 429
    expect(isModelUnavailable(err)).toBe(false)
  })
})

describe('runOpenAIImage', () => {
  it('generates with the head of the chain and reports which model ran', async () => {
    generate.mockResolvedValueOnce(ok)

    const r = await runOpenAIImage({ prompt: 'a cat' })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][0].model).toBe('gpt-image-2.5-flare')
    expect(r.modelId).toBe('openai/gpt-image-2.5-flare')
  })

  it('walks to the next model when the first is not available to this account', async () => {
    generate.mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare')).mockResolvedValueOnce(ok)

    const r = await runOpenAIImage({ prompt: 'a cat' })

    expect(generate.mock.calls.map((c: any[]) => c[0].model)).toEqual(['gpt-image-2.5-flare', 'gpt-image-2'])
    expect(r.modelId).toBe('openai/gpt-image-2')
  })

  it('does NOT retry a moderation block down the chain', async () => {
    generate.mockRejectedValueOnce(moderationBlocked('gpt-image-2.5-flare'))

    await expect(runOpenAIImage({ prompt: 'a cat' })).rejects.toThrow(/safety system/)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('throws the last error when no model in the chain is available', async () => {
    generate
      .mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare'))
      .mockRejectedValueOnce(modelMissing('gpt-image-2'))
      .mockRejectedValueOnce(modelMissing('gpt-image-1'))

    await expect(runOpenAIImage({ prompt: 'a cat' })).rejects.toThrow(/gpt-image-1/)
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('honours a pinned model', async () => {
    generate.mockResolvedValueOnce(ok)

    const r = await runOpenAIImage({ prompt: 'a cat', model: 'gpt-image-2.5-sunburst' })

    expect(generate.mock.calls[0][0].model).toBe('gpt-image-2.5-sunburst')
    expect(r.modelId).toBe('openai/gpt-image-2.5-sunburst')
  })

  it('passes the 2.5-only quality tiers straight through', async () => {
    generate.mockResolvedValueOnce(ok)
    await runOpenAIImage({ prompt: 'a cat', quality: 'xhigh' })
    expect(generate.mock.calls[0][0].quality).toBe('xhigh')
  })

  it('passes a custom 2.5 resolution straight through', async () => {
    generate.mockResolvedValueOnce(ok)
    await runOpenAIImage({ prompt: 'a cat', size: '1536x864' })
    expect(generate.mock.calls[0][0].size).toBe('1536x864')
  })
})

describe('editOpenAIImage', () => {
  it('edits with the head of the chain', async () => {
    edit.mockResolvedValueOnce(ok)

    const r = await editOpenAIImage({ sourceUrl: 'https://cdn/a.png', prompt: 'put it on a shirt' })

    expect(edit.mock.calls[0][0].model).toBe('gpt-image-2.5-flare')
    expect(r.modelId).toBe('openai/gpt-image-2.5-flare')
  })

  it('falls through on an unavailable model, carrying the same inputs', async () => {
    edit.mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare')).mockResolvedValueOnce(ok)

    const r = await editOpenAIImage({
      sourceUrl: 'https://cdn/a.png',
      refUrls: ['https://cdn/b.png'],
      prompt: 'composite',
    })

    expect(r.modelId).toBe('openai/gpt-image-2')
    // Both reference images survive the retry — a fallback that dropped the
    // second input would silently stop compositing.
    expect(edit.mock.calls[1][0].image).toHaveLength(2)
  })

  it('does NOT retry a moderation block down the chain', async () => {
    edit.mockRejectedValueOnce(moderationBlocked('gpt-image-2.5-flare'))

    await expect(
      editOpenAIImage({ sourceUrl: 'https://cdn/a.png', prompt: 'x' })
    ).rejects.toThrow(/safety system/)
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('fetches each source image only once, no matter how far it falls back', async () => {
    // The files are read before the first attempt and reused. Re-fetching per
    // attempt would triple the egress on every fallback.
    edit.mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare')).mockResolvedValueOnce(ok)

    await editOpenAIImage({ sourceUrl: 'https://cdn/a.png', prompt: 'x' })

    expect((global.fetch as any).mock.calls).toHaveLength(1)
  })
})

describe('the unavailable-model cache', () => {
  it('stops re-probing a model this key cannot use', async () => {
    // The whole point: leading the chain with a model the account lacks must
    // not add a wasted round-trip to every render for the rest of the day.
    generate.mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare')).mockResolvedValueOnce(ok)
    await runOpenAIImage({ prompt: 'one' })
    expect(generate.mock.calls.map((c: any[]) => c[0].model)).toEqual(['gpt-image-2.5-flare', 'gpt-image-2'])

    generate.mockResolvedValueOnce(ok)
    const second = await runOpenAIImage({ prompt: 'two' })

    // Second call skips the known-missing head entirely.
    expect(generate.mock.calls.slice(2).map((c: any[]) => c[0].model)).toEqual(['gpt-image-2'])
    expect(second.modelId).toBe('openai/gpt-image-2')
  })

  it('forgets the note as soon as the model answers again', async () => {
    generate.mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare')).mockResolvedValueOnce(ok)
    await runOpenAIImage({ prompt: 'one' })

    // Access lands. A pinned call proves it works, which must clear the note.
    generate.mockResolvedValueOnce(ok)
    await runOpenAIImage({ prompt: 'two', model: 'gpt-image-2.5-flare' })

    generate.mockResolvedValueOnce(ok)
    const third = await runOpenAIImage({ prompt: 'three' })
    expect(third.modelId).toBe('openai/gpt-image-2.5-flare')
  })

  it('still makes one real call when every model is cached unavailable', async () => {
    // Stale local bookkeeping must never be the thing that fails a render —
    // the real API error is always more informative than our own cache.
    generate
      .mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare'))
      .mockRejectedValueOnce(modelMissing('gpt-image-2'))
      .mockRejectedValueOnce(modelMissing('gpt-image-1'))
    await expect(runOpenAIImage({ prompt: 'one' })).rejects.toThrow()

    generate.mockRejectedValueOnce(modelMissing('gpt-image-1'))
    await expect(runOpenAIImage({ prompt: 'two' })).rejects.toThrow(/gpt-image-1/)
    expect(generate.mock.calls.slice(3).map((c: any[]) => c[0].model)).toEqual(['gpt-image-1'])
  })

  it('shares the cache with the edit path', async () => {
    generate.mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare')).mockResolvedValueOnce(ok)
    await runOpenAIImage({ prompt: 'warm the cache' })

    edit.mockResolvedValueOnce(ok)
    const r = await editOpenAIImage({ sourceUrl: 'https://cdn/a.png', prompt: 'x' })

    expect(edit.mock.calls.map((c: any[]) => c[0].model)).toEqual(['gpt-image-2'])
    expect(r.modelId).toBe('openai/gpt-image-2')
  })
})

describe('paramsForModel', () => {
  it('leaves a 2.5 request untouched', () => {
    const p = { quality: 'max', size: '1536x864' }
    expect(paramsForModel('gpt-image-2.5-flare', p)).toEqual(p)
  })

  it('downgrades the 2.5-only quality tiers for an older model', () => {
    // Otherwise a fallback turns into a hard 400 and the render just fails.
    expect(paramsForModel('gpt-image-2', { quality: 'xhigh' }).quality).toBe('high')
    expect(paramsForModel('gpt-image-2', { quality: 'max' }).quality).toBe('high')
  })

  it('keeps an ordinary quality as-is', () => {
    expect(paramsForModel('gpt-image-2', { quality: 'high' }).quality).toBe('high')
    expect(paramsForModel('gpt-image-1', { quality: 'low' }).quality).toBe('low')
  })

  it('snaps a free-form size to the nearest standard frame, keeping orientation', () => {
    // A landscape request must never come back portrait.
    expect(paramsForModel('gpt-image-2', { size: '1536x864' }).size).toBe('1536x1024')
    expect(paramsForModel('gpt-image-2', { size: '864x1536' }).size).toBe('1024x1536')
    expect(paramsForModel('gpt-image-2', { size: '2048x2048' }).size).toBe('1024x1024')
  })

  it('leaves the standard sizes alone', () => {
    for (const size of ['1024x1024', '1536x1024', '1024x1536', 'auto']) {
      expect(paramsForModel('gpt-image-2', { size }).size).toBe(size)
    }
  })

  it('applies the downgrade on the model that actually runs, not the one asked for', async () => {
    generate.mockRejectedValueOnce(modelMissing('gpt-image-2.5-flare')).mockResolvedValueOnce(ok)

    await runOpenAIImage({ prompt: 'a cat', quality: 'max', size: '1536x864' })

    expect(generate.mock.calls[0][0]).toMatchObject({ quality: 'max', size: '1536x864' })
    expect(generate.mock.calls[1][0]).toMatchObject({ quality: 'high', size: '1536x1024' })
  })
})
