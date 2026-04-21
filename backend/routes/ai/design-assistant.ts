import { Router, Request, Response } from 'express'
import OpenAI from 'openai'

const router = Router()

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const DESIGN_SYSTEM_PROMPT =
  'You are a professional graphic designer and marketing expert specializing in custom print designs for apparel and merchandise. Provide creative, practical, and market-relevant design advice.'

async function callOpenAI(prompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: DESIGN_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 1000,
    temperature: 0.7,
  })
  return completion.choices[0]?.message?.content ?? ''
}

/**
 * POST /api/ai/design-assistant/suggestions
 * Body: { productType, designContext, targetAudience? }
 */
router.post('/suggestions', async (req: Request, res: Response): Promise<any> => {
  try {
    const { productType, designContext, targetAudience = 'general' } = req.body
    if (!productType || !designContext) {
      return res.status(400).json({ error: 'productType and designContext are required' })
    }

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
            "fontSize": 24,
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

    const text = await callOpenAI(prompt)
    const parsed = JSON.parse(text)
    return res.json({ suggestions: parsed.suggestions || [] })
  } catch (err: any) {
    console.error('[design-assistant] suggestions error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/analyze
 * Body: { elements, productType }
 */
router.post('/analyze', async (req: Request, res: Response): Promise<any> => {
  try {
    const { elements, productType } = req.body
    if (!elements || !productType) {
      return res.status(400).json({ error: 'elements and productType are required' })
    }

    const elementsDescription = (elements as any[]).map((el: any) => {
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
      "overallRating": 7,
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

    const text = await callOpenAI(prompt)
    const parsed = JSON.parse(text)
    return res.json({
      overallRating: parsed.overallRating ?? 7,
      strengths: parsed.strengths ?? [],
      improvements: parsed.improvements ?? [],
      suggestions: parsed.suggestions ?? [],
      marketTrends: parsed.marketTrends ?? [],
    })
  } catch (err: any) {
    console.error('[design-assistant] analyze error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/color-palettes
 * Body: { mood, productType }
 */
router.post('/color-palettes', async (req: Request, res: Response): Promise<any> => {
  try {
    const { mood, productType } = req.body
    if (!mood || !productType) {
      return res.status(400).json({ error: 'mood and productType are required' })
    }

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

    const text = await callOpenAI(prompt)
    const parsed = JSON.parse(text)
    return res.json({ palettes: parsed.palettes || [] })
  } catch (err: any) {
    console.error('[design-assistant] color-palettes error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/typography
 * Body: { text, productType, mood }
 */
router.post('/typography', async (req: Request, res: Response): Promise<any> => {
  try {
    const { text: inputText, productType, mood } = req.body
    if (!inputText || !productType || !mood) {
      return res.status(400).json({ error: 'text, productType, and mood are required' })
    }

    const prompt = `Suggest typography for the text "${inputText}" on a ${productType} with ${mood} mood.

    Provide 3 typography suggestions in JSON format:
    {
      "suggestions": [
        {
          "fontFamily": "Font Name",
          "fontSize": 24,
          "fontWeight": "weight",
          "reasoning": "why this works",
          "mood": "feeling it conveys"
        }
      ]
    }`

    const text = await callOpenAI(prompt)
    const parsed = JSON.parse(text)
    return res.json({ suggestions: parsed.suggestions || [] })
  } catch (err: any) {
    console.error('[design-assistant] typography error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/chat
 * Body: { message, context? }
 */
router.post('/chat', async (req: Request, res: Response): Promise<any> => {
  try {
    const { message, context = {} } = req.body
    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    const contextStr = Object.keys(context).length > 0
      ? `Context: ${JSON.stringify(context)}`
      : ''

    const prompt = `${contextStr}

    User message: "${message}"

    As a design assistant, provide helpful advice about design, typography, colors, layout, or market trends. Keep responses practical and actionable.`

    const text = await callOpenAI(prompt)
    return res.json({ response: text })
  } catch (err: any) {
    console.error('[design-assistant] chat error:', err)
    return res.status(500).json({ error: err.message })
  }
})

export default router
