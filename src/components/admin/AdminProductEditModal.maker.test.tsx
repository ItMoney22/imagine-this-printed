// @vitest-environment jsdom
// The admin end of maker attribution (Watchtower b505062b).
//
// A maker that cannot be SET is a maker that never gets credited, so this
// pins the field actually rendering inside the modal and persisting to the
// `maker_agent_id` column — an unwired control here would leave the whole
// checkout change dead on arrival with nothing to show for it.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminProductEditModal } from './AdminProductEditModal'
import { MAKER_AGENTS } from '../../../backend/shared/maker-attribution'

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand.
afterEach(cleanup)

const onSave = vi.fn()
beforeEach(() => onSave.mockReset())

const product = {
  id: '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3',
  name: 'Gothic Ghost Face Candle Holder',
  description: 'A chilling gothic design.',
  price: 20,
  category: '3d-models',
  status: 'active',
  images: [],
  sizes: [],
  colors: [],
  metadata: {},
  maker_agent_id: null as string | null,
}

const renderModal = (overrides: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <AdminProductEditModal
        product={{ ...product, ...overrides }}
        assetGroups={{}}
        jobs={[]}
        sizeOptions={[]}
        loadingAction={null}
        generatingGptText={false}
        onClose={vi.fn()}
        onSave={onSave}
        onSetMain={vi.fn()}
        onDeleteImage={vi.fn()}
        onRegenerate={vi.fn()}
        onRemoveBackground={vi.fn()}
        onUpscale={vi.fn()}
        onCreateMockups={vi.fn()}
        onGptAssist={vi.fn()}
      />
    </MemoryRouter>,
  )

describe('AdminProductEditModal — maker field', () => {
  it('renders the maker picker with the whole Watchtower roster plus House', () => {
    renderModal()
    const select = screen.getByLabelText('Maker (revenue credit)') as HTMLSelectElement
    expect(select.options).toHaveLength(MAKER_AGENTS.length + 1)
    expect(select.options[0].value).toBe('')
    expect(select.value).toBe('')
    expect(screen.getByRole('option', { name: 'Amelia Chan' })).toBeTruthy()
  })

  it('persists to the maker_agent_id column when a maker is picked', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('Maker (revenue credit)'), {
      target: { value: 'amelia-chan' },
    })
    expect(onSave).toHaveBeenCalledWith(
      { maker_agent_id: 'amelia-chan' },
      'maker_agent_id',
      'amelia-chan',
    )
  })

  it('clears back to NULL, not an empty string, when set to House', () => {
    // '' would pass the column's slug CHECK and then read as a maker nobody
    // recognises. NULL is the only honest "house goods".
    renderModal({ maker_agent_id: 'amelia-chan' })
    fireEvent.change(screen.getByLabelText('Maker (revenue credit)'), {
      target: { value: '' },
    })
    expect(onSave).toHaveBeenCalledWith({ maker_agent_id: null }, 'maker_agent_id', null)
  })

  it('says out loud whose ledger a sale credits', () => {
    renderModal({ maker_agent_id: 'amelia-chan' })
    expect(
      screen.getByText(/Sales of this product credit Amelia Chan on the Watchtower ledger\./),
    ).toBeTruthy()

    cleanup()
    renderModal()
    expect(screen.getByText(/Sales credit the ITP storefront default\./)).toBeTruthy()
  })
})
