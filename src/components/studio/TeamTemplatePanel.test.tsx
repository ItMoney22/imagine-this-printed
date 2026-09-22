// @vitest-environment jsdom
// Step Flow team-template panel — the live preview the builder uses to answer
// "will a customer's name look right on this shirt?" without leaving the flow.
//
// Same pattern as LetteringStylePicker.test.tsx: exercise the component
// directly. The one network call it makes (POST /api/team-plate/preview) is
// stubbed at apiFetch, so nothing here needs a server or a font.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import TeamTemplatePanel from './TeamTemplatePanel'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({ apiFetch }))

// This project runs vitest without `globals`, so unmount by hand.
afterEach(() => {
  cleanup()
  apiFetch.mockReset()
})

const TEAM_TEMPLATE = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 5,
  fields: [
    {
      key: 'name', label: 'Last name', type: 'text', max: 12, placeholder: 'SMITH', uppercase: true,
      zone: { x: 220, y: 380, w: 3160, h: 900 }, arch: 18,
      font: { family: 'collegiate-slab', src: 'house' }, fill: '#8C1D2D', strokes: [], offset: null
    },
    {
      key: 'number', label: 'Number', type: 'number', max: 2, placeholder: '22', uppercase: false,
      zone: { x: 900, y: 1500, w: 1800, h: 2400 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' }, fill: '#C9A227', strokes: [], offset: null
    }
  ]
}

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111'

describe('TeamTemplatePanel', () => {
  it('offers to set one up when the shirt prints on the back but has no template', () => {
    render(<TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{}} hasBackPrint />)
    expect(screen.getByText('Set up team template')).toBeTruthy()
    // No inputs — there is nothing to type into yet.
    expect(screen.queryByText('Last name')).toBeNull()
  })

  it('renders nothing at all for a front-only tee with no template', () => {
    const { container } = render(
      <TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{}} hasBackPrint={false} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows a text input per configured field, with its placeholder and character cap', () => {
    render(
      <TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{ team_template: TEAM_TEMPLATE }} hasBackPrint />
    )
    expect(screen.getByText('Last name')).toBeTruthy()
    expect(screen.getByText('Number')).toBeTruthy()
    const name = screen.getByPlaceholderText('SMITH') as HTMLInputElement
    const number = screen.getByPlaceholderText('22') as HTMLInputElement
    expect(name.maxLength).toBe(12)
    expect(number.maxLength).toBe(2)
    // A number field asks the phone for a number pad.
    expect(number.getAttribute('inputMode')).toBe('numeric')
  })

  it('shows the template even on a product the flow does not think prints on the back', () => {
    // A template IS a back print, whatever the artwork flags say — hiding it
    // here is how a configured shirt becomes invisible to the builder.
    render(
      <TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{ team_template: TEAM_TEMPLATE }} hasBackPrint={false} />
    )
    expect(screen.getByText('What the customer sees')).toBeTruthy()
  })

  it('draws the live preview from what is typed, and shows the returned plate', async () => {
    apiFetch.mockResolvedValue({ url: 'https://example.test/plate.png', values: { name: 'SMITH', number: '22' } })
    render(
      <TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{ team_template: TEAM_TEMPLATE }} hasBackPrint />
    )

    fireEvent.change(screen.getByPlaceholderText('SMITH'), { target: { value: 'Smith' } })
    fireEvent.change(screen.getByPlaceholderText('22'), { target: { value: '22' } })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled(), { timeout: 2000 })
    const [path, init] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1]
    expect(path).toBe('/api/team-plate/preview')
    const body = JSON.parse((init as any).body)
    expect(body.productId).toBe(PRODUCT_ID)
    // Uppercased by the SERVER's own sanitizer, imported rather than copied.
    expect(body.values).toEqual({ name: 'SMITH', number: '22' })

    const img = await screen.findByAltText('Your personalized back print')
    expect(img.getAttribute('src')).toBe('https://example.test/plate.png')
  })

  it('does not call the API until every field is filled — half a name is not a preview', async () => {
    render(
      <TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{ team_template: TEAM_TEMPLATE }} hasBackPrint />
    )
    fireEvent.change(screen.getByPlaceholderText('SMITH'), { target: { value: 'SMITH' } })
    await new Promise((r) => setTimeout(r, 700))
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('tells the builder exactly what an Etsy buyer is asked to type, and the limit', () => {
    render(
      <TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{ team_template: TEAM_TEMPLATE }} hasBackPrint />
    )
    expect(screen.getByText('On Etsy')).toBeTruthy()
    expect(screen.getByText(/character limit/)).toBeTruthy()
    expect(screen.getByText(/Last name: SMITH/)).toBeTruthy()
  })

  it('shows the personalization upcharge the customer will be charged', () => {
    render(
      <TeamTemplatePanel productId={PRODUCT_ID} productMetadata={{ team_template: TEAM_TEMPLATE }} hasBackPrint />
    )
    expect(screen.getByText('+$5.00')).toBeTruthy()
  })
})
