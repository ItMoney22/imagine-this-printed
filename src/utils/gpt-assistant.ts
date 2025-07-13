const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || 'demo-openai-key'
const OPENAI_BASE_URL = 'https://api.openai.com/v1'

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

export class GPTDesignAssistant {
  private apiKey: string

  constructor() {
    this.apiKey = OPENAI_API_KEY
  }

  private async makeGPTRequest(prompt: string): Promise<string> {
    if (this.apiKey === 'demo-openai-key') {
      // Mock response for demo
      await new Promise(resolve => setTimeout(resolve, 1000))
      return this.getMockResponse(prompt)
    }

    try {
      const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a professional graphic designer and marketing expert specializing in custom print designs for apparel and merchandise. Provide creative, practical, and market-relevant design advice.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 1000,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || 'No response generated'
    } catch (error) {
      console.error('Error calling OpenAI API:', error)
      return this.getMockResponse(prompt)
    }
  }

  private getMockResponse(prompt: string): string {
    // Mock responses for demo purposes
    if (prompt.includes('suggest designs')) {
      return JSON.stringify({
        suggestions: [
          {
            id: '1',
            title: 'Minimalist Typography Design',
            description: 'Clean, modern text-based design with subtle geometric elements',
            reasoning: 'Minimalist designs are trending and work well on apparel. They appeal to a broad audience and are cost-effective to produce.',
            aiPrompt: 'minimalist typography design, clean modern font, subtle geometric shapes, professional look',
            colorPalette: ['#2D3748', '#4A5568', '#E2E8F0', '#FFFFFF'],
            typography: {
              fontFamily: 'Helvetica',
              fontSize: 32,
              fontWeight: 'bold'
            },
            layout: {
              positioning: 'center',
              alignment: 'centered',
              spacing: 'balanced'
            },
            tags: ['minimalist', 'typography', 'professional', 'trending']
          },
          {
            id: '2',
            title: 'Vintage Badge Style',
            description: 'Retro-inspired badge design with classic typography and ornamental details',
            reasoning: 'Vintage aesthetics are popular across demographics. Badge-style designs work great for brands and create a premium feel.',
            aiPrompt: 'vintage badge design, retro typography, ornamental details, classic style, premium look',
            colorPalette: ['#8B4513', '#D2691E', '#F5DEB3', '#FFFFFF'],
            typography: {
              fontFamily: 'Georgia',
              fontSize: 24,
              fontWeight: 'bold'
            },
            layout: {
              positioning: 'center',
              alignment: 'centered',
              spacing: 'compact'
            },
            tags: ['vintage', 'badge', 'retro', 'premium']
          },
          {
            id: '3',
            title: 'Nature-Inspired Illustration',
            description: 'Organic, hand-drawn style illustration with natural elements',
            reasoning: 'Nature themes resonate well with eco-conscious consumers. Hand-drawn elements add authenticity and uniqueness.',
            aiPrompt: 'nature illustration, hand-drawn style, organic shapes, botanical elements, earthy feel',
            colorPalette: ['#2F7D32', '#388E3C', '#81C784', '#C8E6C9'],
            typography: {
              fontFamily: 'Georgia',
              fontSize: 20,
              fontWeight: 'normal'
            },
            layout: {
              positioning: 'organic',
              alignment: 'natural',
              spacing: 'flowing'
            },
            tags: ['nature', 'illustration', 'organic', 'eco-friendly']
          }
        ]
      })
    }

    if (prompt.includes('analyze design')) {
      return JSON.stringify({
        overallRating: 7.5,
        strengths: [
          'Good use of contrast and readability',
          'Appropriate sizing for the product type',
          'Color choices work well together'
        ],
        improvements: [
          'Consider adding more visual hierarchy',
          'Text could be better positioned for product shape',
          'Add more breathing room around elements'
        ],
        suggestions: [
          {
            id: 'improve-1',
            title: 'Enhance Visual Hierarchy',
            description: 'Make the main text larger and add a subtle subtitle',
            reasoning: 'Clear hierarchy guides the viewer\'s eye and improves message clarity'
          }
        ],
        marketTrends: [
          'Bold typography is trending in 2025',
          'Eco-friendly messaging resonates well',
          'Minimalist designs have broad appeal'
        ]
      })
    }

    if (prompt.includes('color palette')) {
      return JSON.stringify({
        palettes: [
          {
            name: 'Modern Professional',
            colors: ['#1A202C', '#2D3748', '#4A5568', '#718096'],
            mood: 'Professional, trustworthy, modern'
          },
          {
            name: 'Vibrant Energy',
            colors: ['#E53E3E', '#DD6B20', '#D69E2E', '#38A169'],
            mood: 'Energetic, bold, attention-grabbing'
          },
          {
            name: 'Calm Nature',
            colors: ['#2F7D32', '#388E3C', '#81C784', '#C8E6C9'],
            mood: 'Natural, calming, eco-friendly'
          }
        ]
      })
    }

    return 'I can help you with design suggestions, color palettes, typography advice, and market trends. What would you like to explore?'
  }

