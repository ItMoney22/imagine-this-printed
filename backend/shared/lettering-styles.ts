// Lettering styles for the phrase step (design doc §16, David 2026-09-02):
// "when in the step flow and i ask for a phrase can there be examples of how
// i want the font to look because it only generates plain font." Plain-font
// text was the ONLY thing gpt-image-2 ever drew for a picked phrase because
// the exact-text instruction (backend/services/step-flow/brief.ts's
// `phraseInstruction`) never described a lettering style — this is the
// single shared list both sides read from:
//   - the writing brain embeds a style's `prompt` descriptor into the
//     exact-text render instruction so the IMAGE actually draws that
//     lettering (see brief.ts's withPhrase);
//   - the Idea step shows the phrase rendered in each style as a real
//     web-font tile (no image generation, instant) using `preview`.
//
// One shared list — no separate frontend copy — the same convention as
// `metal-art.ts` / `catalog-capability.ts` / `product-gallery.ts`.

export type LetteringStyleId =
  | 'graffiti'
  | 'varsity'
  | 'brush-script'
  | 'chrome-3d'
  | 'retro-70s'
  | 'distressed'
  | 'heavy-sans'
  | 'blackletter'
  | 'bubble-comic'
  | 'neon-tube'
  | 'western'

export interface LetteringStylePreview {
  /** Google Fonts family name — the frontend loads this face to render the tile. */
  googleFamily: string
  weight?: number
  italic?: boolean
  letterSpacing?: string
  uppercase?: boolean
  /** Extra inline CSS the frontend may apply to the tile (e.g. a glow for neon-tube). Optional — a plain font-family swap is enough for most styles. */
  css?: string
}

export interface LetteringStyle {
  id: LetteringStyleId
  label: string
  /**
   * Rich descriptor GPT Image 2 can draw from — embedded verbatim into the
   * exact-text render instruction (brief.ts's phraseInstruction), e.g.
   * `Render the exact text "…" in ${prompt}, spelled exactly as written, …`.
   */
  prompt: string
  preview: LetteringStylePreview
}

export const LETTERING_STYLES: LetteringStyle[] = [
  {
    id: 'graffiti',
    label: 'Graffiti',
    prompt: 'wildstyle graffiti lettering with thick black outlines, drop shadow and a slight tilt',
    preview: { googleFamily: 'Permanent Marker', weight: 400 },
  },
  {
    id: 'varsity',
    label: 'Varsity',
    prompt:
      'bold collegiate varsity block lettering with a thick contrasting outline and a drop shadow, like a letterman jacket',
    preview: { googleFamily: 'Graduate', weight: 400, uppercase: true, letterSpacing: '0.02em' },
  },
  {
    id: 'brush-script',
    label: 'Brush Script',
    prompt:
      'flowing hand-painted brush script lettering with loose expressive strokes, like a signature brushed in one confident pass',
    preview: { googleFamily: 'Pacifico', weight: 400 },
  },
  {
    id: 'chrome-3d',
    label: 'Chrome 3D',
    prompt:
      'glossy chrome 3D lettering with heavy dimensional extrusion, polished metallic reflections and bright specular highlights',
    preview: {
      googleFamily: 'Bungee Shade',
      weight: 400,
      uppercase: true,
      css: 'text-shadow: 0 1px 0 #fff, 0 2px 0 #ccc, 0 3px 0 #bbb, 0 4px 6px rgba(0,0,0,0.35);',
    },
  },
  {
    id: 'retro-70s',
    label: 'Retro 70s',
    prompt:
      'retro 1970s groovy bubble lettering with warm rounded letterforms, a psychedelic wavy feel and a soft drop shadow',
    preview: { googleFamily: 'Righteous', weight: 400 },
  },
  {
    id: 'distressed',
    label: 'Distressed',
    prompt:
      'heavily distressed grunge lettering with cracked, worn, weathered texture and rough broken edges, like spray paint over concrete',
    preview: { googleFamily: 'Rubik Dirt', weight: 400, uppercase: true },
  },
  {
    id: 'heavy-sans',
    label: 'Heavy Sans',
    prompt: 'bold, heavy, ultra-condensed sans-serif lettering, clean and impactful with strong geometric edges',
    preview: { googleFamily: 'Anton', weight: 400, uppercase: true, letterSpacing: '0.01em' },
  },
  {
    id: 'blackletter',
    label: 'Blackletter',
    prompt:
      'ornate gothic blackletter calligraphy with sharp angular strokes and dramatic thick-thin contrast, old-world medieval manuscript style',
    preview: { googleFamily: 'UnifrakturMaguntia', weight: 400 },
  },
  {
    id: 'bubble-comic',
    label: 'Bubble Comic',
    prompt:
      'chunky rounded comic-book bubble lettering with a thick black outline and a bold flat fill, like a comic sound effect',
    preview: { googleFamily: 'Bangers', weight: 400, uppercase: true, letterSpacing: '0.02em' },
  },
  {
    id: 'neon-tube',
    label: 'Neon Tube',
    prompt:
      'glowing neon tube-light lettering, a thin luminous script with a soft colorful outer glow, like a lit neon sign',
    preview: {
      googleFamily: 'Monoton',
      weight: 400,
      uppercase: true,
      css: 'color: #fff; text-shadow: 0 0 6px #f0f, 0 0 14px #f0f, 0 0 28px #a0f;',
    },
  },
  {
    id: 'western',
    label: 'Western',
    prompt:
      'rustic wild-west saloon lettering with ornate slab serifs and rope-like flourishes, old frontier wanted-poster style',
    preview: { googleFamily: 'Rye', weight: 400 },
  },
]

export const LETTERING_STYLE_IDS: LetteringStyleId[] = LETTERING_STYLES.map((s) => s.id)

/** Used whenever an incoming style id is missing/invalid, and as the fallback body for "let Mrs. Imagine pick" ('auto'). */
export const DEFAULT_LETTERING_STYLE: LetteringStyleId = 'heavy-sans'

export function getLetteringStyle(id: unknown): LetteringStyle | undefined {
  return LETTERING_STYLES.find((s) => s.id === id)
}

/** True when `id` is one of the 11 known style ids (does NOT accept 'auto' — check that separately). */
export function isLetteringStyleId(id: unknown): id is LetteringStyleId {
  return (LETTERING_STYLE_IDS as string[]).includes(id as string)
}
