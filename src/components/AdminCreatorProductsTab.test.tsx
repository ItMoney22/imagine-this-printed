// @vitest-environment jsdom
// The Jev pre-sort on the creator-products approval queue: every card shows
// the suggestion, how sure, and why; the order toggle re-asks the API with
// ?sort; and against an older API (no pre-sort in the payload — Vercel and
// Render deploy independently) the toggle stays hidden instead of lying.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

// vitest runs without `globals`, so testing-library's auto-cleanup never registers.
afterEach(cleanup)

const apiGet = vi.fn()
const apiPost = vi.fn()
vi.mock('../lib/api', () => ({ default: { get: (...a: any[]) => apiGet(...a), post: (...a: any[]) => apiPost(...a) } }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }))

const { AdminCreatorProductsTab } = await import('./AdminCreatorProductsTab')

const product = (id: string, name: string, jev_presort: any) => ({
  id, name, description: 'd', price: 25, status: 'pending_approval', images: [], category: 'shirts',
  created_at: '2026-09-20T00:00:00Z', metadata: {}, product_assets: [], jev_presort,
})

beforeEach(() => {
  apiGet.mockReset()
  apiPost.mockReset()
})

describe('AdminCreatorProductsTab — Jev pre-sort', () => {
  it('shows the suggestion, confidence and reason on each card', async () => {
    apiGet.mockResolvedValue({ data: {
      presort: { mode: 'shadow', sort: 'created' },
      products: [
        product('a', 'Wolf Howl', { recommendation: 'approve', confidence: 0.93, reasonCode: 'jev_approve', reasonCodes: ['jev_approve'], rationale: 'Jev suggests approve (93% sure).', source: 'jev', lowConfidence: false }),
        product('b', 'Odd Blob', { recommendation: null, confidence: 0.4, reasonCode: 'jev_low_confidence', reasonCodes: ['jev_low_confidence'], rationale: 'Jev was not sure enough.', source: 'none', lowConfidence: true }),
        product('c', 'Batman Tee', { recommendation: 'reject_ip', confidence: 1, reasonCode: 'floor_trademark', reasonCodes: ['floor_trademark'], rationale: 'Trademark denylist hit: batman.', source: 'floor', lowConfidence: false }),
      ],
    } })
    render(<AdminCreatorProductsTab />)
    expect(await screen.findByText('Suggest: approve')).toBeTruthy()
    expect(screen.getByText('Jev 93% sure')).toBeTruthy()
    expect(screen.getByText('No suggestion: needs a careful read')).toBeTruthy()
    expect(screen.getByText('Suggest: reject (IP)')).toBeTruthy()
    expect(screen.getByText('rule check')).toBeTruthy()
    expect(screen.getByText('floor_trademark')).toBeTruthy()
    // Nothing is decided for the reviewer: no approve/reject call fired.
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('the order toggle re-asks the API with ?sort=jev', async () => {
    apiGet.mockResolvedValue({ data: { presort: { mode: 'shadow', sort: 'created' }, products: [product('a', 'Wolf', null)] } })
    render(<AdminCreatorProductsTab />)
    const jevBtn = await screen.findByRole('button', { name: 'Jev triage' })
    expect(screen.getByRole('button', { name: 'Newest' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(jevBtn)
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/api/admin/user-products/pending', { params: { sort: 'jev' } }))
  })

  it('an older API without pre-sort hides the toggle and the badges', async () => {
    apiGet.mockResolvedValue({ data: { products: [product('a', 'Wolf', undefined)] } })
    render(<AdminCreatorProductsTab />)
    expect(await screen.findByText('Wolf')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Jev triage' })).toBeNull()
    expect(screen.queryByText(/Suggest:/)).toBeNull()
  })
})
