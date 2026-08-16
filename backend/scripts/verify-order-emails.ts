// Verifies the customer-facing transactional emails: friendly order_number,
// real customer name, carrier deep links, and the tokenized guest status link.
//
//   cd backend && npx tsx scripts/verify-order-emails.ts
//
// Needs no Resend/Supabase credentials — the Resend HTTP call is stubbed at the
// fetch boundary, so the real transport path runs and we assert on exactly what
// would have gone over the wire.
process.env.ORDER_STATUS_TOKEN_SECRET = 'test-secret'
process.env.FRONTEND_URL = 'https://imaginethisprinted.com'
process.env.AI_EMAIL_ENABLED = 'false'

import { resolveCarrier } from '../utils/carrier-tracking.js'
import {
  createOrderStatusToken,
  verifyOrderStatusToken,
  buildOrderStatusUrl,
} from '../utils/order-status-token.js'

let failures = 0
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`)
}

console.log('--- carrier deep links ---')
check('UPS from tracking shape', resolveCarrier('1Z999AA10123456784').name, 'UPS')
check('UPS deep link', resolveCarrier('1Z999AA10123456784').trackingUrl,
  'https://www.ups.com/track?tracknum=1Z999AA10123456784')
check('USPS from tracking shape', resolveCarrier('9400111899223197428490').name, 'USPS')
check('FedEx from tracking shape', resolveCarrier('123456789012').name, 'FedEx')
check('explicit carrier beats shape', resolveCarrier('123456789012', 'USPS Priority Mail').name, 'USPS')
check('service suffix resolves (UPS Ground)', resolveCarrier('X1', 'UPS Ground').name, 'UPS')
check('usps not swallowed by ups match', resolveCarrier('X1', 'usps').name, 'USPS')
check('DHL alias', resolveCarrier('ABC123456', 'DHL Express').name, 'DHL')
check('fedex smartpost', resolveCarrier('X1', 'FedEx SmartPost').name, 'FedEx')
check('spaces in tracking tolerated', resolveCarrier('1Z999AA1 0123456784').name, 'UPS')
check('unknown falls back to search', resolveCarrier('WEIRD-123').resolved, 'false')
console.log('      fallback url:', resolveCarrier('WEIRD-123').trackingUrl)

console.log('\n--- guest order-status token ---')
const orderId = '3f1c9d2e-8b7a-4c6d-9e1f-2a3b4c5d6e7f'
const token = createOrderStatusToken(orderId)
check('token length', token.length, 32)
check('valid token verifies', verifyOrderStatusToken(orderId, token), 'true')
check('tampered token rejected', verifyOrderStatusToken(orderId, token.slice(0, 31) + (token.endsWith('a') ? 'b' : 'a')), 'false')
check('short token rejected (no throw)', verifyOrderStatusToken(orderId, 'abc'), 'false')
check('missing token rejected', verifyOrderStatusToken(orderId, undefined), 'false')
check('different order id rejected', verifyOrderStatusToken('00000000-0000-0000-0000-000000000000', token), 'false')
check('deterministic across calls', createOrderStatusToken(orderId), token)
console.log('      url:', buildOrderStatusUrl(orderId))

console.log('\n--- rendered confirmation email (Resend stubbed) ---')
// Stub the network at the fetch boundary so the REAL Resend transport path runs
// and we can read exactly what would have gone over the wire.
const captured: any[] = []
process.env.RESEND_API_KEY = 'stub-key'
globalThis.fetch = (async (url: any, init: any) => {
  if (String(url).includes('api.resend.com/emails')) {
    captured.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ id: 'stub-message-id' }) } as any
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any
}) as any

const { sendOrderConfirmationEmail, sendOrderShippedEmail } = await import('../utils/email.js')

await sendOrderConfirmationEmail(
  'buyer@example.com',
  'ITP-20260726-0042',
  [{ name: 'Simply Be You Retro Varsity Tee', quantity: 2, price: 24.99 }],
  49.98,
  'Sarah Whitfield',
  { orderId }
)

await sendOrderShippedEmail(
  'buyer@example.com',
  'ITP-20260726-0042',
  '1Z999AA10123456784',
  'UPS Ground',
  { orderId, customerName: 'Sarah Whitfield' }
)

const [confirm, shipped] = captured
if (!confirm || !shipped) {
  console.log('FAIL  emails were not rendered (transport stub not hit)')
  failures++
} else {
  check('confirm subject has order_number', /ITP-20260726-0042/.test(confirm.subject), 'true')
  check('confirm subject has no uuid', /3f1c9d2e/.test(confirm.subject), 'false')
  check('confirm body has full order_number', confirm.html.includes('ITP-20260726-0042'), 'true')
  check('confirm body has no truncated id', /3F1C9D2E/.test(confirm.html), 'false')
  check('confirm greets by first name', confirm.html.includes('Hey Sarah!'), 'true')
  check('confirm has no Creative Friend', /Creative Friend/.test(confirm.html), 'false')
  check('confirm CTA is tokenized status url', confirm.html.includes(`/order-status/${orderId}?t=${token}`), 'true')
  check('confirm CTA no longer /orders', /href="https:\/\/imaginethisprinted\.com\/orders"/.test(confirm.html), 'false')

  check('shipped subject has order_number', /ITP-20260726-0042/.test(shipped.subject), 'true')
  check('shipped shows carrier name', shipped.html.includes('UPS'), 'true')
  check('shipped tracking number is a link', shipped.html.includes('href="https://www.ups.com/track?tracknum=1Z999AA10123456784"'), 'true')
  check('shipped greets by first name', shipped.html.includes('Hey Sarah'), 'true')
  check('shipped CTA is tokenized status url', shipped.html.includes(`/order-status/${orderId}?t=${token}`), 'true')
  console.log('\n      subject (confirm):', confirm.subject)
  console.log('      subject (shipped):', shipped.subject)
}

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
