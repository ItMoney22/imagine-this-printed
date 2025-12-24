/**
 * NanoBanana Prompt Builders for 3D Figurine Generation
 *
 * Provides optimized prompts for generating 3D-printable figurines
 * using Google's NanoBanana model via Replicate.
 *
 * Two generation modes:
 * 1. Text-to-Image (t2i): Generate initial concept from text prompt
 * 2. Image-to-Image (i2i): Generate consistent angle views from concept
 */

// Style descriptors optimized for 3D printing
export const STYLES = {
  realistic: {
    name: 'Realistic',
    descriptor: 'photorealistic, highly detailed, professional 3D sculpture, museum quality, smooth surfaces',
    negativeHints: 'cartoon, anime, stylized, low poly'
  },
  cartoon: {
    name: 'Cartoon',
    descriptor: 'stylized cartoon style, smooth rounded surfaces, bright vibrant colors, Pixar-Disney quality, clean lines',
    negativeHints: 'realistic, photorealistic, anime, low poly'
  },
  low_poly: {
    name: 'Low Poly',
    descriptor: 'low polygon geometric style, faceted angular surfaces, minimalist 3D art, crisp edges, modern design',
    negativeHints: 'realistic, smooth, organic, detailed'
  },
  anime: {
    name: 'Anime',
    descriptor: 'anime style, Japanese animation aesthetic, cel-shaded appearance, expressive features, clean bold lines',
    negativeHints: 'realistic, photorealistic, western cartoon'
  }
} as const

export type Style3D = keyof typeof STYLES

// Angle view configurations for multi-view generation
const ANGLE_VIEWS = {
  front: {
    direction: 'directly from the front',
    cameraHint: 'front view, facing camera',
    rotation: 0
  },
  back: {
    direction: 'directly from the back',
    cameraHint: 'back view, turned away from camera',
    rotation: 180
  },
  left: {
    direction: 'from the left side at 90 degrees',
    cameraHint: 'left profile view, perpendicular to camera',
    rotation: 90
  },
  right: {
    direction: 'from the right side at 90 degrees',
    cameraHint: 'right profile view, perpendicular to camera',
    rotation: 270
  }
} as const

export type AngleView = keyof typeof ANGLE_VIEWS

/**
 * Build a text-to-image prompt for generating the initial 3D concept
 *
 * @param userPrompt - User's description of the figurine
 * @param style - Visual style for the figurine
 * @returns Optimized prompt for NanoBanana t2i
 */
export function buildConceptPrompt(userPrompt: string, style: Style3D = 'realistic'): string {
  const styleInfo = STYLES[style] || STYLES.realistic

  // Clean and normalize user prompt
  const cleanPrompt = userPrompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s,.-]/g, '')

  // Build comprehensive prompt optimized for 3D printing
  const prompt = [
    `A ${styleInfo.descriptor} 3D-printable figurine of ${cleanPrompt}`,
    'centered composition on pure white background',
    'product photography lighting, soft shadows',
    'solid stable base for standing',
    'suitable for 3D printing, no thin fragile parts',
    'single subject, clean isolated view',
    'high detail, sharp focus',
    'front view perspective'
  ].join(', ')

  return prompt
}

/**
 * Build an image-to-image prompt for generating consistent angle views
 *
 * @param style - Visual style of the original figurine
 * @param angle - Which angle view to generate
 * @returns Optimized prompt for NanoBanana i2i
 */
export function buildAnglePrompt(style: Style3D, angle: AngleView): string {
  const styleInfo = STYLES[style] || STYLES.realistic
  const angleInfo = ANGLE_VIEWS[angle]

  // Build prompt that maintains consistency while changing angle
  const prompt = [
    `Same figurine viewed ${angleInfo.direction}`,
    angleInfo.cameraHint,
    styleInfo.descriptor,
    'pure white background',
    'consistent lighting and scale',
    'same level of detail and style',
    'no perspective distortion',
    'maintain original design and proportions',
    'product photography, soft shadows'
  ].join(', ')

  return prompt
}

/**
 * Get all angle prompts at once for batch processing
 */
export function buildAllAnglePrompts(style: Style3D): Record<AngleView, string> {
  return {
    front: buildAnglePrompt(style, 'front'),
    back: buildAnglePrompt(style, 'back'),
    left: buildAnglePrompt(style, 'left'),
    right: buildAnglePrompt(style, 'right')
  }
}

/**
 * Validate user prompt for safety and quality
 */
export function validatePrompt(prompt: string): { valid: boolean; error?: string } {
  if (!prompt || typeof prompt !== 'string') {
    return { valid: false, error: 'Prompt is required' }
  }

  const trimmed = prompt.trim()

  if (trimmed.length < 10) {
    return { valid: false, error: 'Prompt must be at least 10 characters' }
  }

  if (trimmed.length > 500) {
    return { valid: false, error: 'Prompt must be less than 500 characters' }
  }

  // Basic content filtering (extend as needed)
  const blockedTerms = ['nude', 'naked', 'nsfw', 'explicit', 'violent', 'gore', 'weapon']
  const lowerPrompt = trimmed.toLowerCase()

  for (const term of blockedTerms) {
    if (lowerPrompt.includes(term)) {
      return { valid: false, error: 'Prompt contains inappropriate content' }
    }
  }

  return { valid: true }
}

/**
 * Get style information for UI display
 */
export function getStyleInfo(style: Style3D) {
  return STYLES[style] || STYLES.realistic
}

/**
 * Get all available styles for UI display
 */
export function getAllStyles(): Array<{ key: Style3D; name: string; descriptor: string }> {
  return Object.entries(STYLES).map(([key, value]) => ({
    key: key as Style3D,
    name: value.name,
    descriptor: value.descriptor
  }))
}

/**
 * Get angle view information
 */
export function getAngleInfo(angle: AngleView) {
  return ANGLE_VIEWS[angle]
}

/**
 * Get ordered list of angles for consistent processing
 */
export function getAngleOrder(): AngleView[] {
  return ['front', 'back', 'left', 'right']
}
