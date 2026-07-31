import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import {
    OPENROUTER_TEXT_MODEL,
    pickOpenRouterChatModel,
} from '../../lib/chat-model-routing.js'

const router = Router()

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

// OpenRouter client for the Gemini family. Used for /chat, which supports image
// uploads — Mr. Imagine can SEE the user's reference image and talk about it — and
// for /design-guidance. Which Gemini model a turn gets is decided per-request by
// lib/chat-model-routing.ts: pro only when the turn actually carries an image.
const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
        'HTTP-Referer': 'https://imaginethisprinted.com',
        'X-Title': 'Mr. Imagine - Vision Brain',
    },
})

// gpt-4o is retired from OpenAI's current model + pricing pages (gpt-4
// family hard shutdown 2026-10-23). Env-configurable, current defaults.
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano'
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
// gpt-5.x/o-series reasoning models reject a non-default `temperature` and
// the legacy `max_tokens` param (verified live during the sibling
// design-assistant.ts migration — see
// handoff-joshua-knight-1785113728792.json).
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

// Mr. Imagine's personality and site knowledge - customer-facing only
const MR_IMAGINE_SYSTEM_PROMPT = `You are Mr. Imagine, the friendly and creative AI mascot of ImagineThisPrinted.com - a custom print-on-demand platform.

## Your Personality
- Enthusiastic, warm, and encouraging
- Creative and imaginative (you LOVE helping people bring their ideas to life)
- Speak naturally like a friendly creative director
- Use casual language but stay professional
- Keep responses conversational and brief (1-3 sentences usually)
- You can use light humor and be playful
- Never be pushy or salesy

## What You Know About ImagineThisPrinted

### Products We Offer
- Custom T-shirts (black, white, grey, colored options)
- DTF (Direct-to-Film) printing for vibrant, detailed designs
- High-quality prints that last through many washes
- Various sizes from XS to 3XL

### How Our AI Design Process Works
1. Customer describes their dream design idea to you
2. You help refine their concept with questions about style (realistic vs artistic), colors, and details
3. Our AI generates multiple design options using advanced image generation
4. Customer picks their favorite and can request adjustments
5. Design gets applied to their chosen product
6. We print and ship directly to them

### Pricing & Value
- Shirts typically range from $20-35 depending on complexity
- Free shipping on orders over $50
- Quality guarantee - we want customers to love their products
- Fast turnaround - most orders ship within 3-5 business days

### Design Tips You Can Share
- Bold, high-contrast designs print best
- Simple designs often have the most impact
- Consider how the design will look on different shirt colors
- Vector/illustrated styles tend to print very crisply
- Photo-realistic designs work great with our DTF process

### What Makes Us Special
- AI-powered design means anyone can create professional-looking products
- No design skills required - just describe what you want
- Unique, one-of-a-kind products (not generic templates)
- We handle everything from design to doorstep

## What You DON'T Discuss
- Internal business operations or costs
- Admin features or backend systems
- Competitor comparisons
- Specific profit margins or supplier details
- Any technical infrastructure details

## Your Current Task
You're helping customers on the "Create a Design" page. Your job is to:
1. Welcome them warmly
2. Ask what kind of design they'd like to create
3. Help them describe their vision clearly
4. Guide them through style and color choices
5. Encourage them and get excited about their ideas!

Remember: You're the creative companion who makes the design process fun and easy. Be the friend who helps them bring their imagination to life!`

/**
 * POST /api/ai/mr-imagine/chat
 * Mr. Imagine's conversational AI - knows about the site, helps with design
 */
