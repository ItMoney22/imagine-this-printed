// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TumblerSizeGuideModal, TumblerSizeGuideTrigger } from './TumblerSizeGuideModal'
import { TumblerQuickSpecs } from './TumblerQuickSpecs'
import type { Product } from '../types'

afterEach(() => {
  cleanup()
})

const mockTumblerProduct: Product = {
  id: 'tumbler-prod-1',
  name: 'Retro Cosmic 20oz Tumbler',
  description: 'Double-wall vacuum insulated stainless steel travel tumbler.',
  price: 29.99,
  images: ['https://example.com/tumbler.jpg'],
  category: 'tumblers',
  inStock: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  sizes: ['20 oz', '30 oz'],
} as Product

describe('TumblerSizeGuideModal', () => {
  it('does not render when isOpen is false', () => {
    render(
      <TumblerSizeGuideModal
        isOpen={false}
        onClose={vi.fn()}
        product={mockTumblerProduct}
      />
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders modal dialog with accessible title and controls when isOpen is true', () => {
    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={vi.fn()}
        product={mockTumblerProduct}
      />
    )
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('Tumbler Size & Fit Guide')).toBeDefined()
    expect(screen.getByText(/Dimensions, liquid volume & cup-holder fit/)).toBeDefined()
  })

  it('displays standard 20 oz specifications by default with universal cup-holder rating', () => {
    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={vi.fn()}
        product={mockTumblerProduct}
      />
    )
    expect(screen.getAllByText('20 oz Skinny Tumbler').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/20 fl oz/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/8.25/).length).toBeGreaterThan(0)
    expect(screen.getByText('Universal Cup-Holder Fit')).toBeDefined()
  })

  it('switches between imperial and metric units accurately', () => {
    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={vi.fn()}
        product={mockTumblerProduct}
      />
    )

    // Initially in Imperial (20 fl oz)
    expect(screen.getAllByText(/20 fl oz/).length).toBeGreaterThan(0)

    // Switch to Metric
    const metricButton = screen.getByRole('button', { name: /Switch to Metric/i })
    fireEvent.click(metricButton)

    // Now in Metric (590 ml / 21 cm)
    expect(screen.getAllByText(/590 ml/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/21 cm/).length).toBeGreaterThan(0)
  })

  it('switches active size when selecting a different model', () => {
    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={vi.fn()}
        product={mockTumblerProduct}
      />
    )

    // Select the 30 oz model button
    const thirtyOzBtn = screen.getByRole('button', { name: /30 oz 30 oz Travel Tumbler/i })
    fireEvent.click(thirtyOzBtn)

    // Verifies 30 oz details are shown
    expect(screen.getAllByText(/30 fl oz/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/7.75/).length).toBeGreaterThan(0)
  })

  it('renders all comparison table entries when clicking the comparison tab', () => {
    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={vi.fn()}
        product={mockTumblerProduct}
      />
    )

    // Click comparison matrix tab
    const tableTab = screen.getByRole('button', { name: /All Sizes Comparison/i })
    fireEvent.click(tableTab)

    expect(screen.getByText('Standard Tumbler Comparison Matrix')).toBeDefined()
    expect(screen.getByText('20 oz Skinny Tumbler')).toBeDefined()
    expect(screen.getByText('30 oz Travel Tumbler')).toBeDefined()
    expect(screen.getByText('12 oz Wine & Coffee Tumbler')).toBeDefined()
    expect(screen.getByText('40 oz Adventure Handle Tumbler')).toBeDefined()
  })

  it('renders care & vehicle fit instructions when clicking the care tab', () => {
    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={vi.fn()}
        product={mockTumblerProduct}
      />
    )

    const careTab = screen.getByRole('button', { name: /Fit & Care Tips/i })
    fireEvent.click(careTab)

    expect(screen.getByText('Fit Verification & Drinkware Care')).toBeDefined()
    expect(screen.getByText('Vehicle Cup-Holder Compatibility')).toBeDefined()
    expect(screen.getByText('Washing & Graphic Care')).toBeDefined()
  })

  it('calls onSelectSize and closes when size CTA is clicked', () => {
    const onSelectSize = vi.fn()
    const onClose = vi.fn()

    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={onClose}
        product={mockTumblerProduct}
        onSelectSize={onSelectSize}
      />
    )

    const selectBtn = screen.getByRole('button', { name: /Select 20 oz for this order/i })
    fireEvent.click(selectBtn)

    expect(onSelectSize).toHaveBeenCalledWith('20 oz')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when close button or Escape key is pressed', () => {
    const onClose = vi.fn()
    render(
      <TumblerSizeGuideModal
        isOpen={true}
        onClose={onClose}
        product={mockTumblerProduct}
      />
    )

    const closeBtn = screen.getByRole('button', { name: /Close size guide/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Test Escape key
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('TumblerSizeGuideTrigger', () => {
  it('renders trigger button and dispatches click handler', () => {
    const onClick = vi.fn()
    render(<TumblerSizeGuideTrigger onClick={onClick} />)

    const btn = screen.getByRole('button', { name: /Open tumbler size and dimension guide/i })
    expect(btn).toBeDefined()
    expect(screen.getByText('Size & Fit Guide')).toBeDefined()

    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('TumblerQuickSpecs', () => {
  it('renders at-a-glance tumbler dimensions, capacity, and cup holder badge', () => {
    const onOpen = vi.fn()
    render(
      <TumblerQuickSpecs
        product={mockTumblerProduct}
        selectedSize="20 oz"
        onOpenSizeGuide={onOpen}
      />
    )

    expect(screen.getByText('Tumbler Specs')).toBeDefined()
    expect(screen.getByText(/20 fl oz/)).toBeDefined()
    expect(screen.getByText(/8.25"/)).toBeDefined()
    expect(screen.getByText(/2.9"/)).toBeDefined()
    expect(screen.getByText('Universal')).toBeDefined()

    const fullGuideLink = screen.getByRole('button', { name: /Full Size Guide →/i })
    fireEvent.click(fullGuideLink)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
