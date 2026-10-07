// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('../../lib/api', () => ({
  imaginationApi: new Proxy({}, { get: () => vi.fn(async () => ({ data: {} })) }),
  apiFetch: vi.fn(async () => ({})),
}))

import MrImagineModal from './MrImagineModal'

afterEach(cleanup)

const props = {
  onClose: vi.fn(),
  pricing: { autoNest: 0, smartFill: 0, aiGeneration: 5, removeBackground: 0, upscale2x: 0, upscale4x: 0, enhance: 0 },
  freeTrials: { aiGeneration: 2, removeBackground: 0, upscale: 0, enhance: 0 },
  itcBalance: 0,
  onImageGenerated: vi.fn(),
}

const promptBox = () => document.querySelector('textarea') as HTMLTextAreaElement | null

describe('MrImagineModal initialPrompt', () => {
  it('opens with the idea the station handed it', () => {
    render(<MrImagineModal {...props} isOpen initialPrompt="a tiger in sunglasses" />)
    expect(promptBox()?.value).toBe('a tiger in sunglasses')
  })

  it('opens empty when no idea was handed over', () => {
    render(<MrImagineModal {...props} isOpen />)
    expect(promptBox()?.value).toBe('')
  })
})
