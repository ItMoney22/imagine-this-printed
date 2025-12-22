import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'

const router = Router()

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Generate marketing content for a product
router.post('/generate-content', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const {
      productName,
      productDescription,
      productPrice,
      platform,
      tone,
      targetAudience
    } = req.body

    if (!productName || !platform) {
      return res.status(400).json({ error: 'Product name and platform are required' })
    }

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[marketing] OpenAI API key not configured, returning mock data')
      return res.json({
        content: generateMockContent(productName, platform)
      })
    }

    const platformGuidelines = getPlatformGuidelines(platform)

    const prompt = `Generate marketing content for a custom printing product.

Product Details:
- Name: ${productName}
- Description: ${productDescription || 'Custom printed product'}
- Price: $${productPrice || 'N/A'}
- Platform: ${platform}
- Tone: ${tone || 'professional'}
- Target Audience: ${targetAudience || 'general audience'}

Platform Guidelines:
${platformGuidelines}

Generate a JSON response with the following structure:
{
  "headline": "Attention-grabbing headline (follow platform character limits)",
  "description": "Compelling description (follow platform character limits)",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "callToAction": "Strong call to action",
  "adCopyShort": "Short ad copy variant (1-2 sentences)",
  "adCopyMedium": "Medium ad copy variant (2-3 sentences)",
  "adCopyLong": "Long ad copy variant (3-5 sentences)",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
  "targetingTips": "Tips for targeting this audience"
}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert marketing copywriter specializing in e-commerce and custom printing products. Generate engaging, conversion-focused content. Always respond with valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1000
    })

    const content = JSON.parse(completion.choices[0].message.content || '{}')

    console.log(`[marketing] Generated content for "${productName}" on ${platform}`)

    return res.json({ content })
  } catch (error: any) {
    console.error('[marketing] Content generation error:', error)

    // If OpenAI fails, return mock content as fallback
    if (error.code === 'insufficient_quota' || error.status === 429) {
      console.warn('[marketing] OpenAI quota exceeded, returning mock data')
      return res.json({
        content: generateMockContent(req.body.productName, req.body.platform),
        warning: 'Generated with fallback content due to API limits'
      })
    }

    return res.status(500).json({ error: 'Failed to generate content', details: error.message })
  }
})

// Generate content for multiple products in a campaign
router.post('/generate-campaign', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const { products, campaignName, platform, tone, targetAudience } = req.body

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Products array is required' })
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        content: products.map((p: any) => ({
          productId: p.id,
          productName: p.name,
          ...generateMockContent(p.name, platform)
        })),
        warning: 'Generated with mock content - OpenAI not configured'
      })
    }

    const productList = products.map((p: any) => `- ${p.name}: ${p.description || 'Custom product'} ($${p.price || 'N/A'})`).join('\n')

    const prompt = `Generate a cohesive marketing campaign for these custom printing products.

Campaign: ${campaignName || 'Product Campaign'}
Platform: ${platform || 'general'}
Tone: ${tone || 'professional'}
Target Audience: ${targetAudience || 'general audience'}

Products:
${productList}

Generate a JSON response with:
{
  "campaignTheme": "Overall campaign theme/message",
  "campaignHashtags": ["#campaign1", "#campaign2"],
  "products": [
    {
      "productName": "Product Name",
      "headline": "Product-specific headline",
      "description": "Product-specific description",
      "callToAction": "Product CTA"
    }
  ],
  "overallStrategy": "Marketing strategy recommendations"
}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert marketing strategist specializing in e-commerce campaigns. Create cohesive, brand-consistent content across multiple products.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2000
    })

    const content = JSON.parse(completion.choices[0].message.content || '{}')

    console.log(`[marketing] Generated campaign "${campaignName}" with ${products.length} products`)

    return res.json({ content })
  } catch (error: any) {
    console.error('[marketing] Campaign generation error:', error)
    return res.status(500).json({ error: 'Failed to generate campaign', details: error.message })
  }
})

// Get platform-specific guidelines
function getPlatformGuidelines(platform: string): string {
  const guidelines: Record<string, string> = {
    google_ads: `
- Headline: Maximum 30 characters
- Description: Maximum 90 characters
- Focus on keywords and search intent
- Include price if competitive
- Use action verbs`,
    facebook_ads: `
- Headline: Maximum 40 characters recommended
- Primary text: 125 characters before "See More"
- Use emotional triggers and social proof
- Include eye-catching visuals reference
- Target specific interests`,
    instagram: `
- Caption: 2,200 characters max (first 125 visible)
- Use 20-30 relevant hashtags
- Focus on visual storytelling
- Include call-to-action in caption
- Use emojis strategically`,
    email: `
- Subject line: 40-60 characters
- Preview text: 35-90 characters
- Personalization recommended
- Clear single CTA
- Mobile-friendly formatting`,
    twitter: `
- Tweet: 280 characters max
- Use 1-2 hashtags
- Include link if relevant
- Visual content encouraged
- Conversational tone`,
    linkedin: `
- Headline: 150 characters max
- Post: 3,000 characters max
- Professional tone
- Industry insights valued
- B2B focused messaging`
  }

  return guidelines[platform] || `
- Create engaging, platform-appropriate content
- Focus on product benefits
- Include clear call-to-action
- Use relevant keywords`
}

// Generate mock content for fallback
function generateMockContent(productName: string, platform: string) {
  return {
    headline: `Transform Your Style with ${productName}`,
    description: `Discover the perfect custom ${productName.toLowerCase()} designed just for you. Premium quality, unique designs, fast delivery.`,
    keywords: ['custom', 'personalized', 'unique', 'quality', 'design'],
    callToAction: 'Shop Now',
    adCopyShort: `Get your custom ${productName} today! Premium quality, endless possibilities.`,
    adCopyMedium: `Looking for the perfect ${productName}? Our custom printing service lets you create exactly what you want. Premium materials, vibrant colors, and fast delivery.`,
    adCopyLong: `Transform your ideas into reality with our custom ${productName}. Whether you're looking to express your unique style, promote your brand, or create the perfect gift, we've got you covered. Premium quality materials, state-of-the-art printing technology, and fast, reliable delivery. Start designing today!`,
    hashtags: ['#CustomPrinting', '#PersonalizedGifts', '#UniqueDesigns'],
    targetingTips: `Focus on demographics interested in custom products, DIY enthusiasts, and gift shoppers. Consider targeting based on recent life events or seasonal occasions.`
  }
}

export default router
