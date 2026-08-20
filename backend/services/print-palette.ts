/**
 * Print palette: extract the dominant flat colors from a toy's concept art and
 * match them against the print_materials inventory.
 *
 * Why ≤4: the AMS feeds at most 4 spools, and the color4 concept prompt
 * (nano-banana-3d.ts COLOR4_CLAUSE) already constrains the art to at most 4
 * flat colors — this closes the loop so a purchase tells the floor exactly
 * which filament to load, and a paint kit ships the right paints.
 *
 * Everything here degrades gracefully: palette extraction failures and a
 * missing print_materials table both return null rather than throwing, so the
 * order/print flow never blocks on this feature.
 */
import sharp from 'sharp'
import { supabase } from '../lib/supabase.js'

export interface PaletteEntry {
  hex: string
  /** 0..1 share of foreground pixels */
  pct: number
}

export interface MaterialMatch {
  slot: number
  target_hex: string
  material_id: string | null
  color_name: string | null
  brand: string | null
  material: string | null
  matched_hex: string | null
  /** true when a stocked material was found within tolerance */
  in_stock: boolean
}

export type MaterialKind = 'filament' | 'paint'

const MAX_COLORS = 4
const MIN_COVERAGE = 0.04 // drop accents under 4% of foreground
const MERGE_DISTANCE = 60 // RGB euclidean distance to merge quantized bins
const SAMPLE_SIZE = 64

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  // Perceptual-ish weighting (red 30%, green 59%, blue 11% is too aggressive
  // for matching filament — plain euclidean with a mild green bias reads best).
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.9)
}

/**
 * Extract up to `maxColors` dominant flat colors from an image URL.
 * Background is estimated from the four corners and excluded, so a
 * white-background concept render yields the figure's colors, not white.
 */
export async function extractPalette(
  imageUrl: string,
  maxColors: number = MAX_COLORS
): Promise<PaletteEntry[] | null> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())

    const { data, info } = await sharp(buf)
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const px = (x: number, y: number): [number, number, number] => {
      const i = (y * info.width + x) * 3
      return [data[i], data[i + 1], data[i + 2]]
    }

    // Background estimate: average of the four corners.
    const corners = [
      px(0, 0),
      px(info.width - 1, 0),
      px(0, info.height - 1),
      px(info.width - 1, info.height - 1)
    ]
    const bg: [number, number, number] = [
      corners.reduce((s, c) => s + c[0], 0) / 4,
      corners.reduce((s, c) => s + c[1], 0) / 4,
      corners.reduce((s, c) => s + c[2], 0) / 4
    ]

    // Quantize foreground pixels into coarse bins.
    const bins = new Map<number, { count: number; r: number; g: number; b: number }>()
    let foreground = 0
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const p = px(x, y)
        if (dist(p, bg) < 40) continue // background / shadow halo
        foreground++
        const key = ((p[0] >> 5) << 10) | ((p[1] >> 5) << 5) | (p[2] >> 5)
        const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
        bin.count++
        bin.r += p[0]
        bin.g += p[1]
        bin.b += p[2]
        bins.set(key, bin)
      }
    }
    if (foreground === 0) return null

    // Rank bins, then greedily merge anything close to an already-picked color.
    const ranked = [...bins.values()]
      .map(b => ({
        count: b.count,
        rgb: [b.r / b.count, b.g / b.count, b.b / b.count] as [number, number, number]
      }))
      .sort((a, b) => b.count - a.count)

    const picked: { count: number; rgb: [number, number, number] }[] = []
    for (const cand of ranked) {
      const near = picked.find(p => dist(p.rgb, cand.rgb) < MERGE_DISTANCE)
      if (near) {
        // Weighted merge into the existing color.
        const total = near.count + cand.count
        near.rgb = [
          (near.rgb[0] * near.count + cand.rgb[0] * cand.count) / total,
          (near.rgb[1] * near.count + cand.rgb[1] * cand.count) / total,
          (near.rgb[2] * near.count + cand.rgb[2] * cand.count) / total
        ]
        near.count = total
      } else {
        picked.push({ count: cand.count, rgb: cand.rgb })
      }
    }

    return picked
      .sort((a, b) => b.count - a.count)
      .filter(p => p.count / foreground >= MIN_COVERAGE)
      .slice(0, maxColors)
      .map(p => ({ hex: rgbToHex(...p.rgb), pct: Math.round((p.count / foreground) * 100) / 100 }))
  } catch (err) {
    console.warn('[print-palette] extraction failed:', (err as Error).message)
    return null
  }
}

/**
 * Match a palette against in-stock print_materials of the given kind.
 * Returns one entry per palette color; `in_stock: false` marks colors with no
 * stocked match so the floor sees the gap. Returns null when the inventory
 * table is missing/unreadable (feature not yet provisioned in prod).
 */
export async function matchMaterials(
  palette: PaletteEntry[],
  kind: MaterialKind
): Promise<MaterialMatch[] | null> {
  if (!palette.length) return []
  try {
    const { data, error } = await supabase
      .from('print_materials')
      .select('id, brand, material, color_name, hex, qty_on_hand')
      .eq('kind', kind)
      .eq('is_active', true)
      .gt('qty_on_hand', 0)
    if (error) throw error

    const stock = (data ?? [])
      .map(m => ({ ...m, rgb: hexToRgb(m.hex) }))
      .filter((m): m is typeof m & { rgb: [number, number, number] } => m.rgb !== null)

    return palette.slice(0, MAX_COLORS).map((entry, i) => {
      const target = hexToRgb(entry.hex)
      let best: (typeof stock)[number] | null = null
      let bestDist = Infinity
      if (target) {
        for (const m of stock) {
          const d = dist(target, m.rgb)
          if (d < bestDist) {
            bestDist = d
            best = m
          }
        }
      }
      // Beyond ~140 the "match" would visibly be the wrong color — report the
      // gap instead of silently loading the closest spool.
      const ok = best !== null && bestDist <= 140
      return {
        slot: i + 1,
        target_hex: entry.hex,
        material_id: ok ? best!.id : null,
        color_name: ok ? best!.color_name : null,
        brand: ok ? best!.brand : null,
        material: ok ? best!.material : null,
        matched_hex: ok ? best!.hex : null,
        in_stock: ok
      }
    })
  } catch (err) {
    console.warn('[print-palette] material match unavailable:', (err as Error).message)
    return null
  }
}

/** One-line human summary for the print-floor email. */
export function describeMaterialPlan(plan: MaterialMatch[] | null, kind: MaterialKind): string {
  if (!plan || plan.length === 0) return ''
  const noun = kind === 'filament' ? 'Load filament' : 'Pack paints'
  const parts = plan.map(p =>
    p.in_stock
      ? `${p.slot}. ${p.color_name} (${p.brand} ${p.material}, ${p.matched_hex})`
      : `${p.slot}. NO STOCK MATCH for ${p.target_hex} — restock needed`
  )
  return `${noun}: ${parts.join('; ')}`
}
