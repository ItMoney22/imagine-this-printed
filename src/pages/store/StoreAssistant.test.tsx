// @vitest-environment jsdom
// Her store assistant panel (task 44f16c24): the chat comes from the server, the paperclip sends a picture with her
// message, and Make it a product runs the Step Flow's upload + adopt and opens Create a design on the new build.
// The API is faked; the fleet browser walk covers the real page (it cannot drive a native file picker).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  history: vi.fn(),
  ask: vi.fn(),
  design: vi.fn(),
  speak: vi.fn(),
  upload: vi.fn(),
  adopt: vi.fn(),
  discardDraft: vi.fn(),
  makeMockup: vi.fn(),
  mockupStatus: vi.fn(),
}))
vi.mock('../../lib/vendor-store', () => ({
  vendorStoreApi: { history: api.history, ask: api.ask, design: api.design, speak: api.speak, makeMockup: api.makeMockup, mockupStatus: api.mockupStatus },
}))
vi.mock('../../lib/api', () => ({
  customerStepFlow: { upload: api.upload, adopt: api.adopt, discardDraft: api.discardDraft },
}))

import StoreAssistant from './StoreAssistant'

afterEach(cleanup)
beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  // Replies are not read out in these tests.
  localStorage.setItem('vstore-assistant-speak', 'off')
  URL.createObjectURL = vi.fn(() => 'blob:local-preview')
  Element.prototype.scrollTo = vi.fn()
})

const panel = () => {
  const props = { slug: 'crystal', ownerFirst: 'Crystal', open: true, onClose: vi.fn(), onMakeProduct: vi.fn(), onNeedStudio: vi.fn() }
  render(<StoreAssistant {...props} />)
  return props
}

