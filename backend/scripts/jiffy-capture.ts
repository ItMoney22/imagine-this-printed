// Capture what Jiffy charges for every colour x size we sell on the blank line, straight from Jiffy's
// PUBLIC product endpoints (no login, no browser, no model). David 2026-10-07: "redo all our blanks
// based off of Jiffy's pricing, 15% markup ... based off of color."
//
//   /api/products/<id>/compositions                       every colour Jiffy has for the style
//   /api/products/<id>/cp                                 every size-variant's price by quantity break
//                                                         ("0" = 1-48 pieces, the price we pay)
//   /api/products/<id>/mobile_grid/mobile_grid_color?ac=  which variant id is which size, per colour
//
// Writes backend/data/jiffy-blank-costs.json (only the colours in shared/blank-line.ts). A colour Jiffy
// does not carry in a size simply has no entry for that size, which is how the store learns not to sell it.
// Then reprice: npx tsx --env-file=.env scripts/seed-blanks.ts --dry-run   (then without --dry-run)
//
//   cd backend && npx tsx scripts/jiffy-capture.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLANK_LINE } from '../shared/blank-line.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'jiffy-blank-costs.json')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const norm = (s: string) => s.toLowerCase().replace(/grey/g, 'gray').replace(/[^a-z0-9]/g, '')

async function get(url: string, json = true): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' } })
    if (res.ok) return json ? res.json() : res.text()
    await sleep(1500 * (i + 1))
  }
  throw new Error(`GET ${url} failed`)
}

export interface JiffyCostFile {
  capturedAt: string
  source: string
  tiers: Record<string, { url: string; productId: string; colors: Record<string, Record<string, number>>; notCarried: string[] }>
}

async function main() {
  const out: JiffyCostFile = { capturedAt: new Date().toISOString(), source: 'jiffy.com public prices, quantity break "0" (1-48 pieces)', tiers: {} }
  for (const tier of BLANK_LINE) {
    const html: string = await get(tier.supplier.url, false)
    const productId = html.match(/\/products\/(\d+)\/print_compositions/)?.[1] ?? html.match(/data-product-id="(\d+)"/)?.[1]
    if (!productId) throw new Error(`no Jiffy product id on ${tier.supplier.url}`)
    const comps: Array<{ color_name: string }> = await get(`https://www.jiffy.com/api/products/${productId}/compositions`)
    const prices: Record<string, Record<string, string>> = (await get(`https://www.jiffy.com/api/products/${productId}/cp`)).variant_prices ?? {}
    const jiffyName = new Map(comps.map((c) => [norm(c.color_name), c.color_name]))
    const colors: Record<string, Record<string, number>> = {}
    const notCarried: string[] = []
    for (const col of tier.colors) {
      const name = jiffyName.get(norm(col.name))
      if (!name) { notCarried.push(col.name); continue }
      await sleep(250)
      const grid: string = (await get(`https://www.jiffy.com/api/products/${productId}/mobile_grid/mobile_grid_color?ac=${encodeURIComponent(name)}`)).grid ?? ''
      if (!grid.includes(`data-color-name="${name}"`)) throw new Error(`${tier.id}: Jiffy grid did not switch to ${name}`)
      const sizes: Record<string, number> = {}
      for (const m of grid.matchAll(/data-size="([^"]+)"\s+data-variant-id="(\d+)"[\s\S]*?data-amount="([0-9.]+)"/g)) {
        const [, size, variant, amount] = m
        if (sizes[size] !== undefined || !(tier.sizes as string[]).includes(size)) continue
        sizes[size] = Number(prices[variant]?.['0'] ?? amount)
      }
      colors[col.name] = sizes
    }
    out.tiers[tier.id] = { url: tier.supplier.url, productId, colors, notCarried }
    console.log(`${tier.id}: ${Object.keys(colors).length} colours captured${notCarried.length ? `, NOT carried: ${notCarried.join(', ')}` : ''}`)
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
  console.log(`wrote ${OUT}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
