import { describe, it, expect } from 'vitest'
import { artworkIdFor, deriveDesignPrompt, isTrackableDesign, normalizePrompt } from './design-prompt'

describe('deriveDesignPrompt', () => {
  it('uses the image prompt as the variant and the shopper idea as the concept', () => {
    const info = deriveDesignPrompt({
      id: 'p1',
      metadata: {
        original_prompt: 'a lion roaring to the sky\nProduct Category: shirts',
        image_prompt: 'A majestic lion with a lush mane roaring at the sky.',
        model_id: 'google/imagen-4-ultra',
      },
    })
    expect(info.promptText).toBe('A majestic lion with a lush mane roaring at the sky.')
    expect(info.conceptLabel).toBe('a lion roaring to the sky')
    expect(info.modelId).toBe('google/imagen-4-ultra')
    expect(info.source).toBe('ai')
    expect(info.variantKey).toMatch(/^v_[0-9a-f]{24}$/)
  })

  it('puts two prompts for the same Step Flow idea under one concept', () => {
    const a = deriveDesignPrompt({ id: 'a', metadata: { step_flow: { idea: 'neon koi fish swimming through a galaxy' }, image_prompt: 'A single neon koi, glowing scales.' } })
    const b = deriveDesignPrompt({ id: 'b', metadata: { step_flow: { idea: 'Neon koi fish swimming through a galaxy!' }, image_prompt: 'Three neon koi circling a nebula.' } })
    expect(a.conceptKey).toBe(b.conceptKey)
    expect(a.variantKey).not.toBe(b.variantKey)
    expect(a.source).toBe('step_flow')
  })

  it('groups Mrs. Imagine designs by their brief', () => {
    const info = deriveDesignPrompt({ id: 'c', metadata: { brief_key: 'funny-cat-sarcastic-hoodie', original_prompt: 'A grumpy cat in a cowboy hat', mrs_imagine: true } })
    expect(info.conceptKey).toBe('brief:funny-cat-sarcastic-hoodie')
    expect(info.conceptLabel).toBe('Funny cat sarcastic hoodie')
    expect(info.source).toBe('mrs_imagine')
  })

  it('treats the same prompt on two garments as one variant, but a new model as a new one', () => {
    const tee = deriveDesignPrompt({ id: 't', metadata: { original_prompt: 'A cartoon gorilla', model_id: 'openai/gpt-image-2' } })
    const hoodie = deriveDesignPrompt({ id: 'h', metadata: { original_prompt: '  a cartoon gorilla. ', model_id: 'openai/gpt-image-2' } })
    const flux = deriveDesignPrompt({ id: 'f', metadata: { original_prompt: 'A cartoon gorilla', model_id: 'black-forest-labs/flux-2-pro' } })
    expect(tee.variantKey).toBe(hoodie.variantKey)
    expect(flux.variantKey).not.toBe(tee.variantKey)
    expect(flux.conceptKey).toBe(tee.conceptKey)
  })

  it('marks a library design as hand-made with no prompt', () => {
    const info = deriveDesignPrompt({ id: 'w', name: 'Bad Witch Vibes', metadata: { design_id: '013', collection: 'Halloween' } })
    expect(info.promptText).toBeNull()
    expect(info.source).toBe('library')
    expect(info.conceptKey).toBe('design:013')
    expect(info.variantKey).toBe('handmade:design-013')
    expect(info.conceptLabel).toBe('Bad Witch Vibes')
  })

  it('keeps a library design adopted into the Step Flow hand-made', () => {
    const info = deriveDesignPrompt({ id: 'r', name: 'Resting Witch Face', metadata: { design_id: '021', step_flow: { idea: 'Resting Witch Face' } } })
    expect(info.promptText).toBeNull()
    expect(info.source).toBe('library')
  })

  it('marks a creator upload as hand-made by its creator', () => {
    const info = deriveDesignPrompt({ id: 'x', name: 'Walk By Faith', metadata: { source: 'merch-studio' } })
    expect(info.source).toBe('creator')
    expect(info.variantKey).toBe('handmade:x')
  })
})

describe('normalizePrompt', () => {
  it('ignores case, spacing, trailing punctuation and the category line', () => {
    expect(normalizePrompt('A Lion  Roaring!\nProduct Category: shirts')).toBe('a lion roaring')
  })
})

describe('isTrackableDesign', () => {
  it('skips blank garments', () => {
    expect(isTrackableDesign({ id: 'b', metadata: { garment: { blank: true } } })).toBe(false)
    expect(isTrackableDesign({ id: 'd', metadata: {} })).toBe(true)
  })
})

describe('artworkIdFor', () => {
  it('prefers the newest design source asset', () => {
    expect(artworkIdFor({ id: 'p' }, [
      { id: 'old', created_at: '2026-09-01T00:00:00Z' },
      { id: 'new', created_at: '2026-10-01T00:00:00Z' },
    ])).toBe('new')
  })

  it('falls back to the library number, then the product', () => {
    expect(artworkIdFor({ id: 'p', metadata: { design_id: '021' } }, [])).toBe('library:021')
    expect(artworkIdFor({ id: 'p' }, [])).toBe('product:p')
  })
})
