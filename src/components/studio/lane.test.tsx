// @vitest-environment jsdom
// The two-lane Step Flow (David 2026-09-08: "i wanted our customers to have
// the same flow on design studio … minus the etsy step ofc").
//
// The whole design rests on "same components, different lane", so what is
// worth pinning is exactly the places the lanes are allowed to differ — and,
// more importantly, the places a customer must NOT be able to reach.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { HexTracker } from './shared'
import { adminLane, customerLane } from './lane'
import { canReachStep, furthestReachableStep, initialStateFor } from './stepFlowReducer'
import { ADMIN_STEP_ORDER, CUSTOMER_STEP_ORDER, type StepId } from './types'

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see PhraseChips.test.tsx).
afterEach(cleanup)

/** A build that has cleared every step up to and including the listing. */
const finishedState = (steps: StepId[]) => ({
  ...initialStateFor(steps),
  productId: 'p1',
  assets: [{ id: 'n1', kind: 'nobg', url: 'art.png' } as any],
  stepFlow: {
    garment: 'tshirt',
    shots: { product: { approved: true, status: 'done' } },
    approvals: { design: 'x', garments: 'x', mockups: 'x', listing: 'x' },
  } as any,
})

describe('lane step order', () => {
  it('gives staff the Etsy hand-off and customers five stops', () => {
    expect(adminLane.steps).toEqual(ADMIN_STEP_ORDER)
    expect(customerLane.steps).toEqual(CUSTOMER_STEP_ORDER)
    expect(customerLane.steps).not.toContain('etsy')
  })

  it('renders one hex per stop, and no ETSY hex on the customer lane', () => {
    const { unmount } = render(
      <HexTracker step="idea" canReach={() => true} onSelect={() => {}} steps={customerLane.steps} />
    )
    expect(screen.getByText('Listing')).toBeTruthy()
    expect(screen.queryByText('Etsy')).toBeNull()
    unmount()

    render(<HexTracker step="idea" canReach={() => true} onSelect={() => {}} steps={adminLane.steps} />)
    expect(screen.getByText('Etsy')).toBeTruthy()
  })
})

describe('reachability', () => {
  // The bug this prevents: furthestReachableStep walked a module-level
  // STEP_ORDER, so the moment a customer's listing was approved it resolved
  // to `etsy` — a step their lane cannot render and their server has no route
  // for. The builder would have landed on a blank card at the exact moment
  // the build succeeded.
  it('stops a finished customer build at Listing, not at a step that does not exist', () => {
    expect(furthestReachableStep(finishedState(CUSTOMER_STEP_ORDER))).toBe('listing')
    expect(furthestReachableStep(finishedState(ADMIN_STEP_ORDER))).toBe('etsy')
  })

  it('treats a step this lane does not run as unreachable', () => {
    expect(canReachStep(finishedState(CUSTOMER_STEP_ORDER), 'etsy')).toBe(false)
    expect(canReachStep(finishedState(ADMIN_STEP_ORDER), 'etsy')).toBe(true)
  })

  it('gates the shared steps identically on both lanes', () => {
    for (const step of CUSTOMER_STEP_ORDER) {
      expect(canReachStep(finishedState(CUSTOMER_STEP_ORDER), step)).toBe(
        canReachStep(finishedState(ADMIN_STEP_ORDER), step)
      )
    }
  })
})

describe('lane wiring', () => {
  it('sends every customer call to the creator-gated rail, never the admin one', async () => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url))
      return { ok: true, json: async () => ({}) } as any
    }) as typeof fetch

    try {
      await customerLane.api.get('p1')
      await customerLane.api.phrases('street monkey')
      await customerLane.api.shotSubjects('tshirt')
      await customerLane.api.publish('p1', { title: 't', description: 'd', tags: [] })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(calls).toHaveLength(4)
    for (const url of calls) {
      expect(url).toContain('/api/studio/')
      expect(url).not.toContain('/api/admin')
    }
    // Casting is the one endpoint that lives behind the admin Etsy router for
    // staff — the customer lane must read it off its own rail instead.
    expect(calls.some((u) => u.includes('/api/studio/step/shot-subjects?garment=tshirt'))).toBe(true)
  })

  it('finishes as a submission for customers and a publish for staff', () => {
    expect(customerLane.finishLabel).toMatch(/submit/i)
    expect(adminLane.finishLabel).toMatch(/publish/i)
  })

  it('keeps team-only production tooling off the customer lane', () => {
    expect(customerLane.showTeamTools).toBe(false)
    expect(adminLane.showTeamTools).toBe(true)
    // "Try another" re-runs generation on an unmetered staff route; a customer
    // retries via Tweak, which creates a fresh, ITC-charged draft.
    expect(customerLane.regenerateTakes).toBeUndefined()
    expect(adminLane.regenerateTakes).toBeTypeOf('function')
  })
})
