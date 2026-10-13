import type { ShippingAddress } from '../types'
import { WAREHOUSE_ADDRESS } from '../utils/shipping-calculator'
import { BUSINESS_PHONE } from './business-info'

/**
 * Ship-from (origin) address used when purchasing carrier labels.
 *
 * This is configuration, not code: every field can be overridden with a
 * `VITE_SHIP_FROM_*` environment variable so the warehouse can move without a
 * code change or redeploy of the page that buys labels.
 *
 * The defaults are the REAL warehouse and are derived from `WAREHOUSE_ADDRESS`
 * (src/utils/shipping-calculator.ts) — the same origin the checkout quotes
 * carrier rates from — so the address we quote from and the address we ship
 * from can never silently drift apart.
 */

const SHIP_FROM_ENV_KEYS = [
  'VITE_SHIP_FROM_NAME',
  'VITE_SHIP_FROM_COMPANY',
  'VITE_SHIP_FROM_STREET1',
  'VITE_SHIP_FROM_STREET2',
  'VITE_SHIP_FROM_CITY',
  'VITE_SHIP_FROM_STATE',
  'VITE_SHIP_FROM_ZIP',
  'VITE_SHIP_FROM_COUNTRY',
  'VITE_SHIP_FROM_PHONE',
  'VITE_SHIP_FROM_EMAIL'
] as const

type ShipFromEnvKey = typeof SHIP_FROM_ENV_KEYS[number]

const readEnv = (key: ShipFromEnvKey): string | undefined => {
  const raw = (import.meta.env as Record<string, string | undefined>)[key]
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed.length > 0 ? trimmed : undefined
}

export const SHIP_FROM_ADDRESS: ShippingAddress = {
  name: readEnv('VITE_SHIP_FROM_NAME') ?? 'Imagine This Printed',
  company: readEnv('VITE_SHIP_FROM_COMPANY') ?? 'Imagine This Printed LLC',
  address1: readEnv('VITE_SHIP_FROM_STREET1') ?? WAREHOUSE_ADDRESS.address,
  address2: readEnv('VITE_SHIP_FROM_STREET2'),
  city: readEnv('VITE_SHIP_FROM_CITY') ?? WAREHOUSE_ADDRESS.city,
  state: readEnv('VITE_SHIP_FROM_STATE') ?? WAREHOUSE_ADDRESS.state,
  zip: readEnv('VITE_SHIP_FROM_ZIP') ?? WAREHOUSE_ADDRESS.zip,
  country: readEnv('VITE_SHIP_FROM_COUNTRY') ?? 'US',
  // Same number the policy pages print (VITE_BUSINESS_PHONE) and the backend
  // puts on labels (BUSINESS_PHONE). Never a made-up placeholder: some carrier
  // services reject a label whose origin phone is obviously fake.
  phone: readEnv('VITE_SHIP_FROM_PHONE') ?? BUSINESS_PHONE,
  email: readEnv('VITE_SHIP_FROM_EMAIL') ?? 'shipping@imaginethisprinted.com'
}

/** True when at least one field came from the environment rather than a default. */
export const isShipFromOverridden = SHIP_FROM_ENV_KEYS.some(key => readEnv(key) !== undefined)

/** True when no origin phone is configured — carriers may reject the label. */
export const isShipFromPhoneMissing = !SHIP_FROM_ADDRESS.phone

/** Single-line rendering of the origin, for display in admin UI. */
export const formatShipFrom = (address: ShippingAddress = SHIP_FROM_ADDRESS): string =>
  [
    address.address1,
    address.address2,
    `${address.city}, ${address.state} ${address.zip}`,
    address.country !== 'US' ? address.country : null
  ]
    .filter(Boolean)
    .join(', ')

if (import.meta.env.DEV && isShipFromPhoneMissing) {
  console.warn(
    '[ship-from] No origin phone configured. Set VITE_BUSINESS_PHONE (or ' +
      'VITE_SHIP_FROM_PHONE) to the real number — some carrier services reject labels without one.'
  )
}
