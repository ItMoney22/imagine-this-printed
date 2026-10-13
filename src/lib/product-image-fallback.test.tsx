// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PRODUCT_IMAGE_FALLBACK, showProductImageFallback } from './product-image-fallback'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Guard: a product image that failed to load showed a stranger's unsplash stock tee as if it were
// our product, hotlinked from their host, on the catalog, product page, cart and mini cart until
// 2026-10-13 (task 227293bd). No file in src may reference the stock host again; a broken image
// shows ITP's own tile. The host is built from parts so this file does not trip its own scan.
const STOCK_HOST = ['images', 'unsplash', 'com'].join('.')
const SOURCES = import.meta.glob('../**/*.{ts,tsx,js,jsx,css,html,md,svg,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('no stock-photo host in src', () => {
  it('scans every source file', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(300)
    expect(Object.keys(SOURCES)).toContain('../components/ProductCard.tsx')
  })

  it(`finds no ${STOCK_HOST} reference`, () => {
    const hits: string[] = []
    for (const [file, text] of Object.entries(SOURCES)) {
      text.split(/\r?\n/).forEach((line, i) => {
        if (line.includes(STOCK_HOST)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits, 'stock photo host in src; use PRODUCT_IMAGE_FALLBACK from src/lib/product-image-fallback.ts').toEqual([])
  })

  it('the four product image call sites share the one fallback, with no local copy', () => {
    for (const file of ['../components/ProductCard.tsx', '../pages/Cart.tsx', '../pages/ProductPage.tsx', '../components/FloatingCart.tsx']) {
      expect(SOURCES[file], file).toMatch(/import \{ PRODUCT_IMAGE_FALLBACK, showProductImageFallback \} from '\.\.\/lib\/product-image-fallback'/)
      expect(SOURCES[file], file).not.toMatch(/const FALLBACK\b|https?:\/\/[^'"`\s]*\?w=\d+&h=\d+&fit=crop/)
    }
  })
})

describe('ITP image fallback', () => {
  it('is a local file this repo ships, not a third-party URL', () => {
    expect(PRODUCT_IMAGE_FALLBACK).toMatch(/^\/[\w/-]+\.svg$/)
    const svg = readFileSync(resolve(__dirname, '../../public', `.${PRODUCT_IMAGE_FALLBACK}`), 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/)
  })

  it('swaps a broken product image to the ITP tile', () => {
    render(<img src="https://storage.googleapis.invalid/broken.png" alt="Lion tee" onError={showProductImageFallback} />)
    const img = screen.getByAltText('Lion tee') as HTMLImageElement
    fireEvent.error(img)
    expect(img.getAttribute('src')).toBe(PRODUCT_IMAGE_FALLBACK)
  })

  it('does not loop when the tile itself fails', () => {
    render(<img src="https://storage.googleapis.invalid/broken.png" alt="Lion tee" onError={showProductImageFallback} />)
    const img = screen.getByAltText('Lion tee') as HTMLImageElement
    const setSrc = vi.spyOn(img, 'src', 'set')
    fireEvent.error(img)
    fireEvent.error(img)
    expect(setSrc).toHaveBeenCalledTimes(1)
    expect(img.getAttribute('src')).toBe(PRODUCT_IMAGE_FALLBACK)
  })
})
