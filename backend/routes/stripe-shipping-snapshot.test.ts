import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// snapshotShippingChoice — the trust boundary between what the checkout page
// CLAIMS the customer picked and what gets written onto a real order.
//
// Added 2026-08-07. Before it, POST /checkout-payment-intent destructured only
// the three shipping fields it needed for PRICING and threw the rest away, so
// nothing about the customer's fulfilment choice was ever persisted: Order
// Management could show "$0.00 shipping" without being able to say whether that
// meant local pickup or free-shipping-over-$50, and a pickup appointment the
// customer chose was gone the moment the request ended.
//
// Every dollar figure here must come from the SERVER's pricing result. `method`
// is the only client-supplied value and is display-only.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SUPABASE_JWT_SECRET ||= 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_snapshot'

const { snapshotShippingChoice } = await import('./stripe.js')

/** Server-priced pickup: $0 shipping, no rush. */
const PICKUP_PRICING = { shippingCents: 0, rushFeeCents: 0, freeShippingApplied: false }

describe('snapshotShippingChoice', () => {
  it('records a pickup with its appointment', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: 'Local Pickup',
      shippingType: 'pickup',
      pickupAppointment: { date: '2026-08-09', time: '2:00 PM', notes: 'Ring the side door' },
      isLocalDelivery: false,
      ...PICKUP_PRICING
    })

    expect(snap.type).toBe('pickup')
    expect(snap.method).toBe('Local Pickup')
    expect(snap.amount).toBe(0)
    expect(snap.pickup_appointment).toEqual({
      date: '2026-08-09',
      time: '2:00 PM',
      notes: 'Ring the side door'
    })
  })

  it('distinguishes a $0 pickup from $0 free shipping — the ambiguity that started this', () => {
    const pickup = snapshotShippingChoice({
      shippingMethod: 'Local Pickup', shippingType: 'pickup',
      pickupAppointment: null, isLocalDelivery: false, ...PICKUP_PRICING
    })
    const freeShip = snapshotShippingChoice({
      shippingMethod: 'USPS Ground Advantage', shippingType: 'shipping',
      pickupAppointment: null, isLocalDelivery: false,
      shippingCents: 0, rushFeeCents: 0, freeShippingApplied: true
    })

    // Same $0 on the order; completely different instruction to the crew.
    expect(pickup.amount).toBe(0)
    expect(freeShip.amount).toBe(0)
    expect(pickup.type).toBe('pickup')
    expect(freeShip.type).toBe('shipping')
    expect(freeShip.free_shipping_applied).toBe(true)
    expect(pickup.free_shipping_applied).toBe(false)
  })

  it('takes rush from the SERVER fee, not the client claim', () => {
    // Client says rush on a carrier rate; resolveShipping only ever charges the
    // rush fee for pickup/delivery, so rushFeeCents is 0 and rush must read false.
    const lying = snapshotShippingChoice({
      shippingMethod: 'USPS Ground Advantage — Rush (Next Business Day)',
      shippingType: 'shipping',
      pickupAppointment: null, isLocalDelivery: false,
      shippingCents: 845, rushFeeCents: 0, freeShippingApplied: false
    })
    expect(lying.rush).toBe(false)
    expect(lying.rush_fee).toBe(0)

    const real = snapshotShippingChoice({
      shippingMethod: 'Local Pickup — Rush (Next Business Day)',
      shippingType: 'pickup',
      pickupAppointment: null, isLocalDelivery: false,
      shippingCents: 799, rushFeeCents: 799, freeShippingApplied: false
    })
    expect(real.rush).toBe(true)
    expect(real.rush_fee).toBe(7.99)
    expect(real.amount).toBe(7.99)
  })

  it('converts server cents to dollars rather than trusting any client amount', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: 'UPS 2nd Day Air', shippingType: 'shipping',
      pickupAppointment: null, isLocalDelivery: false,
      shippingCents: 1234, rushFeeCents: 0, freeShippingApplied: false
    })
    expect(snap.amount).toBe(12.34)
  })

  it('falls back to a real label instead of leaving the method blank', () => {
    for (const [type, expected] of [
      ['pickup', 'Local Pickup'],
      ['delivery', 'Local Delivery'],
      ['shipping', 'Standard Shipping']
    ] as const) {
      const snap = snapshotShippingChoice({
        shippingMethod: '   ', shippingType: type,
        pickupAppointment: null, isLocalDelivery: false, ...PICKUP_PRICING
      })
      expect(snap.method).toBe(expected)
    }
  })

  it('rejects an unknown shipping type rather than storing it', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: 'Teleportation', shippingType: 'teleport',
      pickupAppointment: null, isLocalDelivery: false, ...PICKUP_PRICING
    })
    expect(snap.type).toBe('shipping')
    // The label is display-only, so it survives; the TYPE does not.
    expect(snap.method).toBe('Teleportation')
  })

  it('caps and collapses a hostile method label', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: 'A'.repeat(500) + '\n\n   spaced   out',
      shippingType: 'shipping',
      pickupAppointment: null, isLocalDelivery: false, ...PICKUP_PRICING
    })
    expect(snap.method!.length).toBeLessThanOrEqual(120)
    expect(snap.method).not.toContain('\n')
  })

  it('never attaches an appointment to a non-pickup order', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: 'USPS Ground Advantage', shippingType: 'shipping',
      pickupAppointment: { date: '2026-08-09', time: '2:00 PM', notes: 'x' },
      isLocalDelivery: false, ...PICKUP_PRICING
    })
    expect(snap.pickup_appointment).toBeNull()
  })

  it('records a pickup with no chosen time as nulls, not as missing', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: 'Local Pickup', shippingType: 'pickup',
      pickupAppointment: { date: '', time: null, notes: undefined },
      isLocalDelivery: false, ...PICKUP_PRICING
    })
    // The distinction the crew needs: "pickup, time not set" vs "not a pickup".
    expect(snap.pickup_appointment).toEqual({ date: null, time: null, notes: null })
  })

  it('flags local delivery from the type even if the client omits the boolean', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: 'Local Delivery', shippingType: 'delivery',
      pickupAppointment: null, isLocalDelivery: undefined,
      shippingCents: 1000, rushFeeCents: 0, freeShippingApplied: false
    })
    expect(snap.is_local_delivery).toBe(true)
    expect(snap.amount).toBe(10)
  })

  it('survives a completely absent selection', () => {
    const snap = snapshotShippingChoice({
      shippingMethod: undefined, shippingType: undefined,
      pickupAppointment: undefined, isLocalDelivery: undefined, ...PICKUP_PRICING
    })
    expect(snap.type).toBe('shipping')
    expect(snap.method).toBe('Standard Shipping')
    expect(snap.pickup_appointment).toBeNull()
    expect(typeof snap.recorded_at).toBe('string')
  })
})
