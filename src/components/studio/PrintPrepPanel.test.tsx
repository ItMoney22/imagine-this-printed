// @vitest-environment jsdom
// Small render test for the print-prep recommendation badge's text/color
// mapping — the full PrintPrepPanel pulls in network effects (printAdvice/
// printFile), so this exercises just the exported presentational piece.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RecommendationBadge } from './PrintPrepPanel'
import type { PrintAdvice } from './stepFlowReducer'

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see RoleRoute.test.tsx).
afterEach(cleanup)

const advice = (over: Partial<PrintAdvice> = {}): PrintAdvice => ({
  recommend: 'halftone',
  confidence: 0.82,
  reason: '61% of the artwork is smooth shading',
  stats: { smoothShare: 0.61, colorCount: 14, softEdgeShare: 0.12 },
  suggested: { method: 'halftone', frequency: 55, angle: 45, shape: 'round', invertDark: false },
  ...over,
})

describe('RecommendationBadge', () => {
  it('reads "Halftone recommended" for recommend:halftone', () => {
    render(<RecommendationBadge advice={advice({ recommend: 'halftone', confidence: 0.82 })} />)
    expect(screen.getByText('Halftone recommended')).toBeTruthy()
    expect(screen.getByText('82% confidence')).toBeTruthy()
  })

  it('reads "Print clean" for recommend:clean', () => {
    render(<RecommendationBadge advice={advice({ recommend: 'clean', confidence: 0.7 })} />)
    expect(screen.getByText('Print clean')).toBeTruthy()
    expect(screen.getByText('70% confidence')).toBeTruthy()
  })
})
