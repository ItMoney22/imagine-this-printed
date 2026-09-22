// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AdminTeamTemplates from './AdminTeamTemplates'

// Mock apiFetch
const mockApiFetch = vi.fn()
vi.mock('../lib/api', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}))

// Mock useToast with stable mock
const stableToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}
vi.mock('../hooks/useToast', () => ({
  useToast: () => stableToast,
}))

// Mock Supabase
vi.mock('../lib/supabase', () => {
  const mockProduct = {
    id: 'prod-456',
    name: 'Spartan Varsity Tee',
    images: ['https://cdn.example.com/front.png', 'https://cdn.example.com/back.png'],
    metadata: {
      print_artwork: {
        back_image: 'https://cdn.example.com/back.png',
      },
    },
  }

  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProduct, error: null }),
            single: vi.fn().mockResolvedValue({ data: mockProduct, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    },
  }
})

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/admin/team-templates/prod-456']}>
      <Routes>
        <Route path="/admin/team-templates/:productId" element={<AdminTeamTemplates />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminTeamTemplates', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue({})
  })

  afterEach(cleanup)

  it('renders Step 1 (Select Back Artwork) with tagged back and gallery', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText(/1\. Select Back Artwork/i)).toBeTruthy()
      expect(screen.getByText('Tagged Back')).toBeTruthy()
      expect(screen.getByText(/Continue to Field Targets/i)).toBeTruthy()
    })
  })

  it('progresses to Step 2 and allows selecting layout presets and positioning targets', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText(/Continue to Field Targets/i)).toBeTruthy()
    })

    fireEvent.click(screen.getByText(/Continue to Field Targets/i))

    await waitFor(() => {
      expect(screen.getByText(/2\. Designate Name & Number Targets/i)).toBeTruthy()
      expect(screen.getByText('Classic Jersey')).toBeTruthy()
      expect(screen.getByText('Player / Last Name Field')).toBeTruthy()
      expect(screen.getByText('Player Number Field')).toBeTruthy()
    })

    // Does NOT show obsolete plate engine wording
    expect(screen.queryByText(/distress mask/i)).toBeNull()
    expect(screen.queryByText(/halftone the press file/i)).toBeNull()
    expect(screen.queryByText(/erase sample lettering/i)).toBeNull()
  })

  it('navigates through all 4 steps to live preview', async () => {
    renderComponent()

    // Step 1 -> Step 2
    await waitFor(() => {
      expect(screen.getByText(/Continue to Field Targets/i)).toBeTruthy()
    })
    fireEvent.click(screen.getByText(/Continue to Field Targets/i))

    // Step 2 -> Step 3
    await waitFor(() => {
      expect(screen.getByText(/Continue to Constraints/i)).toBeTruthy()
    })
    fireEvent.click(screen.getByText(/Continue to Constraints/i))

    await waitFor(() => {
      expect(screen.getByText(/3\. Set Allowable Field Content & Constraints/i)).toBeTruthy()
      expect(screen.getByText('Name Field Settings')).toBeTruthy()
      expect(screen.getByText('Number Field Settings')).toBeTruthy()
    })

    // Step 3 -> Step 4
    fireEvent.click(screen.getByText(/Continue to Live Preview/i))

    await waitFor(() => {
      expect(screen.getByText(/4\. Live Preview & Save Template/i)).toBeTruthy()
      expect(screen.getByText('Personalized Back Preview')).toBeTruthy()
      expect(screen.getByText(/Save & Publish Team Template/i)).toBeTruthy()
    })
  })
})
