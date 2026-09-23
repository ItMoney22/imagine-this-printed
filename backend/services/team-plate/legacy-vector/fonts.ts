// Team plate — the font registry.
//
// Glyphs are converted to VECTOR PATHS at render time (opentype.js), never set
// as SVG <text>. Two reasons, both of which have bitten this repo's image work
// before:
//
//   - Render's Node image carries almost no fonts. An SVG <text> element with
//     font-family="Graduate" silently falls back to whatever the box happens to
//     have, so the press file would come out in a different typeface than the
//     preview — with no error anywhere.
//   - @font-face with a data: URI is not reliably supported by librsvg, which
//     is what sharp rasterizes SVG through.
//
// Paths sidestep both: by the time the SVG is built there is no text left in
// it, only <path d="...">.
//
// LICENSING: every bundled face is OFL or Apache-2.0 and its license file sits
// beside it in backend/assets/fonts/. Both licenses permit redistribution
// inside a product. An UPLOADED face (a template using a paid typeface David
// owns) is a different matter — it is fetched server-side and never served to
// a browser, because shipping a licensed .ttf to a client IS redistribution.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import type { StringMetrics } from './fit.js'
import type { FontSpec } from '../../../shared/team-template.js'

export type LoadedFont = opentype.Font

export interface HouseFont {
  /** The id stored in a template's `font.family`. Stable — templates reference it. */
  id: string
  label: string
  /** Filename under backend/assets/fonts/. */
  file: string
  /** Filename of the license shipped alongside it. */
  license: string
  /** What this face is for, shown in the authoring picker. */
  note: string
}

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts')

/**
 * The house set.
 *
 * Ids deliberately describe the ROLE, not the typeface name: a template says
 * `varsity-block`, so swapping the underlying face later (for a better one, or
 * because a license changes) does not orphan every saved template.
 */
export const HOUSE_FONTS: HouseFont[] = [
  {
    id: 'varsity-block',
    label: 'Varsity Block',
    file: 'varsity-block.ttf',
    license: 'varsity-block.OFL.txt',
    note: 'Collegiate jersey block — the default for numbers.',
  },
  {
    id: 'collegiate-slab',
    label: 'Collegiate Slab',
    file: 'collegiate-slab.ttf',
    license: 'collegiate-slab.OFL.txt',
    note: 'Heavy slab serif; takes a distress mask well.',
  },
  {
    id: 'heavy-sans',
    label: 'Heavy Sans',
    file: 'heavy-sans.ttf',
    license: 'heavy-sans.OFL.txt',
    note: 'Condensed and tall — fits long surnames without shrinking much.',
  },
  {
    id: 'brush-script',
    label: 'Brush Script',
    file: 'brush-script.ttf',
    license: 'brush-script.OFL.txt',
    note: 'Hand-painted script for a nickname across the back.',
  },
  {
    id: 'western',
    label: 'Western',
    file: 'western.ttf',
    license: 'western.OFL.txt',
    note: 'Rodeo/saloon slab.',
  },
  {
    id: 'stencil',
    label: 'Stencil',
    file: 'stencil.ttf',
    license: 'stencil.OFL.txt',
    note: 'Military stencil.',
  },
  {
    id: 'graffiti',
    label: 'Graffiti Marker',
    file: 'graffiti.ttf',
    license: 'graffiti.LICENSE.txt',
    note: 'Fat marker hand — Apache 2.0.',
  },
  {
    id: 'blackletter',
    label: 'Blackletter',
    file: 'blackletter.ttf',
    license: 'blackletter.OFL.txt',
    note: 'Old English, the classic across-the-shoulders team name.',
  },
]

export function resolveHouseFont(id: string): HouseFont | null {
  return HOUSE_FONTS.find((f) => f.id === id) ?? null
}

// Parsed faces are held for the life of the process. Re-parsing a 300KB TTF on
// every preview keystroke would dominate a render that is otherwise ~150ms.
const cache = new Map<string, Promise<LoadedFont>>()

function cacheKey(spec: FontSpec): string {
  return spec.src === 'house' ? `house:${spec.family}` : `url:${spec.src}`
}

async function parseFont(spec: FontSpec): Promise<LoadedFont> {
  let bytes: Buffer
  if (spec.src === 'house') {
    const face = resolveHouseFont(spec.family)
    // Named loudly rather than substituted: a silent fallback would print a
    // template in the wrong typeface and nobody would find out until a
    // customer compared their shirt to the listing photo.
    if (!face) throw new Error(`Unknown house font: ${spec.family}`)
    bytes = await readFile(path.join(FONT_DIR, face.file))
  } else {
    const res = await fetch(spec.src)
    if (!res.ok) throw new Error(`Font fetch failed (${res.status}) for ${spec.family}`)
    bytes = Buffer.from(await res.arrayBuffer())
  }
  // opentype 2.x takes an ArrayBuffer. Slicing off the Buffer's view is
  // required — a pooled Buffer's underlying ArrayBuffer holds other data too.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return opentype.parse(ab)
}

export function loadFont(spec: FontSpec): Promise<LoadedFont> {
  const key = cacheKey(spec)
  const hit = cache.get(key)
  if (hit) return hit
  const pending = parseFont(spec).catch((err) => {
    // Do not cache a failure: a transient fetch error would otherwise poison
    // this face for the life of the process.
    cache.delete(key)
    throw err
  })
  cache.set(key, pending)
  return pending
}

/**
 * A `measure` callback for fit.ts, in FONT UNITS.
 *
 * Measuring in font units rather than px is what lets the same fit maths drive
 * a 900px preview and a 3600px print file — the scale falls out at the end
 * instead of being baked into the measurement.
 */
export function measureWith(font: LoadedFont): (s: string) => StringMetrics {
  return (s: string) => ({
    // getAdvanceWidth returns px for a given font size; passing unitsPerEm as
    // the size gives font units back.
    width: font.getAdvanceWidth(s, font.unitsPerEm),
    ascender: font.ascender,
    descender: font.descender,
    unitsPerEm: font.unitsPerEm,
  })
}

/**
 * The characters this face cannot set, de-duplicated and in first-seen order.
 *
 * Run at TEMPLATE SAVE, not per order: a .notdef box reaching the press is a
 * ruined garment, but whether a face covers an alphabet is a property of the
 * font, not of one customer's name. Checking once puts the warning in front of
 * someone who is looking at the screen and can pick another face.
 */
export function missingGlyphs(font: LoadedFont, text: string): string[] {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const ch of text) {
    if (seen.has(ch)) continue
    seen.add(ch)
    if (font.charToGlyphIndex(ch) === 0) missing.push(ch)
  }
  return missing
}
