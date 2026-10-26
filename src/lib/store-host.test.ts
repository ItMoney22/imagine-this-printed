import { describe, it, expect } from 'vitest'
import { storeSlugFromHost } from './store-host'

describe('storeSlugFromHost', () => {
  it('reads the store from its subdomain', () => {
    expect(storeSlugFromHost('crystal.imaginethisprinted.com')).toBe('crystal')
    expect(storeSlugFromHost('Crystal.ImagineThisPrinted.com')).toBe('crystal')
  })
  it('never treats ITP itself as a store', () => {
    expect(storeSlugFromHost('imaginethisprinted.com')).toBeNull()
    expect(storeSlugFromHost('www.imaginethisprinted.com')).toBeNull()
    expect(storeSlugFromHost('api.imaginethisprinted.com')).toBeNull()
    expect(storeSlugFromHost('localhost')).toBeNull()
    expect(storeSlugFromHost('crystal.imaginethisprinted.com.evil.com')).toBeNull()
  })
})
