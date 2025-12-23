import sharp from 'sharp'
import fetch from 'node-fetch'

export interface DTFOptimizationOptions {
  shirtColor: 'black' | 'white' | 'grey' | 'color'
  printStyle: 'clean' | 'halftone' | 'grunge'
}

/**
 * DTF Print Optimization Engine
 * Transforms AI-generated images into professional print-ready graphics
 */
export async function optimizeForDTF(
  imageUrl: string,
  options: DTFOptimizationOptions
): Promise<Buffer> {
  console.log('[dtf] 🎨 Starting DTF optimization:', { imageUrl, options })

  // STEP 1: Download the image as RGBA
  console.log('[dtf] 📥 Downloading source image...')
  const response = await fetch(imageUrl)
  const imageBuffer = await response.buffer()

  let image = sharp(imageBuffer)
  const metadata = await image.metadata()
  console.log('[dtf] 📊 Image metadata:', {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasAlpha: metadata.hasAlpha,
  })

  // Ensure we're working with RGBA
  image = image.ensureAlpha()

  // Get raw pixel data
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true })

  console.log('[dtf] 🔍 Processing', data.length / 4, 'pixels')

  // STEP 2: BLACK REMOVAL (only for black shirts)
  if (options.shirtColor === 'black') {
    console.log('[dtf] 🖤 Applying black knockout for black shirt...')
    await removeBlackAreas(data, info.width, info.height)
  }

  // STEP 3: PRINT BOOST (for all shirts)
  console.log('[dtf] 🚀 Applying print boost (contrast + saturation)...')
  applyPrintBoost(data)

  // Reconstruct image from modified pixel data
  image = sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })

  // STEP 4: SHARPENING
  console.log('[dtf] ✨ Applying sharpening...')
  image = image.sharpen({
    sigma: 0.8,
    m1: 1.0,
    m2: 0.2,
  })

  // STEP 5: OPTIONAL HALFTONE (if printStyle === 'halftone')
  if (options.printStyle === 'halftone') {
    console.log('[dtf] 📐 Applying halftone pattern...')
    // Note: True halftone requires custom implementation
    // For now, we'll add a subtle grain texture
    // Apply halftone texture with reduced opacity via modulate
    const halftoneTexture = await createHalftoneTexture(info.width, info.height)
    image = image.composite([
      {
        input: halftoneTexture,
        blend: 'overlay' as const,
      },
    ])
  }

  // STEP 6: OPTIONAL GRUNGE (if printStyle === 'grunge')
  if (options.printStyle === 'grunge') {
    console.log('[dtf] 🎭 Applying grunge texture...')
    // Add subtle noise for grunge effect
    const grungeTexture = await createGrungeTexture(info.width, info.height)
    image = image.composite([
      {
        input: grungeTexture,
        blend: 'multiply' as const,
      },
    ])
  }

  // STEP 7: Export optimized PNG
  console.log('[dtf] 💾 Exporting optimized PNG...')
  const optimizedBuffer = await image
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toBuffer()

  console.log('[dtf] ✅ DTF optimization complete! Original:', imageBuffer.length, 'bytes → Optimized:', optimizedBuffer.length, 'bytes')

  return optimizedBuffer
}

/**
 * Remove black areas for black shirt designs
 * Only removes large black fills, preserves thin outlines
 */
async function removeBlackAreas(
  data: Buffer,
  width: number,
  height: number
): Promise<void> {
  const pixelCount = width * height
  const blackThreshold = 45
  const neutralTolerance = 12
  const clusterRadius = 6

  // First pass: mark near-black pixels
  const blackMask = new Uint8Array(pixelCount)

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]

    // Check if pixel is near-black
    const isNearBlack =
      r < blackThreshold &&
      g < blackThreshold &&
      b < blackThreshold &&
      Math.abs(r - g) < neutralTolerance &&
      Math.abs(r - b) < neutralTolerance &&
      Math.abs(g - b) < neutralTolerance

    blackMask[i] = isNearBlack ? 1 : 0
  }

  // Second pass: only remove black areas larger than clusterRadius
  // This preserves thin black outlines
  const pixelsToRemove = new Set<number>()

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (blackMask[i] === 0) continue

      // Check if this pixel is part of a large cluster
      let clusterSize = 0
      for (let dy = -clusterRadius; dy <= clusterRadius; dy++) {
        for (let dx = -clusterRadius; dx <= clusterRadius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const ni = ny * width + nx
            if (blackMask[ni] === 1) clusterSize++
          }
        }
      }

      // If cluster is large enough, mark for removal
      const minClusterSize = Math.PI * clusterRadius * clusterRadius * 0.5
      if (clusterSize > minClusterSize) {
        pixelsToRemove.add(i)
      }
    }
  }

  // Third pass: make marked pixels transparent with feathering
  for (const i of pixelsToRemove) {
    const offset = i * 4
    const x = i % width
    const y = Math.floor(i / width)

    // Calculate distance to edge of removed area for feathering
    let minDistToEdge = clusterRadius
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = ny * width + nx
          if (!pixelsToRemove.has(ni)) {
            const dist = Math.sqrt(dx * dx + dy * dy)
            minDistToEdge = Math.min(minDistToEdge, dist)
          }
        }
      }
    }

    // Apply feathered transparency
    const featherAmount = Math.max(0, Math.min(1, minDistToEdge / 2))
    data[offset + 3] = Math.floor(data[offset + 3] * (1 - featherAmount))
  }

  console.log('[dtf] 🖤 Black removal:', pixelsToRemove.size, 'pixels made transparent')
}

