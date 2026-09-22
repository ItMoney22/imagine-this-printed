// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import TeamPersonalizePanel, { type TeamTemplateSummary } from './TeamPersonalizePanel'

// Mock apiFetch
const mockApiFetch = vi.fn()
vi.mock('../lib/api', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}))

const sampleTemplate: TeamTemplateSummary = {
  version: 1,
  upcharge: 5,
  fields: [
    { key: 'name', label: 'Last Name', type: 'text', max: 12, uppercase: true },
    { key: 'number', label: 'Number', type: 'number', max: 2 },
  ],
}

describe('TeamPersonalizePanel', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue({ url: 'https://cdn.example.com/mock-preview.png' })
  })

  afterEach(cleanup)

  it('renders the personalization panel with title, guidance, and upcharge', () => {
    render(
      <TeamPersonalizePanel
        productId="test-product-123"
        template={sampleTemplate}
        values={{}}
        onChange={vi.fn()}
        onUnsupported={vi.fn()}
      />
    )

    expect(screen.getByText('Customize the Back')).toBeTruthy()
    expect(screen.getByText('+$5.00')).toBeTruthy()
    expect(screen.getByText('Last Name')).toBeTruthy()
    expect(screen.getByText('Number')).toBeTruthy()
    expect(screen.getByText(/Try Demo/i)).toBeTruthy()
  })

  it('triggers demo preset filling both name and number on one tap', () => {
    const onChange = vi.fn()
    render(
      <TeamPersonalizePanel
        productId="test-product-123"
        template={sampleTemplate}
        values={{}}
        onChange={onChange}
        onUnsupported={vi.fn()}
      />
    )

    const demoBtn = screen.getByText(/Try Demo/i)
    fireEvent.click(demoBtn)

    expect(onChange).toHaveBeenCalledWith({
      name: 'SMITH',
      number: '22',
    })
  })

  it('cleanses and uppercases name input while restricting length', () => {
    const onChange = vi.fn()
    render(
      <TeamPersonalizePanel
        productId="test-product-123"
        template={sampleTemplate}
        values={{ name: '' }}
        onChange={onChange}
        onUnsupported={vi.fn()}
      />
    )

    const nameInput = screen.getByPlaceholderText(/e.g. WILLIAMS/i)
    fireEvent.change(nameInput, { target: { value: 'williams!' } })

    // Exclamation mark stripped, uppercase enforced
    expect(onChange).toHaveBeenCalledWith({
      name: 'WILLIAMS',
    })
  })

  it('restricts number input to numeric digits only', () => {
    const onChange = vi.fn()
    render(
      <TeamPersonalizePanel
        productId="test-product-123"
        template={sampleTemplate}
        values={{ number: '' }}
        onChange={onChange}
        onUnsupported={vi.fn()}
      />
    )

    const numInput = screen.getByPlaceholderText(/e.g. 24/i)
    fireEvent.change(numInput, { target: { value: '2a4' } })

    expect(onChange).toHaveBeenCalledWith({
      number: '24',
    })
  })

  it('displays completion banner when all template fields are provided', () => {
    render(
      <TeamPersonalizePanel
        productId="test-product-123"
        template={sampleTemplate}
        values={{ name: 'JOHNSON', number: '10' }}
        onChange={vi.fn()}
        onUnsupported={vi.fn()}
      />
    )

    expect(screen.getByText(/Personalization complete! What you see below is what gets printed/i)).toBeTruthy()
  })

  it('shows live preview mockup when preview URL resolves', async () => {
    render(
      <TeamPersonalizePanel
        productId="test-product-123"
        template={sampleTemplate}
        values={{ name: 'DAVIS', number: '7' }}
        onChange={vi.fn()}
        onUnsupported={vi.fn()}
      />
    )

    await waitFor(() => {
      const img = screen.getByAltText('Personalized back print mockup')
      expect(img).toBeTruthy()
      expect((img as HTMLImageElement).src).toBe('https://cdn.example.com/mock-preview.png')
    })
  })

  it('calls onUnsupported when API returns 404 deploy skew', async () => {
    mockApiFetch.mockRejectedValue(new Error('HTTP 404: Not Found'))
    const onUnsupported = vi.fn()

    render(
      <TeamPersonalizePanel
        productId="test-product-123"
        template={sampleTemplate}
        values={{ name: 'TEST' }}
        onChange={vi.fn()}
        onUnsupported={onUnsupported}
      />
    )

    await waitFor(() => {
      expect(onUnsupported).toHaveBeenCalled()
    })
  })
})