  async getDesignSuggestions(
    productType: string, 
    designContext: string, 
    targetAudience: string = 'general'
  ): Promise<DesignSuggestion[]> {
    const prompt = `Please suggest designs for a ${productType} with the following context: "${designContext}". 
    Target audience: ${targetAudience}. 
    
    Provide 3 creative design suggestions in JSON format with the following structure:
    {
      "suggestions": [
        {
          "id": "unique_id",
          "title": "Design Name",
          "description": "Brief description",
          "reasoning": "Why this design works",
          "aiPrompt": "Text prompt for AI image generation",
          "colorPalette": ["#color1", "#color2", "#color3", "#color4"],
          "typography": {
            "fontFamily": "font name",
            "fontSize": number,
            "fontWeight": "weight"
          },
          "layout": {
            "positioning": "description",
            "alignment": "description", 
            "spacing": "description"
          },
          "tags": ["tag1", "tag2", "tag3"]
        }
      ]
    }`

    try {
      const response = await this.makeGPTRequest(prompt)
      const parsed = JSON.parse(response)
      return parsed.suggestions || []
    } catch (error) {
      console.error('Error parsing design suggestions:', error)
      return []
    }
  }

  async analyzeDesign(
    elements: any[], 
    productType: string
  ): Promise<DesignAnalysis> {
    const elementsDescription = elements.map(el => {
      if (el.type === 'text') {
        return `Text: "${el.text}" (${el.fontFamily}, ${el.fontSize}px, ${el.fill})`
      } else if (el.type === 'image') {
        return `Image: positioned at (${el.x}, ${el.y}), size ${el.width}x${el.height}`
      }
      return `Element: ${el.type}`
    }).join('; ')

    const prompt = `Analyze this design for a ${productType}:
    Elements: ${elementsDescription}
    
    Provide analysis in JSON format:
    {
      "overallRating": number (1-10),
      "strengths": ["strength1", "strength2"],
      "improvements": ["improvement1", "improvement2"], 
      "suggestions": [
        {
          "id": "suggestion_id",
          "title": "Suggestion Title",
          "description": "What to do",
          "reasoning": "Why this helps"
        }
      ],
      "marketTrends": ["trend1", "trend2"]
    }`

    try {
      const response = await this.makeGPTRequest(prompt)
      const parsed = JSON.parse(response)
      return {
        overallRating: parsed.overallRating || 7,
        strengths: parsed.strengths || [],
        improvements: parsed.improvements || [],
        suggestions: parsed.suggestions || [],
        marketTrends: parsed.marketTrends || []
      }
    } catch (error) {
      console.error('Error analyzing design:', error)
      return {
        overallRating: 7,
        strengths: ['Design has potential'],
        improvements: ['Consider professional design principles'],
        suggestions: [],
        marketTrends: ['Minimalist designs are trending']
      }
    }
  }

  async getColorPaletteSuggestions(mood: string, productType: string): Promise<any[]> {
    const prompt = `Suggest color palettes for a ${productType} with ${mood} mood. 
    
    Provide in JSON format:
    {
      "palettes": [
        {
          "name": "Palette Name",
          "colors": ["#color1", "#color2", "#color3", "#color4"],
          "mood": "description of mood/feeling"
        }
      ]
    }`

    try {
      const response = await this.makeGPTRequest(prompt)
      const parsed = JSON.parse(response)
      return parsed.palettes || []
    } catch (error) {
      console.error('Error getting color palettes:', error)
      return []
    }
  }

  async getTypographySuggestions(
    text: string, 
    productType: string, 
    mood: string
  ): Promise<any[]> {
    const prompt = `Suggest typography for the text "${text}" on a ${productType} with ${mood} mood.
    
    Provide 3 typography suggestions in JSON format:
    {
      "suggestions": [
        {
          "fontFamily": "Font Name",
          "fontSize": number,
          "fontWeight": "weight",
          "reasoning": "why this works",
          "mood": "feeling it conveys"
        }
      ]
    }`

    try {
      const response = await this.makeGPTRequest(prompt)
      const parsed = JSON.parse(response)
      return parsed.suggestions || []
    } catch (error) {
      console.error('Error getting typography suggestions:', error)
      return []
    }
  }

  async getChatResponse(message: string, context: any = {}): Promise<string> {
    const contextStr = Object.keys(context).length > 0 
      ? `Context: ${JSON.stringify(context)}` 
      : ''
    
    const prompt = `${contextStr}
    
    User message: "${message}"
    
    As a design assistant, provide helpful advice about design, typography, colors, layout, or market trends. Keep responses practical and actionable.`

    return await this.makeGPTRequest(prompt)
  }
}

export const gptAssistant = new GPTDesignAssistant()