/**
 * Apply print boost: contrast, saturation, and color enhancement
 */
function applyPrintBoost(data: Buffer): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha === 0) continue // Skip transparent pixels

    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    // Convert to HSL for saturation boost
    const { h, s, l } = rgbToHsl(r, g, b)

    // Boost saturation by 12%
    const newS = Math.min(1, s * 1.12)

    // Apply gentle S-curve contrast
    const newL = applySCurve(l)

    // Convert back to RGB
    const { r: newR, g: newG, b: newB } = hslToRgb(h, newS, newL)

    // Ensure no clipping
    data[i] = Math.max(0, Math.min(255, newR))
    data[i + 1] = Math.max(0, Math.min(255, newG))
    data[i + 2] = Math.max(0, Math.min(255, newB))
  }
}

/**
 * Apply gentle S-curve for contrast boost
 */
function applySCurve(value: number): number {
  // Gentle S-curve that preserves highlights and shadows
  const x = value
  const curve = x < 0.5
    ? 2 * x * x
    : 1 - 2 * (1 - x) * (1 - x)

  // Blend 70% original + 30% curve for gentle effect
  return value * 0.7 + curve * 0.3
}

/**
 * RGB to HSL conversion
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l }
  }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else if (max === b) h = ((r - g) / d + 4) / 6

  return { h, s, l }
}

/**
 * HSL to RGB conversion
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  if (s === 0) {
    const gray = Math.round(l * 255)
    return { r: gray, g: gray, b: gray }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255)
  const g = Math.round(hue2rgb(p, q, h) * 255)
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255)

  return { r, g, b }
}

/**
 * Create halftone texture overlay
 */
async function createHalftoneTexture(width: number, height: number): Promise<Buffer> {
  const dotSize = 6
  const spacing = 8

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="halftone" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse">
          <circle cx="${spacing / 2}" cy="${spacing / 2}" r="${dotSize / 2}" fill="black" opacity="0.3"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#halftone)"/>
    </svg>
  `

  return Buffer.from(svg)
}

/**
 * Create grunge texture overlay
 */
async function createGrungeTexture(width: number, height: number): Promise<Buffer> {
  // Create noise texture
  const noiseData = Buffer.alloc(width * height * 4)

  for (let i = 0; i < noiseData.length; i += 4) {
    const noise = Math.random() > 0.7 ? 0 : 255
    noiseData[i] = noise
    noiseData[i + 1] = noise
    noiseData[i + 2] = noise
    noiseData[i + 3] = 255
  }

  return sharp(noiseData, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .blur(1.5)
    .png()
    .toBuffer()
}

/**
 * Build DTF-aware prompt with shirt color and print style rules
 * DEFAULT: Hyper-realistic style unless user specifies otherwise
 */
export function buildDTFPrompt(
  userPrompt: string,
  shirtColor: 'black' | 'white' | 'grey' | 'color',
  printStyle: 'clean' | 'halftone' | 'grunge'
): string {
  // Check if user specified a style preference
  const lowerPrompt = userPrompt.toLowerCase()
  const wantsCartoon = lowerPrompt.match(/cartoon|animated|anime|illustration|comic|drawn|stylized|vector|flat|simple|cute|kawaii/)
  const wantsRealistic = lowerPrompt.match(/realistic|real|photo|hyper|detailed|lifelike|3d|render/)

  // DEFAULT to hyper-realistic unless they asked for cartoon
  let styleInstruction = ''
  if (wantsCartoon) {
    styleInstruction = 'STYLE: Create in a stylized/cartoon illustration style as requested.'
  } else {
    // Default: hyper-realistic
    styleInstruction = 'STYLE: Create in HYPER-REALISTIC style with photorealistic details, dramatic lighting, and professional quality. Make it look like a real photograph or 3D render.'
  }

  // Main prompt - user's request + style
  const mainPrompt = `CREATE THIS DESIGN: ${userPrompt}

${styleInstruction}

Generate EXACTLY what was described. If they said "dragon" create a DRAGON. If they said "lion" create a LION. Follow their description precisely.`

  // Output format - keep it simple
  const outputFormat = `OUTPUT: Isolated artwork on TRANSPARENT background. No t-shirt or mockup - just the design. Centered, high resolution.`

  // Color rules based on shirt
  let colorRules = ''
  if (shirtColor === 'black') {
    colorRules = `COLORS: Avoid pure black (won't show on black fabric). Use bright, vibrant colors.`
  } else if (shirtColor === 'white') {
    colorRules = `COLORS: Avoid pure white. Use colors with good contrast.`
  }

  const parts = [mainPrompt, outputFormat]
  if (colorRules) parts.push(colorRules)

  const finalPrompt = parts.join('\n\n')

  console.log('[dtf] 📝 Built DTF prompt:', finalPrompt.substring(0, 300) + '...')

  return finalPrompt
}
