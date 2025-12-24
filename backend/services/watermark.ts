/**
 * Watermarking Service
 *
 * Adds a subtle watermark to generated images to prevent unauthorized use.
 * Uses sharp for image processing.
 */

import sharp from 'sharp'

const WATERMARK_TEXT = 'ImagineThisPrinted.com'
const WATERMARK_OPACITY = 0.3 // 30% opacity for subtlety

/**
 * Add a watermark to an image from a URL
 * Returns a Buffer with the watermarked image
 */
export async function addWatermark(imageUrl: string): Promise<Buffer> {
  console.log('[watermark] Adding watermark to image:', imageUrl.substring(0, 60) + '...')

  // Download the image
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer())

  // Get image metadata
  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width || 512
  const height = metadata.height || 512

  // Calculate watermark size (relative to image size)
  const fontSize = Math.max(16, Math.floor(width * 0.04)) // 4% of width, min 16px
  const padding = Math.floor(width * 0.02) // 2% padding

  // Create SVG watermark with diagonal text
  const svgWatermark = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .watermark-text {
            fill: rgba(255, 255, 255, ${WATERMARK_OPACITY});
            font-family: Arial, sans-serif;
            font-size: ${fontSize}px;
            font-weight: bold;
          }
        </style>
      </defs>
      <!-- Bottom-right corner watermark -->
      <text
        x="${width - padding}"
        y="${height - padding}"
        class="watermark-text"
        text-anchor="end"
      >${WATERMARK_TEXT}</text>
      <!-- Diagonal repeating watermark pattern -->
      <text
        x="${width / 2}"
        y="${height / 2}"
        class="watermark-text"
        text-anchor="middle"
        transform="rotate(-30 ${width / 2} ${height / 2})"
        opacity="0.15"
      >${WATERMARK_TEXT}</text>
    </svg>
  `

  // Composite the watermark onto the image
  const watermarkedBuffer = await sharp(imageBuffer)
    .composite([{
      input: Buffer.from(svgWatermark),
      gravity: 'center'
    }])
    .png()
    .toBuffer()

  console.log('[watermark] Watermark added successfully, size:', (watermarkedBuffer.length / 1024).toFixed(2), 'KB')

  return watermarkedBuffer
}

/**
 * Add a watermark to an image buffer
 * Returns a Buffer with the watermarked image
 */
export async function addWatermarkToBuffer(imageBuffer: Buffer): Promise<Buffer> {
  console.log('[watermark] Adding watermark to buffer, size:', (imageBuffer.length / 1024).toFixed(2), 'KB')

  // Get image metadata
  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width || 512
  const height = metadata.height || 512

  // Calculate watermark size
  const fontSize = Math.max(16, Math.floor(width * 0.04))
  const padding = Math.floor(width * 0.02)

  // Create SVG watermark
  const svgWatermark = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .watermark-text {
            fill: rgba(255, 255, 255, ${WATERMARK_OPACITY});
            font-family: Arial, sans-serif;
            font-size: ${fontSize}px;
            font-weight: bold;
          }
        </style>
      </defs>
      <text
        x="${width - padding}"
        y="${height - padding}"
        class="watermark-text"
        text-anchor="end"
      >${WATERMARK_TEXT}</text>
      <text
        x="${width / 2}"
        y="${height / 2}"
        class="watermark-text"
        text-anchor="middle"
        transform="rotate(-30 ${width / 2} ${height / 2})"
        opacity="0.15"
      >${WATERMARK_TEXT}</text>
    </svg>
  `

  const watermarkedBuffer = await sharp(imageBuffer)
    .composite([{
      input: Buffer.from(svgWatermark),
      gravity: 'center'
    }])
    .png()
    .toBuffer()

  console.log('[watermark] Watermark added to buffer, new size:', (watermarkedBuffer.length / 1024).toFixed(2), 'KB')

  return watermarkedBuffer
}
