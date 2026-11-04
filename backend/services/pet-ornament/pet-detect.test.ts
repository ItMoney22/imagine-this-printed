// Pet type off the buyer's photo (task 5d007181). The decision is pure; the one
// network call is swapped out.
import { describe, it, expect, afterEach } from 'vitest'
import { PETS } from '../../shared/pet-ornament.js'
import { decidePet, detectPet, parseVision, petPrompt, petVisionDeps, type PetVision } from './pet-detect.js'

const v = (over: Partial<PetVision> = {}): PetVision => ({ animal: 'dog', closest: 'dog', visible: true, confidence: 0.95, modelId: 'test-model', ...over })

describe('decidePet', () => {
  it("uses the model's pet when it is sure", () => {
    const d = decidePet(PETS, v())
    expect(d).toMatchObject({ pet: 'dog', source: 'vision', usable: true, uncertain: false })
    expect(d.reason).toBe('photo shows a dog (95% sure)')
  })

  it('maps a breed or a rabbit to the stock shape and says so', () => {
    expect(decidePet(PETS, v({ animal: 'golden retriever' })).reason).toBe('photo shows a golden retriever; closest shape dog (95% sure)')
    expect(decidePet(PETS, v({ animal: 'rabbit', closest: 'bunny' })).reason).toBe('photo shows a rabbit (95% sure)')
  })

  it('uses the closest shape for another animal but asks a person when unsure', () => {
    const d = decidePet(PETS, v({ animal: 'hamster', closest: 'bunny', confidence: 0.4 }))
    expect(d).toMatchObject({ pet: 'bunny', source: 'vision', usable: true, uncertain: true })
  })

  it('holds the order when no animal can be seen', () => {
    const d = decidePet(PETS, v({ animal: 'none', closest: 'cat', visible: false }))
    expect(d).toMatchObject({ usable: false, uncertain: true })
    expect(d.reason).toMatch(/no pet could be seen/)
  })

  it('falls back to the first stock pet, flagged, when the model cannot answer', () => {
    expect(decidePet(PETS, null, 'no OPENAI_API_KEY')).toMatchObject({ pet: 'cat', source: 'default', usable: true, uncertain: true })
    expect(decidePet(PETS, v({ animal: 'parrot', closest: null }))).toMatchObject({ pet: 'cat', source: 'default', uncertain: true })
  })

  it("never picks a pet the product does not offer", () => {
    const catsOnly = PETS.filter((p) => p.id !== 'dog')
    expect(decidePet(catsOnly, v({ closest: 'dog' }))).toMatchObject({ pet: 'cat', source: 'default' })
  })
})

describe('parseVision', () => {
  it('reads the JSON answer and clamps the confidence', () => {
    expect(parseVision('{"animal":" Tabby Cat ","closest":"Cat","pet_visible":true,"confidence":1.7}', PETS, 'm')).toEqual({
      animal: 'tabby cat', closest: 'cat', visible: true, confidence: 1, modelId: 'm',
    })
  })

  it('refuses anything malformed rather than guessing', () => {
    expect(parseVision('not json', PETS, 'm')).toBeNull()
    expect(parseVision('{"animal":"cat","closest":"cat"}', PETS, 'm')).toBeNull() // no pet_visible
    expect(parseVision('', PETS, 'm')).toBeNull()
    expect(parseVision('{"animal":"cat","closest":"lion","pet_visible":true,"confidence":0.9}', PETS, 'm')?.closest).toBeNull()
  })

  it("asks only for the product's own pets", () => {
    expect(petPrompt(PETS)).toContain('the closest of: cat, dog, bunny')
  })
})

describe('detectPet', () => {
  const real = petVisionDeps.look
  afterEach(() => { petVisionDeps.look = real })

  it('never throws: a vision failure is the flagged default', async () => {
    petVisionDeps.look = async () => { throw new Error('rate limited') }
    const d = await detectPet(Buffer.from('x'), PETS)
    expect(d).toMatchObject({ pet: 'cat', source: 'default', usable: true, uncertain: true })
    expect(d.reason).toContain('rate limited')
  })

  it('passes a good answer through', async () => {
    petVisionDeps.look = async () => v({ animal: 'cat', closest: 'cat' })
    expect((await detectPet(Buffer.from('x'), PETS)).pet).toBe('cat')
  })
})
