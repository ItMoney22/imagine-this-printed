// Which ITP product she asked to see a picture on (her store assistant's mockups, services/store-mockup.ts renders them).
// Dependency-free apart from the catalog, so the assistant's brain (store-assistant.ts) and the reminder worker that
// shares it never load the render stack.
import { COLORS, getGarment, type ColorId, type GarmentId } from '../shared/catalog-capability.js'

/** What ITP makes that a picture can be mocked up on: its three garments and its metal prints. */
export type MockupProduct = GarmentId | 'metal'
export type MetalSize = '4x6' | '8x10'
export const MOCKUP_PRODUCTS: Record<MockupProduct, { noun: string }> = {
  tshirt: { noun: 'tee' },
  hoodie: { noun: 'hoodie' },
  'youth-tshirt': { noun: 'kids tee' },
  metal: { noun: 'metal print' },
}
export const COLOR_IDS = Object.keys(COLORS) as ColorId[]
export type MockupChoice = { product: MockupProduct; color: ColorId | null; size: MetalSize | null }

const isProduct = (v: unknown): v is MockupProduct => typeof v === 'string' && v in MOCKUP_PRODUCTS
const isColor = (v: unknown): v is ColorId => typeof v === 'string' && (COLOR_IDS as string[]).includes(v)

/** What the assistant asked for, kept only when it is something ITP makes. Colours belong to garments, sizes to metal. */
export function mockupChoice(raw: { product?: unknown; color?: unknown; size?: unknown } | null | undefined): MockupChoice | null {
  if (!raw || !isProduct(raw.product)) return null
  const metal = raw.product === 'metal'
  const color = !metal && isColor(raw.color) && getGarment(raw.product)!.colors.includes(raw.color) ? raw.color : null
  const size = metal ? (raw.size === '4x6' ? '4x6' : '8x10') : null
  return { product: raw.product, color, size }
}

const ASKS_FOR_MOCKUP = /\bmock|\b(put|print|place|slap)\s+(it|this|that|them|my\s+\w+)\s+on\b|\b(show|see)\s+(it|this|that|me|how)\b[^.?!]*\bon\s+an?\b|\bp[oó]n(lo|la|melo|mela)\s+en\b/i
const COLOR_WORDS: Array<[RegExp, ColorId]> = [
  [/\b(black|negr[oa])\b/i, 'black'],
  [/\b(white|blanc[oa])\b/i, 'white'],
  [/\bnavy\b/i, 'navy'],
  [/\b(gr[ae]y|heather|gris)\b/i, 'heather-grey'],
  [/\b(red|roj[oa])\b/i, 'red'],
  [/\b(green|verde)\b/i, 'forest-green'],
  [/\b(royal|blue|azul)\b/i, 'royal-blue'],
]
const PRODUCT_WORDS: Array<[RegExp, MockupProduct]> = [
  [/\b(kids?|youth|child(ren)?|toddlers?|ni[ñn][oa]s?)\b/i, 'youth-tshirt'],
  [/\b(hoodies?|sweatshirts?|sudaderas?)\b/i, 'hoodie'],
  [/\b(metal|aluminum|wall\s+art|signs?)\b/i, 'metal'],
  [/\b(t-?shirts?|tees?|shirts?|camis(as?|etas?))\b/i, 'tshirt'],
]
const NOT_MADE = /\b(polos?|tanks?|tank\s+tops?|mugs?|tumblers?|hats?|caps?|stickers?|totes?|bags?|phone\s+cases?|pillows?|blankets?)\b/i

/**
 * Her words read for a mockup ask, for when the assistant did not set one: "mock this on a shirt" must never depend on
 * the model noticing. Null when she is not asking for one, or names something ITP doesn't make (the assistant says so).
 */
export function mockupAsk(text: string): MockupChoice | null {
  const t = String(text || '')
  if (!ASKS_FOR_MOCKUP.test(t)) return null
  const product = PRODUCT_WORDS.find(([re]) => re.test(t))?.[1]
  if (!product && NOT_MADE.test(t)) return null
  return mockupChoice({
    product: product || 'tshirt',
    color: COLOR_WORDS.find(([re]) => re.test(t))?.[1],
    size: /\b4\s*x\s*6\b|\bsmall\b/i.test(t) ? '4x6' : '8x10',
  })
}

/** How the product reads in a sentence: "black tee", "kids tee", "8 x 10 metal print". */
export function mockupLabel(m: { product: MockupProduct; color?: ColorId | null; size?: MetalSize | null }): string {
  if (m.product === 'metal') return `${(m.size || '8x10').replace('x', ' x ')} metal print`
  const color = m.color ? COLORS[m.color].label.toLowerCase() : ''
  return `${color ? color + ' ' : ''}${MOCKUP_PRODUCTS[m.product].noun}`
}
