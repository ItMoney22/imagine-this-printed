// Flare Lab — the in-app guide to what GPT Image 2.5 Flare can do.
//
// David 2026-09-24: "learn all the capabilities that gpt image can do and build
// guides and steps in the imagination station". Researched against the OpenAI
// images.edit reference and the 2.5 Flare/Sunburst model notes (TASK_NOTES.md,
// 2026-09-24). Each tool's recipe lives server-side in
// backend/services/flare-studio.ts — keep the two in step.

export type FlareOp =
  | 'edit'
  | 'inpaint'
  | 'text'
  | 'blend'
  | 'variations'
  | 'transparent'
  | 'recolor'
  | 'cleanup'
  | 'restyle'

export type FlareQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface FlareToolGuide {
  op: FlareOp
  name: string
  tagline: string
  /** When to reach for it. */
  useWhen: string
  /** Numbered how-to, shown beside the controls. */
  steps: string[]
  /** Prompt tips specific to this tool. */
  tips: string[]
  /** One-tap example prompts. */
  examples: string[]
  /** Which model knobs this tool turns (shown as chips). */
  knobs: string[]
  /** Sensible starting quality. */
  defaultQuality: FlareQuality
}

export const FLARE_TOOLS: FlareToolGuide[] = [
  {
    op: 'edit',
    name: 'Smart Edit',
    tagline: 'Change one thing, keep everything else',
    useWhen: 'You like the design but one element is wrong — a colour, an object, a detail.',
    steps: [
      'Select the design you want to change.',
      'Describe ONE change in plain words.',
      'The recipe tells Flare to hold everything you did not mention.',
      'Run it, compare before/after, keep the one you like.',
    ],
    tips: [
      'One change per run. A list of unrelated changes makes the model drift.',
      'Name the thing and the change: "make the helmet plume gold" beats "fix the colours".',
      'Chain edits: run, keep, run again. Each run starts from the kept result.',
    ],
    examples: [
      'Make the helmet plume metallic gold',
      'Add subtle lightning bolts behind the mascot',
      'Turn the background splatter from red to navy',
    ],
    knobs: ['hold-the-art prompt', 'quality tier'],
    defaultQuality: 'high',
  },
  {
    op: 'inpaint',
    name: 'Paint & Replace',
    tagline: 'Brush the exact area — only that changes',
    useWhen: 'The fix has to stay inside one spot: remove a logo, replace an object, repair a blemish.',
    steps: [
      'Brush over the area that should change (a little past its edges).',
      'Describe what should be there instead.',
      'Run. Everything you did not paint is protected by the mask.',
    ],
    tips: [
      'Paint generously — the model blends at the mask edge, so a tight mask leaves seams.',
      'To delete something, say what should be behind it: "continue the splatter texture".',
      'A mask cannot be combined with reference images (the API masks image 1 only).',
    ],
    examples: [
      'Remove this and continue the background texture',
      'Replace with a small gold star',
      'Clean up this area so it matches the surrounding linework',
    ],
    knobs: ['mask', 'hold-the-art prompt'],
    defaultQuality: 'high',
  },
  {
    op: 'text',
    name: 'Text Swap',
    tagline: 'Change the words, keep the lettering style',
    useWhen: 'Same design, different team name, player, city, year or slogan.',
    steps: [
      'Type the text that is on the design now (exactly as it reads).',
      'Type what it should say instead. Leave it empty to remove the text.',
      'Run on High or X-High — lettering is where quality shows.',
      'Zoom in and check every letter before using it.',
    ],
    tips: [
      'The recipe spells your text letter by letter to stop typos — still proof it.',
      'Longer words are re-spaced into the same band; the art is never shrunk to fit.',
      'For a whole roster, build a Team Template instead so customers type their own.',
    ],
    examples: ['BEAR → SMITH', 'EST. 2019 → EST. 2024', 'WARRIORS → SPARTANS'],
    knobs: ['exact-text prompt', 'hold-the-art prompt', 'xhigh recommended'],
    defaultQuality: 'xhigh',
  },
  {
    op: 'blend',
    name: 'Reference Blend',
    tagline: 'Pull a logo, mascot or style in from other images',
    useWhen: 'You have a logo, mascot, photo or style sample that should become part of this design.',
    steps: [
      'Add up to 6 reference images (the model accepts up to 16).',
      'Say what to take from them and where it goes: "put the logo from image 2 on the chest of the mascot".',
      'Run. The reference is redrawn in this design\'s style.',
    ],
    tips: [
      'Refer to references by number: image 2, image 3…',
      'Only use artwork you own or the customer supplied.',
      'Want an exact logo? Keep the prompt to placement and size only.',
    ],
    examples: [
      'Put the school crest from image 2 on the shield',
      'Match the colour palette of image 2',
      'Add the dog from image 2 in the same cartoon style',
    ],
    knobs: ['multi-image input (up to 16)', 'hold-the-art prompt'],
    defaultQuality: 'high',
  },
  {
    op: 'variations',
    name: 'Variations',
    tagline: 'Sibling designs from one idea',
    useWhen: 'You want options — a set for a collection, or a few takes to pick from.',
    steps: [
      'Pick how many (up to 4).',
      'Optionally steer them: "more aggressive", "vintage feel".',
      'Run and add the ones you like as new designs.',
    ],
    tips: ['Medium quality is plenty for exploring — finish the winner on High.'],
    examples: ['More aggressive pose', 'Vintage 70s treatment', 'Cleaner, fewer details'],
    knobs: ['n (1-4)', 'hold-the-art prompt'],
    defaultQuality: 'medium',
  },
  {
    op: 'transparent',
    name: 'True Transparent',
    tagline: 'Re-render the art on a real transparent background',
    useWhen: 'The background removal ate part of the art, or the file has a fake (painted) checkerboard.',
    steps: ['Select the design.', 'Run. The model redraws the art isolated, with real alpha.', 'Check the edges on the checkerboard preview.'],
    tips: [
      'This redraws rather than cuts, so it handles hair, smoke and splatter that cutters destroy.',
      'For a plain solid background, the cheaper Remove BG tool is usually enough.',
    ],
    examples: ['Keep the drop shadow under the text'],
    knobs: ['background: transparent', 'hold-the-art prompt'],
    defaultQuality: 'high',
  },
  {
    op: 'recolor',
    name: 'Team Colors',
    tagline: 'Repaint the design in a palette',
    useWhen: 'Same design for another team, school or brand colourway.',
    steps: ['Pick the colours (up to 8).', 'Run. Shapes, lines and text stay put — only colours change.'],
    tips: ['Put the main colour first.', 'Check contrast against the shirt colour you will print on.'],
    examples: ['Keep the white outline on the lettering'],
    knobs: ['palette prompt', 'hold-the-art prompt'],
    defaultQuality: 'high',
  },
  {
    op: 'cleanup',
    name: 'Print Cleanup',
    tagline: 'Sharpen, de-noise, kill fake transparency',
    useWhen: 'Soft edges, JPEG blocks, stray specks, or a painted checkerboard before printing.',
    steps: ['Run Cleanup.', 'Then run Upscale for Print to reach 300 DPI at the print size.'],
    tips: ['Cleanup fixes quality; it does not add pixels. Upscale after it, not before.'],
    examples: ['Make the small text crisper'],
    knobs: ['hold-the-art prompt'],
    defaultQuality: 'high',
  },
  {
    op: 'restyle',
    name: 'Restyle',
    tagline: 'Same design, new art style',
    useWhen: 'You want the same subject and layout as vintage, anime, line art, embroidery look, etc.',
    steps: ['Describe the style.', 'Run a couple of variations at Medium, finish the pick on High.'],
    tips: ['Name the medium and era: "1990s screen-print, 3 spot colours".'],
    examples: ['1990s screen print, 3 spot colours', 'Clean single-weight line art', 'Distressed varsity athletic'],
    knobs: ['hold-the-art prompt'],
    defaultQuality: 'medium',
  },
]

