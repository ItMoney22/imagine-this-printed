import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'
import { resetStorefrontKeyCache } from '../middleware/requireStorefrontSecret'
import {
  signResellerRef,
  verifyResellerRef,
  buildSaleEvent,
  signSaleBody,
  saleHookUrl,
  REF_MAX_AGE_S,
} from './qr-stand-reseller'

const KEY = 'sk_test_darrell_storefront_key_0123456789'
const NOW = Date.parse('2026-10-18T16:00:00Z')

beforeEach(() => {
  process.env.STOREFRONT_CREATOR_KEYS = JSON.stringify({
    darrell: { key: KEY, creatorUserId: '41c6873c-68a5-4365-8f6f-3ce3f1c6ae9e' },
  })
  delete process.env.STOREFRONT_SALE_HOOKS
  resetStorefrontKeyCache()
})

describe('reseller ref', () => {
  it('round-trips a ref signed with the vendor key', () => {
    const ref = signResellerRef('darrell', 'client-123', KEY, NOW)
    expect(verifyResellerRef(ref, NOW)).toEqual({ vendor: 'darrell', clientRef: 'client-123', issuedAt: NOW / 1000 })
  })

  it('treats an empty client as "bought through the shop, not signed in"', () => {
    expect(verifyResellerRef(signResellerRef('darrell', null, KEY, NOW), NOW)?.clientRef).toBeNull()
  })

  it('refuses a wrong key, a tampered payload, an unknown vendor and junk', () => {
    expect(verifyResellerRef(signResellerRef('darrell', 'c', 'sk_wrong_key_wrong_key_wrong', NOW), NOW)).toBeNull()
    const [, sig] = signResellerRef('darrell', 'c', KEY, NOW).split('.')
    const forged = Buffer.from(JSON.stringify({ s: 'darrell', c: 'someone-else', t: NOW / 1000 })).toString('base64url')
    expect(verifyResellerRef(`${forged}.${sig}`, NOW)).toBeNull()
    expect(verifyResellerRef(signResellerRef('nobody', 'c', KEY, NOW), NOW)).toBeNull()
    expect(verifyResellerRef('not-a-ref', NOW)).toBeNull()
    expect(verifyResellerRef(null, NOW)).toBeNull()
  })

  it('refuses a stale ref', () => {
    const old = signResellerRef('darrell', 'c', KEY, NOW - (REF_MAX_AGE_S + 60) * 1000)
    expect(verifyResellerRef(old, NOW)).toBeNull()
  })
})

describe('sale event', () => {
  it('names the line, its quantity and what was paid, with an id per order line', () => {
    const ev = buildSaleEvent(
      { id: 'order-1', order_number: 'ITP-1' },
      { lineIndex: 2, vendor: 'darrell', clientRef: 'client-123', quantity: 2, grossCents: 3590 },
      'Custom QR Counter Stand',
      new Date(NOW)
    )
    expect(ev).toEqual({
      id: 'itp-qr-stand-order-1-2',
      type: 'product_sale.paid',
      occurredAt: '2026-10-18T16:00:00.000Z',
      product: { kind: 'qr-stand', name: 'Custom QR Counter Stand' },
      order: { id: 'order-1', number: 'ITP-1' },
      line: { index: 2, quantity: 2, grossCents: 3590 },
      clientRef: 'client-123',
    })
  })

  it('signs the raw body the way the receiving site checks it', () => {
    const body = '{"a":1}'
    const expected = 'sha256=' + crypto.createHmac('sha256', KEY).update(body, 'utf8').digest('hex')
    expect(signSaleBody(body, KEY)).toBe(expected)
  })

  it('sends Darrell\'s sales to his site unless overridden', () => {
    expect(saleHookUrl('darrell')).toBe('https://darrellmccutchen.com/api/itp/product-sale')
    expect(saleHookUrl('someone')).toBeNull()
    process.env.STOREFRONT_SALE_HOOKS = JSON.stringify({ someone: 'https://someone.example/hook', bad: 'http://plain' })
    expect(saleHookUrl('someone')).toBe('https://someone.example/hook')
    expect(saleHookUrl('bad')).toBeNull()
  })
})
