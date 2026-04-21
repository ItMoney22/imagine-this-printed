import { apiFetch } from '../lib/api'
import type { AIGenerationRequest } from '../types'

export class ReplicateAPI {
  async generateImage(prompt: string, style: AIGenerationRequest['style']): Promise<string> {
    try {
      const data = await apiFetch('/api/imagination-station/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, style }),
      })
      // The imagination-station generate endpoint returns { imageUrl } or { url }
      return data.imageUrl || data.url || data.output?.[0] || ''
    } catch (error) {
      console.error('Error generating image:', error)
      // Return a placeholder so callers don't crash
      return `https://picsum.photos/1024/1024?random=${Date.now()}`
    }
  }

  async getGenerationStatus(predictionId: string): Promise<Record<string, unknown>> {
    try {
      const data = await apiFetch(`/api/ai/replicate/predictions/${predictionId}`)
      return data
    } catch (error) {
      console.error('Error getting generation status:', error)
      return { status: 'unknown' }
    }
  }
}

export const replicateAPI = new ReplicateAPI()
