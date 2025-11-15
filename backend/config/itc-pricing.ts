// ITC Pricing Configuration

export interface ITCPackage {
  itcAmount: number
  priceUSD: number
  popular?: boolean
  bonusPercent?: number
}

// ITC to USD exchange rate (1 ITC = $0.10 USD)
export const ITC_TO_USD_RATE = 0.10

// Predefined ITC packages with volume discounts
export const ITC_PACKAGES: ITCPackage[] = [
  {
    itcAmount: 50,
    priceUSD: 5.00,
    bonusPercent: 0
  },
  {
    itcAmount: 100,
    priceUSD: 10.00,
    bonusPercent: 0
  },
  {
    itcAmount: 250,
    priceUSD: 22.50, // 10% discount
    bonusPercent: 10,
    popular: true
  },
  {
    itcAmount: 500,
    priceUSD: 40.00, // 20% discount
    bonusPercent: 20
  },
  {
    itcAmount: 1000,
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
