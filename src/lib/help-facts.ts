// The shop's answers to the questions buyers ask most (task 5878a61f, David 2026-10-07: "a real help/FAQ section
// ... so the chat and contact form get fewer repeat questions").
//
// ONE module: the help page (/help), the quick-answer cards on /contact, and what the shop chat knows all read
// from here. Numbers come from the modules that run the shop, never retyped:
//   - pickup address, hours, local delivery, rush, free-shipping line: src/utils/shipping-calculator.ts
//     (the client mirror of backend/services/order-pricing.ts)
//   - size charts: backend/shared/size-charts.ts (the same numbers printed on every product's details card)
// The processing times and the returns rules match the published policy pages (src/pages/ShippingPolicy.tsx,
// src/pages/ReturnsPolicy.tsx). If a policy changes, change it here too.
import {
  FREE_SHIPPING_THRESHOLD,
  LOCAL_DELIVERY_TIERS,
  MAX_DELIVERY_RADIUS_MILES,
  PICKUP_HOURS,
  RUSH_CUTOFF_HOUR,
  RUSH_FEE,
  STANDARD_FULFILLMENT_DAYS,
  WAREHOUSE_ADDRESS,
} from '../utils/shipping-calculator'

export const SUPPORT_EMAIL = 'wecare@imaginethisprinted.com'

