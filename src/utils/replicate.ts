import type { AIGenerationRequest } from '../types'

const REPLICATE_API_TOKEN = import.meta.env.VITE_REPLICATE_API_TOKEN || 'demo-replicate-token'
const REPLICATE_BASE_URL = 'https://api.replicate.com/v1'

interface ReplicateInput {
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
  num_inference_steps?: number
  guidance_scale?: number
  scheduler?: string
}

export class ReplicateAPI {
  private apiToken: string

  constructor() {
    this.apiToken = REPLICATE_API_TOKEN
  }

  private async makeRequest(endpoint: string, method: 'GET' | 'POST' = 'GET', data?: any) {
    if (this.apiToken === 'demo-replicate-token') {
      return this.getMockResponse(endpoint, data)
    }

    const response = await fetch(`${REPLICATE_BASE_URL}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Token ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
    })

    if (!response.ok) {
      throw new Error(`Replicate API error: ${response.statusText}`)
    }

    return response.json()
  }

  private getMockResponse(endpoint: string, data?: any) {
    if (endpoint.includes('/predictions')) {
      if (data) {
        // Creating prediction
        return Promise.resolve({
          id: 'mock_prediction_id_' + Date.now(),
          status: 'starting',
          input: data.input,
          created_at: new Date().toISOString()
        })
      } else {
        // Getting prediction result
        return Promise.resolve({
          id: 'mock_prediction_id',
          status: 'succeeded',
          output: [
            `https://replicate.delivery/pbxt/mock-generated-image-${Date.now()}.png`
          ],
          completed_at: new Date().toISOString()
        })
      }
    }

    return Promise.resolve({})
  }

  async generateImage(prompt: string, style: AIGenerationRequest['style']): Promise<string> {
    // Style-specific modifications to the prompt
    const stylePrompts = {
      realistic: 'photorealistic, highly detailed, professional photography',
      cartoon: 'cartoon style, animated, colorful, Disney-style illustration',
      vaporwave: 'vaporwave aesthetic, neon colors, retro 80s, synthwave',
      minimalist: 'minimalist design, clean lines, simple, modern',
      vintage: 'vintage style, retro, aged, classic design'
    }

    const enhancedPrompt = `${prompt}, ${stylePrompts[style]}, high quality, 4k`

    const input: ReplicateInput = {
      prompt: enhancedPrompt,
      negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy',
      width: 1024,
      height: 1024,
      num_inference_steps: 50,
      guidance_scale: 7.5,
      scheduler: 'K_EULER'
    }

    // Create prediction
    const prediction = await this.makeRequest('/predictions', 'POST', {
      version: 'da77bc59ee60423279fd632efb4795ab731d9e3ca9705ef3341091fb989b7eaf', // SDXL model
      input
    })

    if (this.apiToken === 'demo-replicate-token') {
      // Return mock image URL immediately for demo
      return `https://picsum.photos/1024/1024?random=${Date.now()}`
    }

    // Poll for result
    let result = prediction
    while (result.status === 'starting' || result.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 1000))
      result = await this.makeRequest(`/predictions/${prediction.id}`)
    }

    if (result.status === 'succeeded' && result.output && result.output.length > 0) {
      return result.output[0]
    }

    throw new Error('Image generation failed')
  }

  async getGenerationStatus(predictionId: string): Promise<any> {
    return this.makeRequest(`/predictions/${predictionId}`)
  }
}

export const replicateAPI = new ReplicateAPI()
