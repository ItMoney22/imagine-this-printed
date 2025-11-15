import axios from 'axios'

const REMOVEBG_API_KEY = process.env.REMOVEBG_API_KEY

export async function removeBackgroundWithRemoveBg(imageUrl: string): Promise<string> {
  if (!REMOVEBG_API_KEY) {
    throw new Error('REMOVEBG_API_KEY is not configured')
  }

  console.log('[removebg] 🎨 Removing background with Remove.bg:', imageUrl)

  try {
    const response = await axios.post(
      'https://api.remove.bg/v1.0/removebg',
      {
        image_url: imageUrl,
        size: 'auto',
        format: 'png',
      },
      {
        headers: {
          'X-Api-Key': REMOVEBG_API_KEY,
        },
        responseType: 'arraybuffer',
      }
    )

    // Convert arraybuffer to base64
    const base64Image = Buffer.from(response.data, 'binary').toString('base64')
    const dataUrl = `data:image/png;base64,${base64Image}`

    console.log('[removebg] ✅ Background removed successfully')

    return dataUrl
  } catch (error: any) {
    console.error('[removebg] ❌ Error removing background:', error.response?.data || error.message)
    throw new Error(`Remove.bg API error: ${error.response?.data?.errors?.[0]?.title || error.message}`)
  }
}