export const QUALITY_INFO: Record<FlareQuality, { label: string; note: string; expectedMs: number }> = {
  low: { label: 'Draft', note: 'Fast idea check', expectedMs: 15000 },
  medium: { label: 'Good', note: 'Exploring options', expectedMs: 25000 },
  high: { label: 'High', note: 'Default for keepers', expectedMs: 40000 },
  xhigh: { label: 'X-High', note: 'Lettering & fine detail', expectedMs: 60000 },
  max: { label: 'Max', note: 'Final hero art', expectedMs: 90000 },
}

/** What the model can do, in plain words — the guide's overview card. */
export const FLARE_CAPABILITIES: Array<{ title: string; body: string }> = [
  { title: 'Edits that keep the original', body: 'Every recipe says what to KEEP before what to change, so only what you ask for moves.' },
  { title: 'Masked edits', body: 'Paint an area and only that area can change — everything else is protected.' },
  { title: 'Up to 16 input images', body: 'Blend logos, mascots and style references into one design.' },
  { title: 'Real text', body: 'Quote the exact words and it letters them, matching the existing style.' },
  { title: 'Transparent output', body: 'Renders true alpha for DTF — no painted checkerboards.' },
  { title: 'Five quality tiers', body: 'Draft → Max. Explore cheap, finish expensive.' },
  { title: 'Big canvases', body: 'Custom sizes up to 3840px on the long edge; Upscale for Print takes it to 300 DPI.' },
  { title: 'Several takes per run', body: 'Ask for up to 4 variations in one go.' },
]

/** Universal prompt rules — shown on every tool. */
export const PROMPT_RULES: string[] = [
  'Say what to KEEP, then the ONE thing to change.',
  'Quote exact text in "double quotes".',
  'Be concrete: object + change + where.',
  'Iterate: keep a result, then edit it again.',
]
