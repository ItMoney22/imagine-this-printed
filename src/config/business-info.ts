import { WAREHOUSE_ADDRESS } from '../utils/shipping-calculator'

// One place for the business identity printed on every policy page.
export const BUSINESS_LEGAL_NAME = 'Imagine This Printed LLC'
export const BUSINESS_EMAIL = 'wecare@imaginethisprinted.com'
export const BUSINESS_ADDRESS_LINE =
  `${WAREHOUSE_ADDRESS.address}, ${WAREHOUSE_ADDRESS.city}, ${WAREHOUSE_ADDRESS.state} ${WAREHOUSE_ADDRESS.zip}`

// The real support phone is set per environment; never hardcode a guess.
const rawPhone = (import.meta.env as Record<string, string | undefined>).VITE_BUSINESS_PHONE
export const BUSINESS_PHONE: string | undefined = rawPhone && rawPhone.trim() ? rawPhone.trim() : undefined

// Dates each policy's content actually last changed.
export const POLICY_UPDATED = {
  shipping: 'October 7, 2026',
  returns: 'October 7, 2026',
  privacy: 'October 7, 2026',
  terms: 'October 7, 2026'
} as const
