// @vitest-environment jsdom
// Render test for the lettering style grid (design doc §16) — same pattern
// as IdeaStep's PhraseChips.test.tsx / PrintPrepPanel's RecommendationBadge
// test: exercise the presentational component directly, not the network
// effects of the step it lives in.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import LetteringStylePicker from './LetteringStylePicker'
import { LETTERING_STYLES } from '../../../backend/shared/lettering-styles'

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see RoleRoute.test.tsx).
afterEach(cleanup)

describe('LetteringStylePicker', () => {
  it('renders the actual phrase text (not the style label) inside every style tile', () => {
    render(<LetteringStylePicker phraseText="STREET ROYALTY" selected="auto" onSelect={() => {}} />)
    // One tile per style, all showing the same phrase text.
    expect(screen.getAllByText('STREET ROYALTY')).toHaveLength(LETTERING_STYLES.length)
  })

  it('renders one tile per lettering style, plus a "Let Mrs. Imagine pick" auto tile', () => {
    render(<LetteringStylePicker phraseText="STREET ROYALTY" selected="auto" onSelect={() => {}} />)
    for (const style of LETTERING_STYLES) {
      expect(screen.getByText(style.label)).toBeTruthy()
    }
    expect(screen.getByText('Let Mrs. Imagine pick')).toBeTruthy()
  })

  it('marks the currently selected style tile as pressed, and nothing else', () => {
    render(<LetteringStylePicker phraseText="STREET ROYALTY" selected="graffiti" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Let Mrs\. Imagine pick/ }).getAttribute('aria-pressed')).toBe('false')
    const graffitiTile = screen.getByText('Graffiti').closest('button')
    expect(graffitiTile?.getAttribute('aria-pressed')).toBe('true')
    const varsityTile = screen.getByText('Varsity').closest('button')
    expect(varsityTile?.getAttribute('aria-pressed')).toBe('false')
  })

  it('marks the auto tile as pressed when selected is "auto"', () => {
    render(<LetteringStylePicker phraseText="STREET ROYALTY" selected="auto" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Let Mrs\. Imagine pick/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('calls onSelect with the style id when a tile is clicked', () => {
    const onSelect = vi.fn()
    render(<LetteringStylePicker phraseText="STREET ROYALTY" selected="auto" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Chrome 3D').closest('button')!)
    expect(onSelect).toHaveBeenCalledWith('chrome-3d')
  })

  it('calls onSelect with "auto" when the "Let Mrs. Imagine pick" tile is clicked', () => {
    const onSelect = vi.fn()
    render(<LetteringStylePicker phraseText="STREET ROYALTY" selected="graffiti" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Let Mrs. Imagine pick').closest('button')!)
    expect(onSelect).toHaveBeenCalledWith('auto')
  })

  it('injects exactly one Google Fonts stylesheet link into <head>, no matter how many pickers mount', () => {
    // The dedup guard is page-wide (module-level flag + a DOM query), not
    // per-instance — earlier tests in this file may have already injected
    // it. Two more mounts here must still leave exactly one link in <head>.
    render(<LetteringStylePicker phraseText="A" selected="auto" onSelect={() => {}} />)
    render(<LetteringStylePicker phraseText="B" selected="auto" onSelect={() => {}} />)
    const links = document.head.querySelectorAll('link[data-itp-lettering-fonts]')
    expect(links.length).toBe(1)
    expect(links[0]?.getAttribute('href')).toContain('fonts.googleapis.com/css2')
  })
})
