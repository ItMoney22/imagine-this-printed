// @vitest-environment jsdom
// Regression cover for the failure David hit on 2026-09-08: the Designs grid
// showed "0 design(s)" for a collection that had 30 designs in it.
//
// Nothing was wrong with the data. The grid had been taught a new `todo` view,
// but the API answering it was older and did not know that word — so it
// filtered `products.status = 'todo'`, matched nothing, and returned an empty
// page with a 200. That skew is not an accident of a stale dev server: the
// frontend (Vercel) and the API (Render) deploy INDEPENDENTLY, so every real
// release has a window where exactly this pairing is live.
//
// These tests pin the feature detection that keeps the grid honest across it.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see PhraseChips.test.tsx).
afterEach(cleanup)

const apiGet = vi.fn()
vi.mock('../lib/api', () => ({
  default: { get: (...args: any[]) => apiGet(...args), post: vi.fn() },
  aiProducts: { createMockups: vi.fn() },
  stepFlow: { adopt: vi.fn() },
}))
vi.mock('./DesignQaPanel', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const AdminDesignLibrary = (await import('./AdminDesignLibrary')).default

/** A /collections row from the CURRENT api — carries the per-view counts. */
const newCollection = { name: 'Halloween', draft: 29, todo: 27, in_flow: 2, active: 1, other: 0, total: 30 }
/** The same collection from an API deployed before those views existed. */
const oldCollection = { name: 'Halloween', draft: 29, active: 1, other: 0, total: 30 }

function mockApi(collection: Record<string, any>) {
  apiGet.mockImplementation(async (url: string) => {
    if (String(url).includes('/collections')) return { data: { collections: [collection] } }
    return { data: { products: [], total: 0, offset: 0, page_size: 60 } }
  })
}

beforeEach(() => apiGet.mockReset())

/** The chips only exist once a collection is open, so every test starts by
 *  picking one — the same first click David makes. */
async function openCollection() {
  render(<AdminDesignLibrary />)
  const row = await screen.findByRole('button', { name: /Halloween/ })
  fireEvent.click(row)
  await waitFor(() => expect(apiGet.mock.calls.some((c) => String(c[0]).includes('/products'))).toBe(true))
}

describe('AdminDesignLibrary — surviving a frontend/API version skew', () => {
  it('offers the new views when the API reports per-view counts', async () => {
    mockApi(newCollection)
    await openCollection()
    expect(await screen.findByText('To do 27')).toBeTruthy()
    expect(screen.getByText('In Step Flow 2')).toBeTruthy()
    expect(screen.getByText('Live 1')).toBeTruthy()
    expect(screen.getByText('All 30')).toBeTruthy()
  })

  it('falls back to the old chips when the API does not know the new views', async () => {
    mockApi(oldCollection)
    await openCollection()
    // The chips that would send an unrecognised `status=` are gone entirely.
    await waitFor(() => expect(screen.getByText('Draft 29')).toBeTruthy())
    expect(screen.queryByText(/^To do/)).toBeNull()
    expect(screen.queryByText(/^In Step Flow/)).toBeNull()
    expect(screen.getByText('All 30')).toBeTruthy()
  })

  it('never asks an older API for a view it cannot answer', async () => {
    mockApi(oldCollection)
    await openCollection()
    // Whatever the grid asks for, it must never be 'todo'/'in_flow' against
    // this API — that is precisely the request that came back empty and read
    // as "my designs are gone".
    await waitFor(() => expect(screen.getByText('Draft 29')).toBeTruthy())
    const asked = apiGet.mock.calls.map((c) => c[1]?.params?.status).filter((v) => v !== undefined)
    expect(asked.length).toBeGreaterThan(0)
    for (const status of asked) expect(['all', 'draft', 'active']).toContain(status)
  })

  it('still shows a collection count in the sidebar when the API omits the new fields', async () => {
    mockApi(oldCollection)
    render(<AdminDesignLibrary />)
    // Falls back to the raw draft count rather than rendering nothing, which is
    // how "Halloween - 1 live" ended up hiding 29 designs.
    expect(await screen.findByText(/29 draft/)).toBeTruthy()
  })

  it('asks for the to-do view by default against a current API', async () => {
    mockApi(newCollection)
    await openCollection()
    const asked = apiGet.mock.calls.map((c) => c[1]?.params?.status).filter((v) => v !== undefined)
    expect(asked).toContain('todo')
  })
})
