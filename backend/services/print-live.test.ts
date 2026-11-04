import { describe, it, expect, vi } from 'vitest'

// Live printer cam (task 528180f9): what a push may store, and what the order
// page is told once time has passed since that push.

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))

const { customerLiveView, liveOptInStamp, parseLivePush, signedLinkExpired, LIVE_FRAME_STALE_MS } = await import('./print-live.js')

const ORDER = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-11-04T15:00:00Z')

/** An R2 presigned link: signed at `signedAt`, good for `seconds`. */
const signed = (path: string, signedAt: string, seconds: number) =>
  `https://acct.r2.cloudflarestorage.com/sculpt/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${signedAt}&X-Amz-Expires=${seconds}&X-Amz-Signature=abc`

const push = (live: Record<string, any> = {}, rest: Record<string, any> = {}) => ({
  itpOrderId: ORDER,
  lineItemId: 'line-1',
  sentAt: '2026-11-04T14:59:50Z',
  live: { state: 'printing', headline: 'Your Mini-Me is on Printer 2: layer 412/830, 2h10m left', ...live },
  ...rest,
})

const stored = (live: Record<string, any> = {}) => {
  const parsed = parseLivePush(push(live))
  if ('error' in parsed) throw new Error(parsed.error)
  return { line_item_id: 'line-1', live: parsed.push.live, updated_at: '2026-11-04T14:59:50Z' }
}

describe('parseLivePush', () => {
  it('keeps the documented fields of a real push', () => {
    const parsed = parseLivePush(
      push({
        printerName: 'Printer 2',
        layer: 412,
        totalLayers: 830,
        progress: 49.6,
        minutesLeftLabel: '2h10m left',
        frameUrl: 'https://frames.example/a.jpg',
        frameAt: '2026-11-04T14:59:40Z',
        frameStale: false,
        timelapseUrl: null,
        liveOptIn: true,
      }),
    )
    expect(parsed).toEqual({
      push: {
        orderId: ORDER,
        lineItemId: 'line-1',
        sentAt: '2026-11-04T14:59:50.000Z',
        live: {
          state: 'printing',
          printerName: 'Printer 2',
          headline: 'Your Mini-Me is on Printer 2: layer 412/830, 2h10m left',
          layer: 412,
          totalLayers: 830,
          progress: 49.6,
          minutesLeftLabel: '2h10m left',
          frameUrl: 'https://frames.example/a.jpg',
          frameAt: '2026-11-04T14:59:40.000Z',
          frameStale: false,
          timelapseUrl: null,
          liveOptIn: true,
        },
      },
    })
  })

  it('takes a push with no lineItemId, which is every custom print', () => {
    const { lineItemId: _gone, ...noLine } = push()
    const parsed = parseLivePush(noLine)
    expect('push' in parsed && parsed.push.lineItemId).toBe('')
  })

  it.each([
    ['no order id', push({}, { itpOrderId: undefined })],
    ['an order id that is not one', push({}, { itpOrderId: 'order-1' })],
    ['no live view', push({}, { live: undefined })],
    ['an unknown state', push({ state: 'exploded' })],
    ['no headline', push({ headline: '   ' })],
    ['a line id that is not a string', push({}, { lineItemId: 42 })],
    ['a line id far too long', push({}, { lineItemId: 'x'.repeat(201) })],
  ])('refuses %s', (_name, body) => {
    expect(parseLivePush(body)).toHaveProperty('error')
  })

  it('stores only https links, since they land in an img and a link on a customer page', () => {
    const parsed = parseLivePush(push({ frameUrl: 'javascript:alert(1)', timelapseUrl: 'http://plain.example/a.mp4' }))
    expect('push' in parsed && parsed.push.live.frameUrl).toBeNull()
    expect('push' in parsed && parsed.push.live.timelapseUrl).toBeNull()
  })

  it('caps progress at 100 and drops a junk frame time', () => {
    const parsed = parseLivePush(push({ progress: 140, frameAt: 'soon' }))
    expect('push' in parsed && parsed.push.live.progress).toBe(100)
    expect('push' in parsed && parsed.push.live.frameAt).toBeNull()
  })
})

describe('signedLinkExpired', () => {
  it('reads the expiry out of the signature', () => {
    const link = signed('a.jpg', '20261104T145000Z', 900) // good until 15:05:00
    expect(signedLinkExpired(link, Date.parse('2026-11-04T15:04:59Z'))).toBe(false)
    expect(signedLinkExpired(link, Date.parse('2026-11-04T15:05:00Z'))).toBe(true)
  })

  it('leaves a link with no signature dates alone', () => {
    expect(signedLinkExpired('https://frames.example/a.jpg', NOW)).toBe(false)
  })
})

describe('customerLiveView', () => {
  const fresh = { frameUrl: signed('a.jpg', '20261104T145900Z', 900), frameAt: '2026-11-04T14:59:30Z' }

  it('says live for a fresh frame on a running print', () => {
    expect(customerLiveView(stored(fresh), NOW)).toMatchObject({ isLive: true, frameUrl: fresh.frameUrl, frameAt: '2026-11-04T14:59:30.000Z' })
  })

  it('never says live when the push called the frame stale', () => {
    const view = customerLiveView(stored({ ...fresh, frameStale: true }), NOW)
    expect(view).toMatchObject({ isLive: false, frameUrl: fresh.frameUrl })
  })

  it('stops saying live on its own once the pushes stop', () => {
    const later = Date.parse(fresh.frameAt) + LIVE_FRAME_STALE_MS + 1
    expect(customerLiveView(stored(fresh), later)).toMatchObject({ isLive: false, frameUrl: fresh.frameUrl })
  })

  it('drops a frame whose link has lapsed but keeps its time for "Last update"', () => {
    const view = customerLiveView(stored(fresh), Date.parse('2026-11-04T15:20:00Z'))
    expect(view).toMatchObject({ isLive: false, frameUrl: null, frameAt: '2026-11-04T14:59:30.000Z' })
  })

  it('only ever says live while printing', () => {
    expect(customerLiveView(stored({ ...fresh, state: 'done' }), NOW).isLive).toBe(false)
  })

  it('drops a timelapse link that can no longer open', () => {
    const timelapseUrl = signed('t.mp4', '20261104T080000Z', 6 * 60 * 60) // good until 14:00
    expect(customerLiveView(stored({ state: 'done', timelapseUrl }), Date.parse('2026-11-04T13:59:00Z')).timelapseUrl).toBe(timelapseUrl)
    expect(customerLiveView(stored({ state: 'done', timelapseUrl }), NOW).timelapseUrl).toBeNull()
  })

  it('keeps the printer name and the opt-in off the customer page', () => {
    const view = customerLiveView(stored({ ...fresh, printerName: 'Batman', liveOptIn: true }), NOW)
    expect(view).not.toHaveProperty('printerName')
    expect(view).not.toHaveProperty('liveOptIn')
  })
})

describe('liveOptInStamp', () => {
  it('stamps what the checkout said, either way', () => {
    expect(liveOptInStamp(true)).toEqual({ live_opt_in: true })
    expect(liveOptInStamp(false)).toEqual({ live_opt_in: false })
  })

  it('leaves the order alone when the call said nothing', () => {
    expect(liveOptInStamp(undefined)).toEqual({})
    expect(liveOptInStamp('yes')).toEqual({})
  })
})
