import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export interface ProductNormalizationInput {
  prompt: string
  priceTarget?: number
  mockupStyle?: 'flat' | 'human'
  background?: 'transparent' | 'studio'
  tone?: string
  imageStyle?: 'realistic' | 'cartoon' | 'semi-realistic'
  searchContext?: string
  // DTF Print Settings
  productType?: 'tshirt' | 'hoodie' | 'tank'
  shirtColor?: 'black' | 'white' | 'gray'
  printPlacement?: 'front-center' | 'left-pocket' | 'back-only' | 'pocket-front-back-full'
}

export interface NormalizedProduct {
  category_slug: string
  category_name: string
  title: string
  summary: string
  description: string
  tags: string[]
  seo_title: string
  seo_description: string
  suggested_price_cents: number
  variants: Array<{
    name: string
    priceDeltaCents?: number
  }>
  mockup_style: 'flat' | 'human'
  background: 'transparent' | 'studio'
  image_prompt: string // Detailed prompt for image generation
}

const SYSTEM_PROMPT = `You are a witty product copywriter for a custom-print shop. Given a free-form idea, output normalized product metadata strictly as compact JSON with these fields:

- category_slug: one of ['dtf-transfers', 'shirts', 'hoodies', 'tumblers']
- category_name: human-readable category name
- title: concise product title (max 80 chars)
- summary: one-line summary (max 160 chars)
- description: SHORT, FUNNY, and genuinely entertaining description (2-4 sentences max). Be clever, use humor, make people smile. Don't be corporate or boring. Worth the read!
- tags: array of relevant tags for search/SEO (5-10 tags)
- seo_title: SEO-optimized title (max 60 chars)
- seo_description: SEO meta description (max 160 chars)
- suggested_price_cents: suggested retail price in cents (USD)
- variants: array of variant objects with name and optional priceDeltaCents
- mockup_style: "flat" or "human"
- background: "transparent" or "studio"
- image_prompt: A detailed, specific prompt for AI image generation optimized for DTF (Direct-to-Film) printing. Focus on the GRAPHIC/DESIGN itself (NOT the product it's on).

CRITICAL RULES FOR image_prompt:
1. **YOU MUST USE THE SEARCH CONTEXT IF PROVIDED** - This is MANDATORY. The search context contains accurate, current information about the subject.
2. **EXTRACT VISUAL DETAILS FROM CONTEXT** - Look for keywords like: "sci-fi", "futuristic", "medieval", "cartoon", "realistic", "3D", "2D", character descriptions, environment descriptions, art style, color palette, etc.
3. If context mentions a game/movie genre (shooter, RPG, action, horror), incorporate visual elements typical of that genre
4. If context mentions specific characters, weapons, vehicles, or settings - DESCRIBE THOSE EXACT ELEMENTS in detail
5. DO NOT make assumptions or use generic imagery - if context says "sci-fi extraction shooter", describe futuristic soldiers with advanced gear, alien planets, extraction pods, etc.

ART STYLE INTEGRATION (CRITICAL):
6. The user specifies an image style: "realistic", "cartoon", or "semi-realistic"
   - For "realistic": Use photorealistic rendering, detailed textures, natural lighting, high detail photography style
   - For "cartoon": Use bold outlines, flat colors, stylized proportions, animated/illustrated look, vibrant saturated colors
   - For "semi-realistic": Blend realistic detail with artistic stylization, digital art style, balanced between photo and illustration
7. ALWAYS include the art style explicitly in your image_prompt (e.g., "photorealistic style" or "cartoon illustrated style" or "semi-realistic digital art")

PRINT PLACEMENT AWARENESS:
8. Consider the print placement when designing the composition:
   - "front-center": Full design, can be detailed and complex
   - "left-pocket": Smaller, simpler design suitable for pocket area (logo, icon, small graphic)
   - "back-only": Full back print, can be large and dramatic
   - "pocket-front-back-full": Small front pocket design + larger back design (consider this for dual compositions)

DESIGN GUIDELINES:
9. Build a complete visual scene: foreground subjects, background elements, lighting, atmosphere, color scheme
10. DO NOT mention "on a t-shirt" or "product mockup" - just describe the artwork itself
11. Make it 2-3 sentences minimum with rich visual detail
12. Consider the shirt color when suggesting design colors (e.g., for black shirts use bright/neon colors that pop)

Example:
- Context: "Arc Raiders is a sci-fi extraction shooter set on a war-torn Earth invaded by mysterious machines"
- Image style: "realistic"
- Good image_prompt: "Futuristic soldiers in tactical armor fighting against massive mechanical invaders, photorealistic military sci-fi art style, war-torn Earth environment with destroyed buildings, dramatic action scene, blue and orange cinematic lighting, highly detailed textures and realistic rendering"
- Bad image_prompt: "Raiders logo" or "Generic soldiers"

Output ONLY valid JSON, no markdown code blocks or explanations.`

export async function normalizeProduct(
  input: ProductNormalizationInput
): Promise<NormalizedProduct> {
  console.log('[ai-product] 🤖 Normalizing product:', input.prompt)

  // Map print placement to description
  const placementDescriptions: Record<string, string> = {
    'front-center': 'full center chest design',
    'left-pocket': 'small pocket-sized design (logo/icon)',
    'back-only': 'large full-back design',
    'pocket-front-back-full': 'dual design: small front pocket + large back print'
  }

  const userPrompt = `${input.prompt}

${input.searchContext ? `\nContext from search results:\n${input.searchContext}\n` : ''}

Additional preferences:
- Price target: ${input.priceTarget ? `$${input.priceTarget / 100}` : 'suggest based on product'}
- Mockup style: ${input.mockupStyle || 'auto-detect'}
- Background: ${input.background || 'transparent'}
- Tone: ${input.tone || 'professional and appealing'}
- Image style: ${input.imageStyle || 'semi-realistic'} (CRITICAL: use this exact style for the image_prompt - realistic=photorealistic, cartoon=illustrated, semi-realistic=digital art)

DTF Print Settings:
- Product type: ${input.productType || 'tshirt'}
- Shirt color: ${input.shirtColor || 'black'} (design colors should complement/contrast with this)
- Print placement: ${input.printPlacement || 'front-center'} (${placementDescriptions[input.printPlacement || 'front-center']})`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  })

  const result = completion.choices[0].message.content!
  const normalized = JSON.parse(result) as NormalizedProduct

  console.log('[ai-product] ✅ Product normalized:', {
    title: normalized.title,
    category: normalized.category_slug,
    price: normalized.suggested_price_cents,
  })

  return normalized
}