describe('StoreAssistant', () => {
  it('shows her saved chat with the assistant’s face beside replies', async () => {
    api.history.mockResolvedValue({
      messages: [
        { id: 'a', role: 'user', text: 'Hi!', createdAt: '2026-10-26T10:00:00Z' },
        { id: 'b', role: 'assistant', text: 'Hello Crystal', createdAt: '2026-10-26T10:00:01Z' },
      ],
    })
    const { container } = render(<StoreAssistant slug="crystal" ownerFirst="Crystal" faceUrl="/stores/crystal/assistant.webp" open onClose={vi.fn()} onMakeProduct={vi.fn()} onNeedStudio={vi.fn()} />)
    expect(await screen.findByText('Hello Crystal')).toBeTruthy()
    const faces = [...container.querySelectorAll('img')].filter(i => i.getAttribute('src') === '/stores/crystal/assistant.webp')
    expect(faces.length).toBe(2) // the header and the reply
  })

  it('introduces Rico by name, in Spanglish', async () => {
    api.history.mockResolvedValue({ messages: [] })
    render(<StoreAssistant slug="crystal" ownerFirst="Crystal" assistantName="Rico" open onClose={vi.fn()} onMakeProduct={vi.fn()} onNeedStudio={vi.fn()} />)
    expect(await screen.findByText(/¡Hola Crystal! Soy Rico, your store assistant/)).toBeTruthy()
    expect(screen.getByText('Rico')).toBeTruthy()
    expect(screen.getByLabelText('Rico, your store assistant')).toBeTruthy()
  })

  it('sends the attached picture with her message, and offers Make it a product on the reply', async () => {
    api.history.mockResolvedValue({ messages: [] })
    api.ask.mockResolvedValue({
      heard: null,
      reply: 'Sharp at 4500 x 6368 with a clear background. Great on a light tee.',
      makeProduct: true,
      imageUrl: 'https://api.test/media/d.png',
      messages: [
        { id: 'u1', role: 'user', text: 'Can this be a shirt?', imageUrl: 'https://api.test/media/d.png', makeProduct: false, createdAt: '2026-10-26T10:00:00Z' },
        { id: 'r1', role: 'assistant', text: 'Sharp at 4500 x 6368 with a clear background. Great on a light tee.', imageUrl: 'https://api.test/media/d.png', makeProduct: true, createdAt: '2026-10-26T10:00:01Z' },
      ],
    })
    const { container } = render(<StoreAssistant slug="crystal" ownerFirst="Crystal" open onClose={vi.fn()} onMakeProduct={vi.fn()} onNeedStudio={vi.fn()} />)
    await waitFor(() => expect(api.history).toHaveBeenCalled())

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'nurse.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
    expect(screen.getByText('nurse.png')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Ask about it, or say/), { target: { value: 'Can this be a shirt?' } })
    fireEvent.click(screen.getByLabelText('Send'))

    await screen.findByText(/Great on a light tee/)
    expect(api.ask).toHaveBeenCalledWith('crystal', { text: 'Can this be a shirt?', image: file })
    expect(screen.getByRole('button', { name: /Make it a product/ })).toBeTruthy()
    // Her own picture shows on her message at once.
    expect(container.querySelector('img[alt="Your design"]')!.getAttribute('src')).toBe('blob:local-preview')
  })

  it('refuses a file that is not a picture before sending anything', async () => {
    api.history.mockResolvedValue({ messages: [] })
    const { container } = render(<StoreAssistant slug="crystal" ownerFirst="Crystal" open onClose={vi.fn()} onMakeProduct={vi.fn()} onNeedStudio={vi.fn()} />)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText(/PNG, JPG or WEBP/)).toBeTruthy()
    expect(api.ask).not.toHaveBeenCalled()
  })

  it('Make it a product after a reload: reads the saved design, uploads + adopts it, then opens Create a design on it', async () => {
    api.history.mockResolvedValue({
      messages: [{ id: 'r1', role: 'assistant', text: 'This will print well.', imageUrl: 'https://api.test/media/d.png', makeProduct: true, createdAt: '2026-10-26T10:00:01Z' }],
    })
    api.design.mockResolvedValue({ image: 'data:image/png;base64,iVBORw0KGgo=', filename: 'design.png' })
    api.upload.mockResolvedValue({ productId: 'prod-9' })
    api.adopt.mockResolvedValue({ ok: true, productId: 'prod-9' })
    const props = panel()
    fireEvent.click(await screen.findByRole('button', { name: /Make it a product/ }))
    await waitFor(() => expect(props.onMakeProduct).toHaveBeenCalledWith('prod-9'))
    expect(api.design).toHaveBeenCalledWith('crystal', 'r1')
    expect(api.upload).toHaveBeenCalledWith({ image: 'data:image/png;base64,iVBORw0KGgo=', kind: 'tshirt', filename: 'design.png' })
    expect(api.adopt).toHaveBeenCalledWith('prod-9')
    expect(api.adopt.mock.invocationCallOrder[0]).toBeLessThan(props.onMakeProduct.mock.invocationCallOrder[0])
  })

  it('sends her to turn on the design studio when it is off, and leaves no draft behind on a failed adopt', async () => {
    api.history.mockResolvedValue({
      messages: [{ id: 'r1', role: 'assistant', text: 'Lovely.', imageUrl: 'https://api.test/media/d.png', makeProduct: true }],
    })
    api.design.mockResolvedValue({ image: 'data:image/png;base64,AA==', filename: 'design.png' })
    api.upload.mockRejectedValueOnce(Object.assign(new Error('Join the creator program'), { status: 403, body: { code: 'creator_signup_required' } }))
    const props = panel()
    fireEvent.click(await screen.findByRole('button', { name: /Make it a product/ }))
    expect(await screen.findByText(/Turn on the design studio first/)).toBeTruthy()
    expect(props.onNeedStudio).toHaveBeenCalled()

    api.upload.mockResolvedValueOnce({ productId: 'prod-x' })
    api.discardDraft.mockResolvedValue({ ok: true })
    api.adopt.mockRejectedValueOnce(new Error('This design is too small to print'))
    fireEvent.click(screen.getByRole('button', { name: /Make it a product/ }))
    expect(await screen.findByText('This design is too small to print')).toBeTruthy()
    expect(api.discardDraft).toHaveBeenCalledWith('prod-x')
    expect(props.onMakeProduct).not.toHaveBeenCalled()
  })

  // Task 820ff916: "mock this on a shirt" -> Make the mockup with its price -> the picture opens in the lightbox.
  it('makes the mockup a reply offered at its stated price, and opens it in the lightbox when it lands', async () => {
    const offer = { id: 'o1', role: 'assistant', text: 'A mockup on a tee is 15 ITC.', mockup: { status: 'offered', label: 'tee', priceItc: 15 } }
    api.history.mockResolvedValue({ messages: [{ id: 'u1', role: 'user', text: 'mock this on a shirt', imageUrl: 'https://api.test/media/d.png' }, offer] })
    api.makeMockup.mockResolvedValue({ message: { ...offer, mockup: { status: 'rendering', label: 'tee', priceItc: 15, stage: 'Putting your picture on it…', startedAt: new Date().toISOString() } } })
    const result = { id: 'r9', role: 'assistant', text: 'Mira, Crystal, here it is on a black tee. Tap it to see it big.', imageUrl: 'https://api.test/media/mock.png', makeProduct: false, mockup: { status: 'result', label: 'black tee' } }
    api.mockupStatus.mockResolvedValue({ message: { ...offer, mockup: { status: 'done', label: 'tee', priceItc: 15, resultId: 'r9' } }, result })
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Make the mockup · 15 ITC' }))
    expect(await screen.findByText('Putting your picture on it…')).toBeTruthy()
    expect(api.makeMockup).toHaveBeenCalledWith('crystal', 'o1')

    const lightbox = await screen.findByRole('dialog', { name: 'Your picture on a black tee' }, { timeout: 6000 })
    expect(lightbox.querySelector('img')!.getAttribute('src')).toBe('https://api.test/media/mock.png')
    expect(api.mockupStatus).toHaveBeenCalledWith('crystal', 'o1')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // The mockup stays in the chat; a tap opens it again.
    fireEvent.click(screen.getByRole('button', { name: 'See your picture on the black tee big' }))
    expect(screen.getByRole('dialog', { name: 'Your picture on a black tee' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Make the mockup/ })).toBeNull()
  }, 10_000)

  it('says plainly when her credits are short, with a way to buy more', async () => {
    api.history.mockResolvedValue({ messages: [{ id: 'o1', role: 'assistant', text: 'Dale!', mockup: { status: 'offered', label: 'hoodie', priceItc: 15 } }] })
    api.makeMockup.mockRejectedValue(new Error('HTTP 402: {"error":"A mockup is 15 ITC and you have 0. Buy credits, then press it again.","needed":15,"balance":0}'))
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Make the mockup · 15 ITC' }))
    expect(await screen.findByText(/A mockup is 15 ITC and you have 0/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Buy credits' }).getAttribute('href')).toBe('/wallet')
  })
})
