// @vitest-environment jsdom
// Cover for the Admin Dashboard "Filament & Paint" tab (Watchtower c89e511c).
//
// This tab was dark in production until 2026-09-22 because
// supabase/migrations/20260819230000_print_materials.sql had never been applied
// — every request failed on a missing relation, and the toy print flow silently
// shipped orders with no filament/paint plan. The migration is live now, so the
// thing worth pinning is the contract the tab depends on: it reads its rows from
// /api/admin/print-materials (the service-role backend route), NOT from the
// browser Supabase client. print_materials has RLS on with zero policies, so a
// direct client query would return nothing forever without raising an error —
// a silent empty grid, which is exactly the failure mode this file exists to
// catch.
//
// The fixture is the real payload shape returned by the live endpoint after the
// initial stock was seeded.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see PhraseChips.test.tsx).
afterEach(cleanup)

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()
vi.mock('../lib/api', () => ({
  default: {
    get: (...args: any[]) => apiGet(...args),
    post: (...args: any[]) => apiPost(...args),
    put: (...args: any[]) => apiPut(...args),
    delete: (...args: any[]) => apiDelete(...args)
  }
}))

const AdminPrintMaterials = (await import('./AdminPrintMaterials')).default

const LIVE_ROWS = [
  {
    id: 'f-grey', kind: 'filament' as const, brand: 'Bambu Lab', material: 'PLA Matte',
    color_name: 'Matte Grey', hex: '#757575', qty_on_hand: 1, reorder_threshold: 1,
    cost_per_unit: null, grams_per_unit: 1000, supplier: 'Bambu Lab', notes: null,
    is_active: true, low_stock: true
  },
  {
    id: 'f-black', kind: 'filament' as const, brand: 'Unbranded', material: 'PLA',
    color_name: 'Black', hex: '#000000', qty_on_hand: 2, reorder_threshold: 1,
    cost_per_unit: null, grams_per_unit: null, supplier: null, notes: null,
    is_active: true, low_stock: false
  },
  {
    id: 'p-red', kind: 'paint' as const, brand: 'TBD', material: 'acrylic',
    color_name: 'Primary Red', hex: '#c9282d', qty_on_hand: 0, reorder_threshold: 1,
    cost_per_unit: null, grams_per_unit: null, supplier: null, notes: null,
    is_active: true, low_stock: true
  }
]

const listResponse = (rows = LIVE_ROWS) => ({
  data: { items: rows, low_stock_count: rows.filter(r => r.low_stock).length }
})

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); apiPut.mockReset(); apiDelete.mockReset()
  apiGet.mockResolvedValue(listResponse())
  apiPost.mockResolvedValue({ data: { item: LIVE_ROWS[0] } })
  apiPut.mockResolvedValue({ data: { item: LIVE_ROWS[0] } })
  apiDelete.mockResolvedValue({ data: { success: true } })
})

describe('AdminPrintMaterials', () => {
  it('loads its rows from the backend admin route, not the browser Supabase client', async () => {
    render(<AdminPrintMaterials />)
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/admin/print-materials'))
    await screen.findByText('Matte Grey')
    expect(screen.getByText('Black')).toBeTruthy()
    expect(screen.getByText('Primary Red')).toBeTruthy()
  })

  it('renders the hex as the swatch, because hex is the color-matching key', async () => {
    const { container } = render(<AdminPrintMaterials />)
    await screen.findByText('Matte Grey')
    expect(screen.getByText('#757575')).toBeTruthy()
    const swatches = container.querySelectorAll('span[style*="background-color"]')
    expect(swatches.length).toBe(LIVE_ROWS.length)
  })

  it('flags low stock so the floor sees a spool about to run out', async () => {
    render(<AdminPrintMaterials />)
    await screen.findByText('Matte Grey')
    expect(screen.getByText('2 low')).toBeTruthy()
    expect(screen.getAllByText('low').length).toBe(2)
  })

  it('surfaces the backend error instead of rendering an empty grid', async () => {
    apiGet.mockRejectedValueOnce({ response: { data: { error: 'relation print_materials does not exist' } } })
    render(<AdminPrintMaterials />)
    await screen.findByText('relation print_materials does not exist')
  })

  it('saves a new material through POST and re-reads the list', async () => {
    render(<AdminPrintMaterials />)
    await screen.findByText('Matte Grey')
    fireEvent.click(screen.getByText('Add'))
    const colorInput = await screen.findByPlaceholderText('Fire Engine Red')
    fireEvent.change(colorInput, { target: { value: 'Verify Teal' } })
    const brandInput = screen.getByPlaceholderText('Bambu / Polymaker')
    fireEvent.change(brandInput, { target: { value: 'ZZ-Verify' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add material' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    const [url, body] = apiPost.mock.calls[0]
    expect(url).toBe('/api/admin/print-materials')
    expect(body.color_name).toBe('Verify Teal')
    expect(body.brand).toBe('ZZ-Verify')
    expect(body.kind).toBe('filament')
    // The grid must re-read after a write — a stale grid is how a saved spool
    // looks like it never saved.
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(1))
  })

  it('edits quantity through PUT on the row id', async () => {
    const { container } = render(<AdminPrintMaterials />)
    await screen.findByText('Matte Grey')
    fireEvent.click(container.querySelectorAll('button[title="Edit quantity"]')[0])
    const qty = await screen.findByDisplayValue('1')
    fireEvent.change(qty, { target: { value: '4' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/admin/print-materials/f-grey', { qty_on_hand: 4 }))
  })

  it('deletes only after the confirm, and never without it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<AdminPrintMaterials />)
    await screen.findByText('Matte Grey')
    fireEvent.click(container.querySelectorAll('button[title="Delete"]')[0])
    expect(apiDelete).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(container.querySelectorAll('button[title="Delete"]')[0])
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/admin/print-materials/f-grey'))
    confirmSpy.mockRestore()
  })

  it('filters by kind client-side without refetching', async () => {
    render(<AdminPrintMaterials />)
    await screen.findByText('Matte Grey')
    const callsBefore = apiGet.mock.calls.length
    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'paint' } })
    await waitFor(() => expect(screen.queryByText('Matte Grey')).toBeNull())
    expect(screen.getByText('Primary Red')).toBeTruthy()
    expect(apiGet.mock.calls.length).toBe(callsBefore)
  })
})
