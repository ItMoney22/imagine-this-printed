// @vitest-environment jsdom
// The live printer view on an order page (task 528180f9): what the owner sees,
// how it is labelled, and that it keeps itself fresh every 30 seconds.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

const apiFetch = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

const { default: LivePrintView } = await import('./LivePrintView')
const { LIVE_POLL_MS } = await import('../lib/live-print')

const ORDER = '11111111-1111-4111-8111-111111111111'

const line = (over: Record<string, unknown> = {}) => ({
  lineItemId: '',
  state: 'printing',
  headline: 'Your Mini-Me is on Printer 2: layer 412/830, 2h10m left',
  progress: 49,
  frameUrl: 'https://frames.example/a.jpg',
  frameAt: '2026-11-04T14:59:40.000Z',
  isLive: true,
  timelapseUrl: null,
  ...over,
})

const answers = (...lines: ReturnType<typeof line>[]) => apiFetch.mockResolvedValue({ lines })

const show = async (props: Partial<{ poll: boolean }> = {}) => {
  const view = render(<LivePrintView orderId={ORDER} {...props} />)
  await act(async () => {})
  return view
}

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  apiFetch.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('LivePrintView', () => {
  it('asks for this order and shows the headline and the frame', async () => {
    answers(line())
    await show()
    expect(apiFetch).toHaveBeenCalledWith(`/api/orders/${ORDER}/live`)
    expect(screen.getByText('Your Mini-Me is on Printer 2: layer 412/830, 2h10m left')).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://frames.example/a.jpg')
  })

  it('labels a fresh frame Live', async () => {
    answers(line())
    await show()
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.queryByText(/Last update/)).toBeNull()
  })

  it('labels a stale frame Last update with the time it was taken', async () => {
    answers(line({ isLive: false }))
    await show()
    expect(screen.queryByText('Live')).toBeNull()
    const when = new Date('2026-11-04T14:59:40.000Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    expect(screen.getByText(`Last update ${when}`)).toBeTruthy()
  })

  it('polls every 30 seconds and shows the newest view', async () => {
    answers(line())
    await show()
    expect(LIVE_POLL_MS).toBe(30_000)
    answers(line({ headline: 'Your Mini-Me is on Printer 2: layer 500/830, 1h40m left', frameUrl: 'https://frames.example/b.jpg' }))

    await tick(29_000)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    await tick(1_000)
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Your Mini-Me is on Printer 2: layer 500/830, 1h40m left')).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://frames.example/b.jpg')
  })

  it('shows the timelapse link only when there is one', async () => {
    answers(line({ state: 'done', frameUrl: null, frameAt: null, isLive: false, timelapseUrl: 'https://frames.example/t.mp4' }))
    await show()
    expect(screen.getByRole('link', { name: 'Watch the timelapse' }).getAttribute('href')).toBe('https://frames.example/t.mp4')
    cleanup()

    answers(line())
    await show()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows nothing at all before the print has a view', async () => {
    answers()
    const { container } = await show()
    expect(container.textContent).toBe('')
  })

  it('stops asking when the order is not this customer\'s', async () => {
    apiFetch.mockRejectedValue(new Error('HTTP 404: {"error":"Order not found"}'))
    const { container } = await show()
    await tick(LIVE_POLL_MS * 3)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('')
  })

  it('keeps the last view up through a blip and carries on', async () => {
    answers(line())
    await show()
    apiFetch.mockRejectedValueOnce(new Error('HTTP 503: down'))
    await tick(LIVE_POLL_MS)
    expect(screen.getByText('Live')).toBeTruthy()
    await tick(LIVE_POLL_MS)
    expect(apiFetch).toHaveBeenCalledTimes(3)
  })

  it('reads once and stops when the order is past the printer', async () => {
    answers(line({ state: 'done', frameUrl: null, frameAt: null, isLive: false }))
    await show({ poll: false })
    await tick(LIVE_POLL_MS * 2)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('drops a frame that will not load and stops calling it Live', async () => {
    answers(line())
    await show()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.getByText(/Last update/)).toBeTruthy()
  })

  it('stops polling when it leaves the page', async () => {
    answers(line())
    const { unmount } = await show()
    unmount()
    await tick(LIVE_POLL_MS * 2)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})
