import { describe, it, expect } from 'vitest'
import {
  TUMBLER_SIZE_MATRIX,
  ALL_TUMBLER_SPECS,
  DEFAULT_TUMBLER_SPEC,
  normalizeTumblerSizeKey,
  isTumblerCategory,
  resolveTumblerSpecs,
} from './tumbler-sizing'
import type { Product } from '../types'

const mockProduct = (over: Partial<Product>) => over as Product

describe('tumbler-sizing matrix', () => {
  it('contains canonical specifications for standard tumbler models', () => {
    expect(TUMBLER_SIZE_MATRIX['20oz']).toBeDefined()
    expect(TUMBLER_SIZE_MATRIX['30oz']).toBeDefined()
    expect(TUMBLER_SIZE_MATRIX['12oz']).toBeDefined()
    expect(TUMBLER_SIZE_MATRIX['40oz']).toBeDefined()
  })

  it('specifies complete dimensions and liquid capacity in both imperial and metric', () => {
    const twenty = TUMBLER_SIZE_MATRIX['20oz']
    expect(twenty.volumeOz).toBe(20)
    expect(twenty.volumeMl).toBe(590)
    expect(twenty.dimensions.heightInches).toBe(8.25)
    expect(twenty.dimensions.heightCm).toBe(21.0)
    expect(twenty.dimensions.baseDiameterInches).toBe(2.9)
    expect(twenty.dimensions.baseDiameterCm).toBe(7.4)
    expect(twenty.cupHolderFit.fits).toBe(true)
    expect(twenty.cupHolderFit.rating).toBe('Universal')
  })

  it('verifies 30oz and 40oz have vehicle cup-holder fit specifications', () => {
    const thirty = TUMBLER_SIZE_MATRIX['30oz']
    const forty = TUMBLER_SIZE_MATRIX['40oz']
    expect(thirty.cupHolderFit.fits).toBe(true)
    expect(forty.cupHolderFit.fits).toBe(true)
    expect(thirty.dimensions.baseDiameterInches).toBeLessThanOrEqual(3.0)
    expect(forty.dimensions.baseDiameterInches).toBeLessThanOrEqual(3.0)
  })
})

describe('normalizeTumblerSizeKey', () => {
  it('normalizes various size strings into matrix keys', () => {
    expect(normalizeTumblerSizeKey('20oz')).toBe('20oz')
    expect(normalizeTumblerSizeKey('20 oz')).toBe('20oz')
    expect(normalizeTumblerSizeKey('20-OZ')).toBe('20oz')
    expect(normalizeTumblerSizeKey('Skinny 20 oz Tumbler')).toBe('20oz')
    expect(normalizeTumblerSizeKey('30 oz')).toBe('30oz')
    expect(normalizeTumblerSizeKey('12 oz Wine')).toBe('12oz')
    expect(normalizeTumblerSizeKey('40 oz Handle')).toBe('40oz')
    expect(normalizeTumblerSizeKey(null)).toBeNull()
    expect(normalizeTumblerSizeKey('unknown')).toBeNull()
  })
})

describe('isTumblerCategory', () => {
  it('detects tumblers from category or metadata', () => {
    expect(isTumblerCategory('tumblers')).toBe(true)
    expect(isTumblerCategory('tumbler')).toBe(true)
    expect(isTumblerCategory('Custom Tumblers')).toBe(true)
    expect(isTumblerCategory('shirts', { product_template: 'tumblers' })).toBe(true)
    expect(isTumblerCategory('shirts', { product_template: 'shirt' })).toBe(false)
    expect(isTumblerCategory('shirts', null)).toBe(false)
  })
})

describe('resolveTumblerSpecs', () => {
  it('defaults to 20oz flagship when product has no sizes specified', () => {
    const result = resolveTumblerSpecs(mockProduct({ category: 'tumblers' }))
    expect(result.applicableSizes).toHaveLength(1)
    expect(result.applicableSizes[0].id).toBe('20oz')
    expect(result.defaultSpec.id).toBe('20oz')
    expect(result.allSizes).toHaveLength(4)
    expect(result.hasCustomMetadata).toBe(false)
  })

  it('resolves product sizes column into matching specs', () => {
    const result = resolveTumblerSpecs(mockProduct({
      category: 'tumblers',
      sizes: ['20 oz', '30 oz'],
    }))
    expect(result.applicableSizes).toHaveLength(2)
    expect(result.applicableSizes.map(s => s.id)).toEqual(['20oz', '30oz'])
    expect(result.defaultSpec.id).toBe('20oz')
  })

  it('merges custom metadata attributes if present', () => {
    const result = resolveTumblerSpecs(mockProduct({
      category: 'tumblers',
      sizes: ['20 oz'],
      metadata: {
        tumbler_specs: {
          '20oz': {
            bestFor: 'Custom event edition beverage holder',
          }
        }
      }
    }))
    expect(result.hasCustomMetadata).toBe(true)
    expect(result.applicableSizes[0].bestFor).toBe('Custom event edition beverage holder')
    // Base specs are preserved
    expect(result.applicableSizes[0].volumeOz).toBe(20)
  })
})
