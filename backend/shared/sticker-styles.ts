// Sticker Pack styles: the one list the Flare 'sticker' op and the Sticker Pack picker both read.
// Lives in backend/shared because the frontend reads it too, so this file must import nothing. Vercel
// installs only the root packages: a frontend import of backend/services/flare-studio.ts pulled sharp,
// the image providers and node-fetch's missing types into tsc -b and failed the build (task 96d01978).

/**
 * Sticker Pack (David 2026-11-08: "i give you the image and i chose how many stickers i want the diff sticker
 * types and we use gpt 2.6 images for it so we make sure we get great quaility"). One call = one sticker of one
 * type; the pack is N calls, so billing, refunds and the rate limit are the Flare Lab's own.
 */
export const STICKER_STYLES = {
  photo: { label: 'Photo cut-out', look: 'a realistic photographic cut-out of the subject, true to the photo, crisp and clean' },
  cartoon: { label: 'Cartoon', look: 'a bold flat vector cartoon like a sticker-shop illustration: chunky playful proportions, hair or fur drawn as a few simple flat colour shapes with no fine strands, thick clean black outlines, one step of cel shading, big expressive eyes' },
  kawaii: { label: 'Kawaii chibi', look: 'a cute kawaii chibi character: a huge head about as big as the whole body, big shiny sparkly eyes, rosy cheeks, a tiny stubby body, simple flat pastel colours' },
  emoji: { label: 'Emoji faces', look: 'an emoji: just the round glossy head, no body, pulling one big exaggerated emoji expression (laughing with tears, heart eyes, winking or starstruck), smooth shiny vector look' },
  retro: { label: 'Retro badge', look: 'a round retro 1970s badge: the subject inside a circle with a sunburst, warm orange, mustard and teal, no lettering' },
  holo: { label: 'Holo foil', look: 'a holographic foil sticker: the subject rendered with an iridescent rainbow chrome sheen and sparkles' },
  // Says "inside a circle" like retro: asked for a "shaped patch" twice, the model embroidered only the outline.
  patch: { label: 'Vintage patch', look: 'a round embroidered fabric patch: a circle of coloured twill with the subject stitched inside it in 5-6 thread colours, satin-stitch thread texture everywhere, a thick raised merrowed border around the circle, photographed flat' },
  bubble: { label: 'Speech bubble', look: 'a cartoon of the subject with a white comic speech bubble beside it' },
} as const
export type StickerStyle = keyof typeof STICKER_STYLES
