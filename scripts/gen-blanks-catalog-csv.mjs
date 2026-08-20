import fs from 'fs'

const catalog = JSON.parse(fs.readFileSync('data/blanks-catalog.json', 'utf8'))

function csvEscape(value) {
  const str = String(value ?? '')
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsv(rows, headers) {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return lines.join('\n') + '\n'
}

// blanks-catalog.csv — one row per style: identity, fabric, colors, sizes
const styleHeaders = [
  'style_id', 'brand', 'style_code', 'alt_style_code', 'product_name', 'product_url',
  'fabric_weight_oz', 'material_primary', 'sizes', 'base_size_run', 'color_count', 'colors',
  'source_captured_date',
]
const styleRows = catalog.items.map((item) => ({
  style_id: item.style_id,
  brand: item.brand,
  style_code: item.style_code,
  alt_style_code: item.alt_style_code,
  product_name: item.product_name,
  product_url: item.product_url,
  fabric_weight_oz: item.fabric_weight_oz,
  material_primary: item.material_primary,
  sizes: item.sizes.join(';'),
  base_size_run: item.base_size_run,
  color_count: item.color_count,
  colors: item.colors.join(';'),
  source_captured_date: catalog.source.captured_date,
}))
fs.writeFileSync('data/blanks-catalog.csv', toCsv(styleRows, styleHeaders))

// blanks-catalog-price-breaks.csv — normalized pricing: one row per style per break type per tier
const priceHeaders = [
  'style_id', 'brand', 'style_code', 'size_group', 'break_type',
  'cart_subtotal_threshold_usd', 'color_tier', 'unit_price_usd', 'msrp_usd', 'discount_pct',
]
const priceRows = []
for (const item of catalog.items) {
  for (const grp of item.base_price_by_size_group) {
    priceRows.push({
      style_id: item.style_id,
      brand: item.brand,
      style_code: item.style_code,
      size_group: grp.sizes,
      break_type: 'single_unit',
      cart_subtotal_threshold_usd: '',
      color_tier: 'all',
      unit_price_usd: grp.street_unit_price_usd,
      msrp_usd: grp.msrp_usd,
      discount_pct: grp.msrp_usd ? Math.round((1 - grp.street_unit_price_usd / grp.msrp_usd) * 100) : '',
    })
  }
  for (const tier of item.volume_price_breaks) {
    const colorTiers = [
      ['white', tier.unit_price_white_usd],
      ['gray', tier.unit_price_gray_usd],
      ['other_colors_from', tier.unit_price_other_colors_from_usd],
    ]
    for (const [colorTier, price] of colorTiers) {
      priceRows.push({
        style_id: item.style_id,
        brand: item.brand,
        style_code: item.style_code,
        size_group: item.base_size_run,
        break_type: 'bulk_cart_subtotal',
        cart_subtotal_threshold_usd: tier.cart_subtotal_threshold_usd,
        color_tier: colorTier,
        unit_price_usd: price,
        msrp_usd: '',
        discount_pct: '',
      })
    }
  }
}
fs.writeFileSync('data/blanks-catalog-price-breaks.csv', toCsv(priceRows, priceHeaders))

console.log(`wrote ${styleRows.length} style rows, ${priceRows.length} price-break rows`)
