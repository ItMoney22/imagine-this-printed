// @vitest-environment jsdom
// Small render test for the phrase chip grid — the full IdeaStep pulls in
// network effects (stepFlow.phrases/brief) and voice dictation, so this
// exercises just the exported presentational piece (same pattern as
// PrintPrepPanel.test.tsx's RecommendationBadge).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PhraseChips } from './IdeaStep'
import type { Phrase } from '../../lib/api'

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see RoleRoute.test.tsx).
afterEach(cleanup)

const phrases: Phrase[] = [
  { text: 'STREET ROYALTY', vibe: 'bold', placement: 'below', reason: 'Short, punchy, reads at a glance on a tee.' },
  {
    text: 'Concrete Jungle King',
    vibe: 'playful',
    placement: 'below',
    reason: 'Plays on the streetwear-monkey idea without being on-the-nose.',
  },
]

describe('PhraseChips', () => {
  it('renders phrase text and vibe tag for each candidate', () => {
    render(<PhraseChips phrases={phrases} onSelect={() => {}} />)
    expect(screen.getByText('STREET ROYALTY')).toBeTruthy()
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.getByText('Concrete Jungle King')).toBeTruthy()
    expect(screen.getByText('playful')).toBeTruthy()
  })

  it('keeps the reason hidden until "why?" is tapped', () => {
    render(<PhraseChips phrases={phrases} onSelect={() => {}} />)
    expect(screen.queryByText(phrases[0].reason)).toBeNull()
    fireEvent.click(screen.getAllByText('why?')[0])
    expect(screen.getByText(phrases[0].reason)).toBeTruthy()
  })

  it('calls onSelect with the chosen phrase when its chip is clicked', () => {
    const onSelect = vi.fn()
    render(<PhraseChips phrases={phrases} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('STREET ROYALTY'))
    expect(onSelect).toHaveBeenCalledWith(phrases[0])
  })
})
