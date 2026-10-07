// ---------------------------------------------------------------------------
// Mini-Me backend helpers (David 2026-10-07): the sculpt prompt, upload checks,
// a per-user rate limit, and Mrs. Imagine's filament plan ("what colors we need
// to get the printer going").
//
// Everything here is pure except getMiniMeFilamentPlan (one print_materials read
// through matchMaterials). Tests: mini-me.test.ts.
// ---------------------------------------------------------------------------
import { matchMaterials, type PaletteEntry, type MaterialMatch } from './print-palette.js'
import { MINI_ME_MAX_COLORS, type MiniMeColorMode } from '../shared/mini-me.js'

/** Default prompt row text (validatePrompt needs >= 10 chars; the photo carries the real brief). */
export const MINI_ME_DEFAULT_PROMPT = 'Mini-Me statue from a customer photo'

/**
 * The image-edit brief sent with the customer's photo. Likeness first, then the
 * things a printer needs: one solid figure, chunky limbs, a flat round base.
 */
export function buildMiniMePrompt(colorMode: MiniMeColorMode, note?: string | null): string {
  const clauses = [
    'Turn the person in this photo into a collectible 3D figurine of THIS exact person: keep their face, hairstyle, skin tone, glasses, facial hair and clothing recognizable',
    'Full body, standing in a relaxed neutral pose, arms close to the body, facing forward',
    'Slightly stylized collectible proportions (head a little larger), smooth sculpted surfaces',
    'Standing on a simple flat round base',
    'Printable as one solid piece: no thin or floating parts, no loose strands of hair, fingers merged into simple hands',
    'Plain light grey studio background, soft even lighting, no text, no logo, no watermark'
  ]
  if (colorMode === 'color4') {
    clauses.push(`Paint the figurine in at most ${MINI_ME_MAX_COLORS} flat solid colors in large clear regions (for example skin, hair, top, pants), no gradients and no fine pattern`)
  } else {
    clauses.push('Render the figurine as an unpainted matte white sculpture so the shapes read clearly')
  }
  const extra = (note || '').trim().slice(0, 200)
  if (extra) clauses.push(`Customer note: ${extra}`)
  return clauses.join('. ') + '.'
}

// ---------------------------------------------------------------------------
// Upload checks
// ---------------------------------------------------------------------------

export const MINI_ME_PHOTO_MAX_BYTES = 15 * 1024 * 1024
export const MINI_ME_VIDEO_MAX_BYTES = 100 * 1024 * 1024

/** Video container sniff: MP4/MOV carry 'ftyp' at byte 4; WebM starts with the EBML magic. */
export function sniffVideoContentType(buf: Buffer): 'video/mp4' | 'video/quicktime' | 'video/webm' | null {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm'
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  return null
}

export function extForVideo(contentType: string): string {
  return contentType === 'video/webm' ? 'webm' : contentType === 'video/quicktime' ? 'mov' : 'mp4'
}

/** The consent box must be ticked: "I own this photo or have permission to use it." */
export function hasConsent(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 'on'
}

// ---------------------------------------------------------------------------
// Rate limit (per user, in memory). A sculpt costs real money (image model +
// Tripo), so one account can't hammer it. Resets on restart, which is fine:
// the worker still charges ITC per concept.
// ---------------------------------------------------------------------------

export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  return {
    /** True when this call is allowed (and counts it). */
    take(key: string): boolean {
      const t = now()
      const recent = (hits.get(key) || []).filter(ts => t - ts < windowMs)
      if (recent.length >= max) {
        hits.set(key, recent)
        return false
      }
      recent.push(t)
      hits.set(key, recent)
      return true
    }
  }
}

// ---------------------------------------------------------------------------
// Mrs. Imagine's filament plan
// ---------------------------------------------------------------------------

