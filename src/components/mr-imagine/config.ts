// Mr. Imagine Configuration
// Central configuration for the mascot system

// Voice ID for Mr. Imagine (Minimax Speech-02-Turbo via Replicate)
export const MR_IMAGINE_VOICE_ID = 'moss_audio_737a299c-734a-11f0-918f-4e0486034804'

export type MrImagineExpression =
  | 'default'    // Neutral, friendly
  | 'happy'      // Smiling, excited
  | 'thinking'   // Contemplating, processing
  | 'waving'     // Greeting pose
  | 'pointing'   // Directing attention
  | 'surprised'  // Wow/amazed reaction
  | 'confused'   // Needs clarification

export type MrImaginePose =
  | 'standing'   // Full body standing
  | 'waist-up'   // Waist up (for chat)
  | 'head-only'  // Just the head/face (for small avatars)
  | 'sitting'    // Sitting pose
  | 'action'     // Dynamic action pose

export interface MrImagineAsset {
  path: string
  alt: string
  width?: number
  height?: number
}

// Base path for all Mr. Imagine assets
export const MR_IMAGINE_BASE_PATH = '/mr-imagine'

// Asset paths configuration - update these when you add your images!
export const MR_IMAGINE_CONFIG = {
  // Character name
  name: 'Mr. Imagine',

  // Voice configuration (Minimax Speech-02-Turbo via Replicate)
  voice: {
    id: MR_IMAGINE_VOICE_ID,
    model: 'minimax/speech-02-turbo',
    defaultEmotion: 'auto',
    defaultSpeed: 0.95,
  },

  // Personality for chat responses
  personality: {
    greeting: "Hey there! I'm Mr. Imagine, your creative printing buddy!",
    thinking: "Hmm, let me think about that...",
    happy: "Awesome! I love seeing creativity come to life!",
    confused: "I'm not quite sure I understand. Could you tell me more?",
    farewell: "Thanks for chatting! Can't wait to see what you create!",
  },

  // Main character assets
  assets: {
    // Full body poses
    standing: {
      default: `${MR_IMAGINE_BASE_PATH}/mr-imagine-standing.png`,
      happy: `${MR_IMAGINE_BASE_PATH}/mr-imagine-standing-happy.png`,
      waving: `${MR_IMAGINE_BASE_PATH}/mr-imagine-waving.png`,
      pointing: `${MR_IMAGINE_BASE_PATH}/mr-imagine-pointing.png`,
    },

    // Waist-up for chat widget
    waistUp: {
      default: `${MR_IMAGINE_BASE_PATH}/mr-imagine-waist-up.png`,
      happy: `${MR_IMAGINE_BASE_PATH}/mr-imagine-waist-up-happy.png`,
      thinking: `${MR_IMAGINE_BASE_PATH}/mr-imagine-waist-up-thinking.png`,
      confused: `${MR_IMAGINE_BASE_PATH}/mr-imagine-waist-up-confused.png`,
    },

    // Head only for small avatars
    head: {
      default: `${MR_IMAGINE_BASE_PATH}/mr-imagine-head.png`,
      happy: `${MR_IMAGINE_BASE_PATH}/mr-imagine-head-happy.png`,
      thinking: `${MR_IMAGINE_BASE_PATH}/mr-imagine-head-thinking.png`,
    },

    // Chat bubble button (small circular) - use head as fallback
    chatButton: `${MR_IMAGINE_BASE_PATH}/mr-imagine-head.png`,

    // Hero section assets
    hero: `${MR_IMAGINE_BASE_PATH}/mr-imagine-waving.png`,
    heroVideo: `${MR_IMAGINE_BASE_PATH}/mr-imagine-hero-new.mp4`,
  },

  // Mockup assets for product builder
  mockups: {
    // T-shirt mockups with Mr. Imagine as model
    tshirt: {
      front: {
        white: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tshirt-white-front.png`,
        black: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tshirt-black-front.png`,
        gray: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tshirt-gray-front.png`,
      },
      back: {
        white: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tshirt-white-back.png`,
        black: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tshirt-black-back.png`,
        gray: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tshirt-gray-back.png`,
      },
      // Design placement zones (relative to mockup image)
      designZone: {
        front: { x: 150, y: 180, width: 200, height: 250 },
        back: { x: 150, y: 180, width: 200, height: 250 },
      }
    },

    // Hoodie mockups
    hoodie: {
      front: {
        white: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-hoodie-white-front.png`,
        black: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-hoodie-black-front.png`,
      },
      designZone: {
        front: { x: 140, y: 200, width: 220, height: 280 },
      }
    },

    // Tank top mockups
    tank: {
      front: {
        white: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tank-white-front.png`,
        black: `${MR_IMAGINE_BASE_PATH}/mockups/mr-imagine-tank-black-front.png`,
      },
      designZone: {
        front: { x: 155, y: 170, width: 190, height: 240 },
      }
    }
  },

  // Fallback placeholder when assets aren't loaded yet
  fallback: {
    avatar: '/itp-logo-v3.png',
    mockup: '/templates/blank-tshirt.png',
  },

  // Animation settings
  animations: {
    idle: {
      bobSpeed: 2000,      // ms for one bob cycle
      bobDistance: 5,       // px vertical movement
    },
    greeting: {
      duration: 500,
      scale: 1.1,
    },
    thinking: {
      rotateSpeed: 3000,
      rotateAngle: 3,       // degrees
    }
  },

  // Styling
  style: {
    // Glow effect color (matches brand primary)
    glowColor: 'rgba(168, 85, 247, 0.5)',
    glowColorIntense: 'rgba(168, 85, 247, 0.8)',

    // Chat bubble colors
    chatBubbleBg: '#7B3FE4',
    chatBubbleText: '#ffffff',

    // Border styling
    borderRadius: '50%',
    borderColor: 'rgba(168, 85, 247, 0.3)',
  }
}

// Helper function to get asset path with fallback
export function getMrImagineAsset(
  category: 'standing' | 'waistUp' | 'head',
  expression: MrImagineExpression = 'default'
): string {
  const assets = MR_IMAGINE_CONFIG.assets[category]
  const asset = assets[expression as keyof typeof assets] || assets.default
  return asset || MR_IMAGINE_CONFIG.fallback.avatar
}

// Helper function to get mockup path
export function getMrImagineMockup(
  product: 'tshirt' | 'hoodie' | 'tank',
  color: 'white' | 'black' | 'gray' = 'white',
  side: 'front' | 'back' = 'front'
): string {
  const mockup = MR_IMAGINE_CONFIG.mockups[product]
  if (!mockup) return MR_IMAGINE_CONFIG.fallback.mockup

  const sideAssets = mockup[side as keyof typeof mockup]
  if (typeof sideAssets === 'object' && sideAssets !== null) {
    return (sideAssets as Record<string, string>)[color] || MR_IMAGINE_CONFIG.fallback.mockup
  }

  return MR_IMAGINE_CONFIG.fallback.mockup
}
