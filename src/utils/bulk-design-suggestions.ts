// Pre-built design idea library for the BulkProductModal "Browse ideas"
// panel. Each category has 8-12 prompts the admin can one-click-add to the
// bulk textarea. Curated for DTF print readiness — subjects with strong
// silhouettes, limited palettes, and screen-print-friendly composition.
//
// Adding a category: append to BULK_DESIGN_SUGGESTIONS below. The order in
// this list is the order shown in the UI. Keep prompts terse — the DTF
// system prompt on the backend handles the "no garment, transparent bg,
// bold lines" boilerplate.

export interface BulkSuggestionCategory {
  id: string
  label: string
  emoji: string
  prompts: string[]
}

export const BULK_DESIGN_SUGGESTIONS: BulkSuggestionCategory[] = [
  {
    id: 'animals',
    label: 'Animals',
    emoji: '🐺',
    prompts: [
      'A wolf howling at a full moon, geometric line art',
      'A majestic dragon coiled around a sword',
      'An octopus tangled in old sailing rope',
      'A panda meditating among bamboo stalks',
      'A roaring lion crowned with botanical leaves',
      'An eagle in flight against a mountain silhouette',
      'A fox curled inside a forest scene',
      'A bear standing on hind legs, silhouetted by aurora',
      'A tiger face split with neon jungle foliage',
      'A raccoon wearing aviator goggles riding a paper airplane',
    ],
  },
  {
    id: 'cosmic',
    label: 'Cosmic & Space',
    emoji: '🚀',
    prompts: [
      'An astronaut riding a whale through swirling galaxies',
      'A planet collection arranged like a botanical chart',
      'A solitary astronaut sitting on a crescent moon, fishing for stars',
      'A mushroom forest under a starry purple sky',
      'A black hole framed by sacred geometry',
      'A retro rocket ship blasting off from a vinyl record',
      'A constellation map of imaginary creatures',
      'An astronaut floating in a sea of jellyfish stars',
      'A solar system arranged inside a snow globe',
      'A meditating cosmic deity surrounded by orbiting planets',
    ],
  },
  {
    id: 'skull',
    label: 'Skulls & Dark',
    emoji: '💀',
    prompts: [
      'A skull crowned with roses, traditional tattoo flash',
      'A Day of the Dead sugar skull, vibrant colors',
      'A grim reaper holding a vintage hourglass',
      'A demon mask framed by serpents',
      'A skull with butterflies emerging from the eye sockets',
      'A pirate skull with crossed cutlasses',
      'A skeleton hand holding a single rose',
      'A horned skull woven into vines and thorns',
      'A skull with mushrooms growing from the cranium',
      'A skull wearing a vintage motorcycle helmet',
    ],
  },
  {
    id: 'vintage',
    label: 'Vintage Americana',
    emoji: '🚗',
    prompts: [
      'A vintage 1969 muscle car silhouette at sunset',
      'A retro Route 66 highway sign, weathered',
      'A neon diner sign reading "OPEN", aged metal',
      'A vintage motel sign with palm tree, faded color',
      'A 1950s gas pump on a desert horizon',
      'A retro motorcycle with leather saddlebags',
      'An old typewriter wreathed in flowers',
      'A vintage record player with a stack of vinyl',
      'A weathered Polaroid camera with film strip',
      'A retro rotary phone connected to neon hearts',
    ],
  },
  {
    id: 'outdoors',
    label: 'Outdoors & Adventure',
    emoji: '⛰️',
    prompts: [
      'A mountain range silhouette with a single hiking trail',
      'A canoe on a still lake at dawn, minimal',
      'A campfire with a tent and pine trees in the distance',
      'A fly fishing rod arched over a flowing river',
      'A surfboard against a setting tropical sun',
      'A pair of hiking boots covered in pine needles',
      'A topographic map cross-section of a mountain peak',
      'A vintage compass overgrown with wildflowers',
      'A trout jumping out of a forest stream',
      'A backpack adorned with national park patches',
    ],
  },
  {
    id: 'music',
    label: 'Music',
    emoji: '🎸',
    prompts: [
      'A vintage condenser microphone wreathed in lightning bolts',
      'A vinyl record cracked open spilling liquid sound waves',
      'An electric guitar burning at the fretboard',
      'A pair of headphones with cosmic energy emanating',
      'A grand piano dripping with melted gold',
      'A drum kit silhouette against a neon city',
      'A boombox surrounded by tropical foliage',
      'A cassette tape with the ribbon forming a heart',
      'A turntable crossfaded with a sunset',
      'A saxophone trailing musical notes like smoke',
    ],
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    emoji: '🐉',
    prompts: [
      'A wizard casting glowing runes from an open spellbook',
      'A knight standing before a sleeping dragon',
      'A mermaid silhouette in a vintage scientific illustration',
      'A phoenix rising from geometric flames',
      'A unicorn galloping through a galaxy',
      'A treant guardian rooted in a moonlit grove',
      'A kraken pulling down a tall ship, vintage engraving',
      'A goblin tinkerer surrounded by clockwork gadgets',
      'A celestial sword imbued with starlight',
      'A fairy ring of mushrooms with a tiny floating lantern',
    ],
  },
  {
    id: 'quirky',
    label: 'Pop & Quirky',
    emoji: '🍕',
    prompts: [
      'A pizza astronaut floating with cheese strings as ropes',
      'A llama wearing aviator sunglasses, vaporwave palette',
      'A T-rex riding a skateboard with a punk attitude',
      'A cat DJ working a turntable with paws',
      'A hot dog dressed as a 1920s detective',
      'A flying saucer abducting a slice of cake',
      'A plant in a pot watering itself with a tiny watering can',
      'A coffee cup volcano erupting steam clouds',
      'A robot bee delivering a love letter',
      'A dinosaur drinking boba tea, illustrated',
    ],
  },
  {
    id: 'holiday',
    label: 'Holiday',
    emoji: '🎄',
    prompts: [
      'A pumpkin with mystical eyes and curling vines, Halloween',
      'A cozy hot chocolate mug surrounded by pine sprigs, winter',
      'A heart pierced by a vintage arrow with banner, Valentine',
      'A jack-o-lantern wearing a witch hat, Halloween',
      'A snowy mountain village with falling snowflakes, Christmas',
      'A Day of the Dead bride with marigolds, Día de los Muertos',
      'A spring rabbit with botanical floral antlers, Easter',
      'A turkey wearing a chef hat ringed by autumn leaves, Thanksgiving',
      'A menorah with stars in candle flames, Hanukkah',
      'A New Year fireworks burst spelling out a year, generic',
    ],
  },
]