/** Plain names for filament colors a shop would actually buy. */
const NAMED_COLORS: Array<{ name: string; hex: string }> = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Ivory', hex: '#f2ebd9' },
  { name: 'Light Skin Tone', hex: '#f1c27d' },
  { name: 'Medium Skin Tone', hex: '#c68642' },
  { name: 'Deep Skin Tone', hex: '#8d5524' },
  { name: 'Beige', hex: '#d7c9a5' },
  { name: 'Light Grey', hex: '#c0c0c0' },
  { name: 'Grey', hex: '#808080' },
  { name: 'Charcoal', hex: '#36454f' },
  { name: 'Black', hex: '#000000' },
  { name: 'Red', hex: '#c8102e' },
  { name: 'Maroon', hex: '#6a1b2c' },
  { name: 'Pink', hex: '#f65973' },
  { name: 'Light Pink', hex: '#f7c6d4' },
  { name: 'Orange', hex: '#f26f21' },
  { name: 'Yellow', hex: '#f2c230' },
  { name: 'Brown', hex: '#7b4b2a' },
  { name: 'Dark Brown', hex: '#3b2418' },
  { name: 'Olive', hex: '#5b6236' },
  { name: 'Green', hex: '#2e8b4a' },
  { name: 'Lime', hex: '#9acd32' },
  { name: 'Teal', hex: '#008080' },
  { name: 'Light Blue', hex: '#a9c7e6' },
  { name: 'Sky Blue', hex: '#7bafd4' },
  { name: 'Denim Blue', hex: '#1f5fa8' },
  { name: 'Royal Blue', hex: '#2e4da7' },
  { name: 'Navy', hex: '#1b2a49' },
  { name: 'Purple', hex: '#5b2c8f' },
  { name: 'Lavender', hex: '#b57edc' }
]

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Nearest plain color name for a hex ("#e0ac69" -> "Light Skin Tone"). */
export function nameForHex(hex: string): string {
  const c = rgb(hex)
  if (!c) return 'Unknown color'
  let best = NAMED_COLORS[0]
  let bestD = Infinity
  for (const n of NAMED_COLORS) {
    const r = rgb(n.hex)!
    const d = (c[0] - r[0]) ** 2 + (c[1] - r[1]) ** 2 + (c[2] - r[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return best.name
}

export interface MiniMeFilamentSlot {
  slot: number
  /** The color the statue needs (from the concept palette). */
  hex: string
  /** Plain name for that color, for the customer and the floor. */
  name: string
  /** True when a stocked filament is close enough to load as-is. */
  inStock: boolean
  /** What to load: the stocked spool, or what to buy. */
  load: string
}

/** Turn matchMaterials' slots into Mrs. Imagine's plan (pure). */
export function toFilamentPlan(matches: MaterialMatch[] | null, palette: PaletteEntry[]): MiniMeFilamentSlot[] {
  // No print_materials answer (table missing, read failed): every color is a "buy".
  const rows: MaterialMatch[] =
    matches && matches.length
      ? matches
      : palette.slice(0, MINI_ME_MAX_COLORS).map((p, i) => ({
          slot: i + 1,
          target_hex: p.hex,
          material_id: null,
          color_name: null,
          brand: null,
          material: null,
          matched_hex: null,
          in_stock: false
        }))
  return rows.slice(0, MINI_ME_MAX_COLORS).map((m, i) => {
    const hex = m.target_hex || palette[i]?.hex || ''
    const name = nameForHex(hex)
    const stocked = [m.color_name, m.brand, m.material].filter(Boolean).join(' ')
    return {
      slot: m.slot || i + 1,
      hex,
      name,
      inStock: m.in_stock,
      load: m.in_stock ? stocked || name : `BUY ${name} PLA (${hex})`
    }
  })
}

/** What the customer reads: "We'll print you in: Black, Light Skin Tone, Denim Blue and White." */
export function customerColorSentence(plan: MiniMeFilamentSlot[]): string {
  const names = Array.from(new Set(plan.map(p => p.name)))
  if (names.length === 0) return ''
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `We'll print you in: ${list}.`
}

/** What the floor reads: which AMS slot gets which spool, and what to buy first. */
export function floorFilamentLine(plan: MiniMeFilamentSlot[]): string {
  if (plan.length === 0) return ''
  const slots = plan.map(p => `${p.slot}. ${p.load}`).join(' · ')
  const toBuy = plan.filter(p => !p.inStock).map(p => p.name)
  return `Load AMS: ${slots}${toBuy.length ? ` — not in stock, buy before printing: ${toBuy.join(', ')}` : ''}`
}

/** One print_materials read: the plan for a palette, never throws. */
export async function getMiniMeFilamentPlan(palette: PaletteEntry[] | null | undefined): Promise<MiniMeFilamentSlot[]> {
  const pal = Array.isArray(palette) ? palette.slice(0, MINI_ME_MAX_COLORS) : []
  if (pal.length === 0) return []
  let matches: MaterialMatch[] | null = null
  try {
    matches = await matchMaterials(pal, 'filament')
  } catch {
    matches = null
  }
  return toFilamentPlan(matches, pal)
}
