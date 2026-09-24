// Art for the customer Team Shirt page (/imagination-station/team/:productId).
//
// David 2026-09-24: "there's no like design for the page ... generate some
// images, make things understandable ... use GPT 2.5 to generate like
// instructional images." The page is customer-facing, so these carry the
// house look and no engine names.
//
// Stable GCS paths (site/team-shirts/<key>.png) so the page can hardcode the
// URLs. Re-running overwrites; pass keys to redo only some:
//
//   cd backend
//   npx tsx scripts/generate-team-shirt-art.ts            # all
//   npx tsx scripts/generate-team-shirt-art.ts step-name  # one
import '../load-env.js'
import { runOpenAIImage } from '../services/image-flow/providers/openai-image.js'

const HOUSE =
  'Clean modern e-commerce illustration style: soft 3D clay-render look, rounded friendly shapes, ' +
  'gentle studio lighting, brand palette of electric violet, hot magenta and warm orange accents on a soft ' +
  'off-white background with a subtle violet-to-orange glow. No logos, no watermark, no UI chrome, no extra text ' +
  'beyond what is described.'

const ART: Array<{ key: string; size: '1536x1024' | '1024x1024'; prompt: string }> = [
  {
    key: 'hero',
    size: '1536x1024',
    prompt:
      'Photorealistic, cinematic wide photo of five youth athletes (mixed boys and girls, diverse, ages 12-16) seen ' +
      'from BEHIND, standing shoulder to shoulder on a high-school football field at golden hour, stadium lights ' +
      'glowing, confetti in the air. Each wears a matching deep maroon t-shirt with a bold gold varsity name and big ' +
      'number printed on the back. The backs read exactly, left to right: "RIVERA" 7, "KIM" 12, "JONES" 23, ' +
      '"PATEL" 4, "BROOKS" 31. Crisp, correctly spelled athletic lettering, arched names above the numbers. ' +
      'Shallow depth of field, warm rim light, energetic and proud mood. No logos, no watermark.',
  },
  {
    key: 'step-name',
    size: '1024x1024',
    prompt:
      `${HOUSE} Subject: a smartphone floating at a slight angle; on its screen a single text box is being typed ` +
      'into and reads "SMITH" with a blinking cursor. Next to the phone, the back of a maroon t-shirt where the same ' +
      'name "SMITH" is appearing in bold arched gold varsity letters, with a little magic sparkle trail flowing from ' +
      'the phone to the shirt. Centered composition, lots of breathing room.',
  },
  {
    key: 'step-number',
    size: '1024x1024',
    prompt:
      `${HOUSE} Subject: three chunky 3D jersey numbers "7", "23" and "10" floating like balloons in varsity style ` +
      '(gold fill, maroon outline), with a hand-cursor pointing at the "23" which glows. Below them the back of a ' +
      'maroon t-shirt shows a large gold "23". Playful, clear, centered.',
  },
  {
    key: 'step-place',
    size: '1024x1024',
    prompt:
      `${HOUSE} Subject: three small maroon t-shirts seen from the back, side by side, like options on a menu: ` +
      'the first has a gold arched name above a big gold number, the second has only a big gold number, the third has ' +
      'only a gold name across the shoulders. The middle one has a glowing violet selection ring around it. ' +
      'Use placeholder lettering "NAME" and "00". Clean and instructional.',
  },
  {
    // Cropped into the three placement buttons, so no selection ring and even spacing.
    key: 'place-tiles',
    size: '1536x1024',
    prompt:
      `${HOUSE} Subject: exactly three identical maroon t-shirts seen from the BACK, evenly spaced in a row with ` +
      'wide equal gaps, same size, same height, flat front-on view, soft shadow under each. The first has a gold ' +
      'arched "NAME" above a big gold "00"; the second has only a big gold "00" in the middle of the back; the third ' +
      'has only a gold "NAME" across the upper back. No rings, no highlights, no selection marks, nothing else in frame.',
  },
  {
    key: 'step-ship',
    size: '1024x1024',
    prompt:
      `${HOUSE} Subject: a neat stack of folded maroon team t-shirts with gold printed numbers visible on the folds, ` +
      'sitting in an open kraft shipping box with tissue paper, a small printing press silhouette glowing softly in the ' +
      'background, and a friendly delivery truck icon. Feels premium, fast and trustworthy.',
  },
]

async function main() {
  const only = new Set(process.argv.slice(2))
  for (const art of ART) {
    if (only.size && !only.has(art.key)) continue
    const started = Date.now()
    const out = await runOpenAIImage({
      prompt: art.prompt,
      size: art.size,
      quality: 'high',
      objectPath: `site/team-shirts/${art.key}.png`,
      moderation: 'low',
    })
    console.log(`${art.key}\t${out.modelId}\t${((Date.now() - started) / 1000).toFixed(0)}s\t${out.url}`)
  }
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
