// @vitest-environment jsdom
// The line under a finished picture used to read "via gpt-image-2.6-flare" for everyone.
// A customer never sees what drew it; the team still does.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FlareLab from './FlareLab'
import { flareApi } from '../../../lib/api'

vi.mock('../../../lib/api', () => ({
  apiErrorMessage: (e: unknown) => String(e),
  flareApi: {
    pricing: vi.fn(async () => ({ perImage: { low: 10, medium: 20, high: 40, xhigh: 60, max: 90 } })),
    run: vi.fn(),
  },
}))

afterEach(cleanup)

async function runTool(isAdmin: boolean): Promise<HTMLElement> {
  vi.mocked(flareApi.run).mockResolvedValueOnce({
    images: [{ url: 'https://cdn.test/out.png', modelId: 'openai/gpt-image-2.6-flare' }],
    prompt: 'the whole prompt',
    size: '1536x1536',
    background: 'transparent',
    op: 'transparent',
    cost: 40,
  } as never)
  const { container } = render(
    <FlareLab isOpen onClose={vi.fn()} imageUrl="https://cdn.test/in.png" isAdmin={isAdmin} initialOp="transparent" />
  )
  fireEvent.click(screen.getByRole('button', { name: /^Run True Transparent/ }))
  await screen.findByText(/1536x1536/)
  return container
}

describe('FlareLab — who sees the engine', () => {
  it('names no model to a customer once a picture comes back', async () => {
    const container = await runTool(false)

    expect(container.textContent).not.toMatch(/gpt|openai|flare/i)
  })

  it('still tells the team what drew it', async () => {
    await runTool(true)

    expect(screen.getByText(/via gpt-image-2\.6-flare/)).toBeTruthy()
  })
})
