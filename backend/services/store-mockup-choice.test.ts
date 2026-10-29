import { describe, it, expect } from 'vitest'
import { mockupAsk, mockupChoice, mockupLabel } from './store-mockup-choice.js'

// Her words read for a mockup (task 820ff916): "mock this on a shirt" must work even when the assistant misses it,
// and only for what ITP makes.
describe('mockupAsk', () => {
  it('reads "mock this on a shirt" as a tee, colour picked later', () => {
    expect(mockupAsk('mock this on a shirt')).toEqual({ product: 'tshirt', color: null, size: null })
    expect(mockupAsk('Can you make a mockup of this?')).toEqual({ product: 'tshirt', color: null, size: null })
  })

  it('takes the product and colour she names', () => {
    expect(mockupAsk('put it on a white hoodie')).toEqual({ product: 'hoodie', color: 'white', size: null })
    expect(mockupAsk('show me this on a navy tee')).toEqual({ product: 'tshirt', color: 'navy', size: null })
    expect(mockupAsk('mock it up on a kids shirt in red')).toEqual({ product: 'youth-tshirt', color: 'red', size: null })
    expect(mockupAsk('ponlo en una camisa negra')).toEqual({ product: 'tshirt', color: 'black', size: null })
  })

  it('a metal print takes a size, never a colour', () => {
    expect(mockupAsk('mock this on a metal print')).toEqual({ product: 'metal', color: null, size: '8x10' })
    expect(mockupAsk('mock it on a small 4x6 black metal sign')).toEqual({ product: 'metal', color: null, size: '4x6' })
  })

  it('stays out of what ITP does not make, and of ordinary questions', () => {
    expect(mockupAsk('mock this on a mug')).toBeNull()
    expect(mockupAsk('put it on a polo')).toBeNull()
    expect(mockupAsk('Write a description for my new shirt')).toBeNull()
    expect(mockupAsk('How did I do this week?')).toBeNull()
    expect(mockupAsk('')).toBeNull()
  })

  it('drops a colour a garment is not sold in (royal blue hoodie)', () => {
    expect(mockupAsk('mock this on a royal blue hoodie')).toEqual({ product: 'hoodie', color: null, size: null })
  })
})

describe('mockupChoice', () => {
  it('keeps only what ITP makes from what the assistant asked for', () => {
    expect(mockupChoice({ product: 'tshirt', color: 'heather-grey' })).toEqual({ product: 'tshirt', color: 'heather-grey', size: null })
    expect(mockupChoice({ product: 'metal', color: 'black', size: '4x6' })).toEqual({ product: 'metal', color: null, size: '4x6' })
    expect(mockupChoice({ product: 'polo' })).toBeNull()
    expect(mockupChoice({ product: 'tshirt', color: 'purple' })).toEqual({ product: 'tshirt', color: null, size: null })
    expect(mockupChoice(null)).toBeNull()
  })
})

describe('mockupLabel', () => {
  it('reads as a product in a sentence', () => {
    expect(mockupLabel({ product: 'tshirt', color: 'black' })).toBe('black tee')
    expect(mockupLabel({ product: 'youth-tshirt', color: 'heather-grey' })).toBe('heather grey kids tee')
    expect(mockupLabel({ product: 'hoodie' })).toBe('hoodie')
    expect(mockupLabel({ product: 'metal', size: '4x6' })).toBe('4 x 6 metal print')
  })
})
