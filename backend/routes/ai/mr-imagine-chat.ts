import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import { requireAuth } from '../../middleware/supabaseAuth.js'

const router = Router()

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

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
        const { message, conversationHistory } = req.body

        if (!message) {
            return res.status(400).json({ error: 'Message is required' })
        }

        console.log('[mr-imagine] 💬 Chat message:', message.substring(0, 50) + '...')

        // Build messages array with conversation history
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: MR_IMAGINE_SYSTEM_PROMPT }
        ]

        // Add conversation history if provided
        if (conversationHistory && Array.isArray(conversationHistory)) {
            for (const msg of conversationHistory.slice(-10)) { // Keep last 10 messages for context
                messages.push({
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content
                })
            }
        }

        // Add current message
        messages.push({ role: 'user', content: message })

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o', // Using GPT-4o for best quality responses
            messages,
            temperature: 0.8, // Slightly more creative
            max_tokens: 200, // Keep responses concise for voice
        })

        const responseText = completion.choices[0].message.content

        console.log('[mr-imagine] ✅ Response:', responseText?.substring(0, 80) + '...')

        res.json({
            response: responseText,
            model: 'gpt-4o'
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

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: MR_IMAGINE_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Current step: ${currentStep}\nContext: ${contextPrompt}\n\nUser said: "${userPrompt}"\n\nRespond as Mr. Imagine (1-2 sentences, conversational, encouraging):`
                }
            ],
            temperature: 0.8,
            max_tokens: 150,
        })

        const responseText = completion.choices[0].message.content

        res.json({ response: responseText })
    } catch (error: any) {
        console.error('[mr-imagine] ❌ Design guidance error:', error)
        res.status(500).json({ error: error.message })
    }
})

export default router
