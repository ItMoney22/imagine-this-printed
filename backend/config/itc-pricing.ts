// ITC (Imagine This Coin) Pricing Configuration

export interface ITCPackage {
  itcAmount: number
  priceUSD: number
  popular?: boolean
  bonusPercent?: number
}

// ITC to USD exchange rate — THE canonical rate for the whole app (1 ITC = $0.01 USD).
//
// This used to be 0.10 here (buy side) while every redemption path — wallet
// cashout (backend/routes/wallet.ts, backend/services/stripe-connect.ts),
// store-credit conversion (wallet.ts /itc-to-credit), ITC applied at checkout
// (backend/services/order-pricing.ts: "1 ITC = $0.01 = 1 cent"), and the
// full-ITC order payment path all independently used 0.01. A customer buying
// ITC paid 10x more per token than any redemption path would ever give back —
// a real discrepancy (Wallet page showed 50 ITC as $0.50 while selling 50 ITC
// for $5.00). 0.01 is authoritative here because it's already load-bearing in
// five independent money-moving call sites (cashouts, real USD payouts);
// changing THAT side instead would have silently 10x'd every historical ITC
// balance's redemption value. Fixing the buy side (this rate + the packages
// below) is the only change with a safe, contained blast radius.
export const ITC_TO_USD_RATE = 0.01

// Predefined ITC packages with volume discounts. itcAmount is derived so that
// itcAmount * ITC_TO_USD_RATE (minus the bonus discount) equals priceUSD —
// i.e. buying a package and immediately cashing it back out only costs the
// platform's cashout fee, not 90% of the purchase.
export const ITC_PACKAGES: ITCPackage[] = [
  {
    itcAmount: 500,
    priceUSD: 5.00,
    bonusPercent: 0
  },
  {
    itcAmount: 1000,
    priceUSD: 10.00,
    bonusPercent: 0
  },
  {
    itcAmount: 2500,
    priceUSD: 22.50, // 10% discount
    bonusPercent: 10,
    popular: true
  },
  {
    itcAmount: 5000,
    priceUSD: 40.00, // 20% discount
    bonusPercent: 20
  },
  {
    itcAmount: 10000,
    priceUSD: 70.00, // 30% discount
    bonusPercent: 30
  }
]

// Calculate ITC amount from USD
export function calculateITCFromUSD(usdAmount: number): number {
  return Math.floor(usdAmount / ITC_TO_USD_RATE)
}

// Calculate USD from ITC amount
export function calculateUSDFromITC(itcAmount: number): number {
  return itcAmount * ITC_TO_USD_RATE
}

// Find the best matching package for a given USD amount
export function findPackageByUSD(usdAmount: number): ITCPackage | null {
  return ITC_PACKAGES.find(pkg => pkg.priceUSD === usdAmount) || null
}

// Find package by ITC amount
export function findPackageByITC(itcAmount: number): ITCPackage | null {
  return ITC_PACKAGES.find(pkg => pkg.itcAmount === itcAmount) || null
}

// Validate if amount is a valid package amount
export function isValidPackageAmount(usdAmount: number): boolean {
  return ITC_PACKAGES.some(pkg => pkg.priceUSD === usdAmount)
}

// Get all package amounts for validation
export function getValidPackageAmounts(): number[] {
  return ITC_PACKAGES.map(pkg => pkg.priceUSD)
}