export const PICKUP = {
  street: WAREHOUSE_ADDRESS.address,
  cityLine: `${WAREHOUSE_ADDRESS.city}, ${WAREHOUSE_ADDRESS.state} ${WAREHOUSE_ADDRESS.zip}`,
  hours: PICKUP_HOURS.replace(' - ', ' to '),
  readyDays: STANDARD_FULFILLMENT_DAYS,
  mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${WAREHOUSE_ADDRESS.address}, ${WAREHOUSE_ADDRESS.city}, ${WAREHOUSE_ADDRESS.state} ${WAREHOUSE_ADDRESS.zip}`
  )}`,
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`
const cutoff = `${RUSH_CUTOFF_HOUR > 12 ? RUSH_CUTOFF_HOUR - 12 : RUSH_CUTOFF_HOUR} ${RUSH_CUTOFF_HOUR >= 12 ? 'PM' : 'AM'} ET`
const [nearTier, farTier] = LOCAL_DELIVERY_TIERS

/** Printed-to-order times from the shipping policy, business days. */
export const PROCESSING = { standard: '2 to 5', custom: '3 to 7', large: '5 to 10' }

export type HelpTopicId = 'sizing' | 'turnaround' | 'shipping' | 'returns' | 'custom' | 'pickup'

export interface HelpLink { to: string; label: string }
export interface HelpItem { q: string; a: string; link?: HelpLink }
export interface HelpTopic {
  id: HelpTopicId
  title: string
  /** One line on the quick-answer card. */
  short: string
  items: HelpItem[]
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'sizing',
    title: 'Sizing',
    short: 'Unisex fit, true to size. Measurements below.',
    items: [
      { q: 'How do your shirts and hoodies fit?', a: 'They are unisex and run true to size. Between two sizes? Take the bigger one for a roomier fit.' },
      { q: 'How do I find my size?', a: 'Lay a shirt you like flat and measure straight across the chest, armpit to armpit. Find that number in the Chest column of the size chart.' },
      { q: 'Do you have kids’ sizes?', a: 'Yes. Youth tees and hoodies come in YXS to YXL on the designs that offer them. You will see them in the size picker.' },
      { q: 'What if I pick the wrong size?', a: 'Every item is printed just for you, so we can’t swap a size you picked. Check the chart before you order. If we sent the wrong size, we fix it free.', link: { to: '/returns', label: 'Returns policy' } },
    ],
  },
  {
    id: 'turnaround',
    title: 'How long it takes',
    short: `Most orders ship in ${PROCESSING.standard} business days.`,
    items: [
      { q: 'When will my order ship?', a: `Everything is printed to order. Ready-made designs ship in ${PROCESSING.standard} business days, custom designs in ${PROCESSING.custom}, and orders of 10 or more items in ${PROCESSING.large}. The clock starts when your payment goes through.` },
      { q: 'Can I get it faster?', a: `Yes, if you pick it up in Rockmart or choose local delivery: add Rush at checkout before ${cutoff} and it is ready the next business day for ${money(RUSH_FEE)}.` },
      { q: 'Ordering for a holiday?', a: 'Carriers slow down in November and December. Order at least two weeks before you need it.' },
    ],
  },
  {
    id: 'shipping',
    title: 'Shipping cost',
    short: `Free shipping when your items reach ${money(FREE_SHIPPING_THRESHOLD)}.`,
    items: [
      { q: 'How much is shipping?', a: `Checkout shows real carrier rates for your address before you pay. When the items in your cart add up to ${money(FREE_SHIPPING_THRESHOLD)} or more, standard shipping is free.` },
      { q: 'Do you deliver locally?', a: `Yes, within ${MAX_DELIVERY_RADIUS_MILES} miles of our Rockmart shop: ${money(nearTier.fee)} within ${nearTier.maxMiles} miles, ${money(farTier.fee)} from ${nearTier.maxMiles} to ${farTier.maxMiles} miles.` },
      { q: 'How do I track my order?', a: 'Your order email has a link to your order page. As soon as it ships, the tracking number shows up there and in your shipping email. Signed in? It is also under My Orders.', link: { to: '/account/orders', label: 'My Orders' } },
      { q: 'Where do you ship?', a: 'All 50 states. Checkout shows the options for your address.', link: { to: '/shipping', label: 'Shipping policy' } },
    ],
  },
  {
    id: 'returns',
    title: 'Returns',
    short: 'Something wrong? We make it right.',
    items: [
      { q: 'My order arrived damaged or wrong. What now?', a: 'Tell us within 14 days and include a photo. We will send a replacement, a refund or store credit, and most of the time you don’t need to send anything back.' },
      { q: 'Can I return something I changed my mind about?', a: 'Because each item is printed just for you, we can’t take back change-of-mind returns or a size you picked.' },
      { q: 'Can I cancel my order?', a: 'Yes, before we start printing, usually within 2 to 4 hours of ordering. Message us right away.' },
      { q: 'How long does a refund take?', a: 'Once we approve it, 5 to 10 business days to show up, depending on your bank.', link: { to: '/returns', label: 'Returns policy' } },
    ],
  },
  {
    id: 'custom',
    title: 'Custom orders',
    short: 'Your art or your idea, any quantity.',
    items: [
      { q: 'Can I put my own design on a shirt?', a: 'Yes. Open Imagination Station, upload your art or describe your idea, then pick the shirt and colors.', link: { to: '/imagination-station', label: 'Open Imagination Station' } },
      { q: 'Shirts for a team, church or business?', a: `Send us a message with the quantity, sizes and the date you need them. Orders of 10 or more take ${PROCESSING.large} business days.`, link: { to: '/contact?topic=custom', label: 'Ask about a big order' } },
      { q: 'Do you sell plain shirts?', a: 'Yes. Blank Tees has shirts with no print. Mix any sizes and colors, no minimum.', link: { to: '/blanks', label: 'Blank Tees' } },
    ],
  },
  {
    id: 'pickup',
    title: 'Pickup in Rockmart',
    short: `Free pickup at ${WAREHOUSE_ADDRESS.address}.`,
    items: [
      { q: 'Can I pick up my order?', a: `Yes, for free. Choose Free Local Pickup at checkout and pick a time. We are at ${WAREHOUSE_ADDRESS.address}, ${WAREHOUSE_ADDRESS.city}, ${WAREHOUSE_ADDRESS.state}, open ${PICKUP_HOURS.replace(' - ', ' to ')}.` },
      { q: 'When will it be ready?', a: `Usually in ${STANDARD_FULFILLMENT_DAYS} business days. Need it sooner? Add Rush for ${money(RUSH_FEE)} before ${cutoff} and it is ready the next business day.` },
    ],
  },
]

export function helpTopic(id: HelpTopicId): HelpTopic {
  return HELP_TOPICS.find((t) => t.id === id)!
}

/** Every question and answer that contains all the words searched for. Pure. */
export function searchHelp(query: string): { topic: HelpTopic; item: HelpItem }[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9$]/g, '')).filter((w) => w.length > 1)
  if (!words.length) return []
  return HELP_TOPICS.flatMap((topic) =>
    topic.items
      .filter((item) => {
        const hay = `${topic.title} ${item.q} ${item.a}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
      .map((item) => ({ topic, item }))
  )
}

/** What the shop chat may say, straight from the answers above, so it can't drift from the help page. */
export function shopChatKnowledge(): string {
  return HELP_TOPICS.map((t) => `${t.title}:\n${t.items.map((i) => `- ${i.q} ${i.a}`).join('\n')}`).join('\n\n')
}