router.post('/chat', requireAuth, async (req: Request, res: Response): Promise<any> => {
    try {
        const { message, conversationHistory, imageUrl, imageUrls } = req.body

        if (!message && !imageUrl && (!imageUrls || imageUrls.length === 0)) {
            return res.status(400).json({ error: 'Message or image is required' })
        }

        const refs: string[] = []
        if (Array.isArray(imageUrls)) refs.push(...imageUrls.filter(Boolean))
        if (imageUrl && !refs.includes(imageUrl)) refs.push(imageUrl)

        console.log('[mr-imagine] 💬 Chat message:', (message ?? '').substring(0, 50) + '...', 'refs:', refs.length)

        // Build messages with conversation history
        const messages: any[] = [{ role: 'system', content: MR_IMAGINE_SYSTEM_PROMPT }]

        if (conversationHistory && Array.isArray(conversationHistory)) {
            for (const msg of conversationHistory.slice(-10)) {
                messages.push({
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content,
                })
            }
        }

        // Current user message — multimodal if images attached
        if (refs.length > 0) {
            const parts: any[] = [
                { type: 'text', text: message || 'Take a look at this — what do you think?' },
            ]
            for (const url of refs) {
                parts.push({ type: 'image_url', image_url: { url } })
            }
            messages.push({ role: 'user', content: parts })
        } else {
            messages.push({ role: 'user', content: message })
        }

        // Use Gemini via OpenRouter whenever OPENROUTER_API_KEY is set; fall back to
        // OPENAI_VISION_MODEL (also vision-capable) if it isn't.
        //
        // Which Gemini is decided from the payload we're about to send, not from a
        // request flag — see lib/chat-model-routing.ts. Text-only turns (the vast
        // majority of mascot chatter) go to flash; only turns that actually carry an
        // image pay for pro. Before this, every turn went to pro.
        const useGemini = !!process.env.OPENROUTER_API_KEY
        const geminiModel = pickOpenRouterChatModel(messages)
        const modelLabel = useGemini ? geminiModel : OPENAI_VISION_MODEL

        const completion = useGemini
            ? await openrouter.chat.completions.create({
                  model: geminiModel,
                  messages,
                  temperature: 0.8,
                  // Gemini 2.5 silently uses some of max_tokens for internal
                  // reasoning before completion. Previous values (600 → reported
                  // truncation, then 1200 here) keep responses from cutting off
                  // mid-sentence. Flash has the same reasoning behaviour, so the
                  // budget stays the same — it is just ~20x cheaper per token.
                  max_tokens: 1200,
              })
            : await openai.chat.completions.create({
                  model: OPENAI_VISION_MODEL,
                  messages,
                  // Previous model (gpt-4o) had no hidden reasoning tokens and
                  // took plain max_tokens/temperature; gpt-5.x reasoning models
                  // reject both, so max_tokens becomes max_completion_tokens and
                  // temperature is dropped for those models. 800 gives full
                  // sentences in every observed case for the legacy model.
                  ...(isReasoningModel(OPENAI_VISION_MODEL)
                      ? { max_completion_tokens: 800 }
                      : { temperature: 0.8, max_tokens: 800 }),
              })

        const responseText = completion.choices[0].message.content

        console.log('[mr-imagine] ✅ Response (' + modelLabel + '):', responseText?.substring(0, 80) + '...')

        res.json({
            response: responseText,
            model: modelLabel,
            sawImages: refs.length,
        })
    } catch (error: any) {
        console.error('[mr-imagine] ❌ Chat error:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * POST /api/ai/mr-imagine/design-guidance
 * Get Mr. Imagine's help refining a design concept
 */
router.post('/design-guidance', requireAuth, async (req: Request, res: Response): Promise<any> => {
    try {
        const { userPrompt, currentStep } = req.body

        if (!userPrompt) {
            return res.status(400).json({ error: 'User prompt is required' })
        }

        const stepContext = {
            'prompt': 'The user just described their design idea. Respond with excitement and ask a clarifying question about style or specific elements.',
            'style': 'The user is choosing between realistic and artistic/illustrated style. Help them decide based on their idea.',
            'color': 'The user is picking a shirt color. Suggest which color might work best for their design.',
            'generating': 'The design is being generated. Keep them excited while they wait!',
            'complete': 'The design is done! Celebrate with them and ask what they think.'
        }

        const contextPrompt = stepContext[currentStep as keyof typeof stepContext] || ''

        // Same provider preference as /chat above: OpenRouter's cheap text model
        // when the key is present, direct OpenAI otherwise. This route is always
        // text-only (it takes a prompt string, never an image), so it never needs
        // the vision model.
        const useOpenRouter = !!process.env.OPENROUTER_API_KEY
        const client = useOpenRouter ? openrouter : openai
        const guidanceModel = useOpenRouter ? OPENROUTER_TEXT_MODEL : OPENAI_TEXT_MODEL

        const completion = await client.chat.completions.create({
            model: guidanceModel,
            messages: [
                { role: 'system', content: MR_IMAGINE_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Current step: ${currentStep}\nContext: ${contextPrompt}\n\nUser said: "${userPrompt}"\n\nRespond as Mr. Imagine (1-2 sentences, conversational, encouraging):`
                }
            ],
            // Was 150 — too tight for design-guidance prompts that include a
            // suggestion + question. 350 keeps replies short but doesn't
            // truncate mid-sentence on OpenAI. Gemini bills hidden reasoning
            // tokens out of the SAME budget (that is why /chat needs 1200), so a
            // 350 ceiling there can return an empty completion — 800 on the
            // Gemini path, still a fraction of the old pro pricing.
            ...(isReasoningModel(guidanceModel)
                ? { max_completion_tokens: 350 }
                : { temperature: 0.8, max_tokens: useOpenRouter ? 800 : 350 }),
        })

        const responseText = completion.choices[0].message.content

        res.json({ response: responseText })
    } catch (error: any) {
        console.error('[mr-imagine] ❌ Design guidance error:', error)
        res.status(500).json({ error: error.message })
    }
})

export default router
