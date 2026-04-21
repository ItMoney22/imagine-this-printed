import { apiFetch } from '../lib/api'

export interface DesignSuggestion {
  id: string
  title: string
  description: string
  reasoning: string
  aiPrompt?: string
  colorPalette?: string[]
  typography?: {
    fontFamily: string
    fontSize: number
    fontWeight: string
  }
  layout?: {
    positioning: string
    alignment: string
    spacing: string
  }
  tags: string[]
}

export interface DesignAnalysis {
  overallRating: number
  strengths: string[]
  improvements: string[]
  suggestions: DesignSuggestion[]
  marketTrends: string[]
}

export interface ColorPalette {
  name: string
  colors: string[]
  mood: string
}

export interface TypographySuggestion {
  fontFamily: string
  fontSize: number
  fontWeight: string
  reasoning: string
  mood: string
}

export type DesignElement = {
  type: string
  text?: string
  fontFamily?: string
  fontSize?: number
  fill?: string
  x?: number
  y?: number
  width?: number
  height?: number
  [key: string]: unknown
}

export class GPTDesignAssistant {
  async getDesignSuggestions(
    productType: string,
    designContext: string,
    targetAudience: string = 'general'
  ): Promise<DesignSuggestion[]> {
    try {
      const data = await apiFetch('/api/ai/design-assistant/suggestions', {
        method: 'POST',
        body: JSON.stringify({ productType, designContext, targetAudience }),
      })
      return data.suggestions || []
    } catch (error) {
      console.error('Error getting design suggestions:', error)
      return []
    }
  }

  async analyzeDesign(
    elements: DesignElement[],
    productType: string
  ): Promise<DesignAnalysis> {
    try {
      const data = await apiFetch('/api/ai/design-assistant/analyze', {
        method: 'POST',
        body: JSON.stringify({ elements, productType }),
      })
      return {
        overallRating: data.overallRating ?? 7,
        strengths: data.strengths ?? [],
        improvements: data.improvements ?? [],
        suggestions: data.suggestions ?? [],
        marketTrends: data.marketTrends ?? [],
      }
    } catch (error) {
      console.error('Error analyzing design:', error)
      return {
        overallRating: 7,
        strengths: ['Design has potential'],
        improvements: ['Consider professional design principles'],
        suggestions: [],
        marketTrends: ['Minimalist designs are trending'],
      }
    }
  }

  async getColorPaletteSuggestions(mood: string, productType: string): Promise<ColorPalette[]> {
    try {
      const data = await apiFetch('/api/ai/design-assistant/color-palettes', {
        method: 'POST',
        body: JSON.stringify({ mood, productType }),
      })
      return data.palettes || []
    } catch (error) {
      console.error('Error getting color palettes:', error)
      return []
    }
  }

  async getTypographySuggestions(
    text: string,
    productType: string,
    mood: string
  ): Promise<TypographySuggestion[]> {
    try {
      const data = await apiFetch('/api/ai/design-assistant/typography', {
        method: 'POST',
        body: JSON.stringify({ text, productType, mood }),
      })
      return data.suggestions || []
    } catch (error) {
      console.error('Error getting typography suggestions:', error)
      return []
    }
  }

  async getChatResponse(message: string, context: Record<string, unknown> = {}): Promise<string> {
    try {
      const data = await apiFetch('/api/ai/design-assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ message, context }),
      })
      return data.response || ''
    } catch (error) {
      console.error('Error getting chat response:', error)
      return 'I can help you with design suggestions, color palettes, typography advice, and market trends. What would you like to explore?'
    }
  }
}

export const gptAssistant = new GPTDesignAssistant()
