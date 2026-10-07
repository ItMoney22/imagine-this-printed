// Who and where the shop is, in one place (task b9656cc9). The home trust
// strip and the footer read these, so a shopper never sees two answers.
// The address itself stays in shipping-calculator (it prices pickup).
import { WAREHOUSE_ADDRESS } from '../utils/shipping-calculator'

export const SHOP_FACTS = {
  legalName: 'Imagine This Printed LLC',
  brandName: 'Imagine This Printed',
  town: WAREHOUSE_ADDRESS.city,
  stateCode: WAREHOUSE_ADDRESS.state,
  stateName: 'Georgia',
  etsyUrl: 'https://www.etsy.com/shop/ImagineThisPrinted1',
} as const
