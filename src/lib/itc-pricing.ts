// ITC ↔ USD display helper.
// 1 ITC = $0.01 — matches backend ITC_TO_USD (backend/routes/wallet.ts) and the
// checkout credit rate (Checkout.tsx). Use this everywhere we show a USD price
// so the ITC figure shown matches what the customer is actually charged if they
// pay with coins.
export const ITC_PER_USD = 100

export function usdToItc(usd: number): number {
  return Math.round(usd * ITC_PER_USD)
}

/** ITC -> USD as a number (15 ITC -> 0.15) */
export function itcToUsd(itc: number): number {
  return itc / ITC_PER_USD
}

/** "$0.15" — what the customer actually pays in dollars for an ITC amount */
export function itcToUsdLabel(itc: number): string {
  return `$${itcToUsd(itc).toFixed(2)}`
}

/** "2,999 ITC" */
export function formatItc(itc: number): string {
  return `${itc.toLocaleString()} ITC`
}

/** "2,999 ITC" from a USD amount */
export function usdToItcLabel(usd: number): string {
  return formatItc(usdToItc(usd))
}
