import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { sendNewSupportTicketEmail, sendTicketConfirmationEmail } from '../../utils/email.js'

dotenv.config()

const router = Router()

// Initialize Supabase client for Ticket Creation
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null

if (!supabase) {
    console.warn('[chat] Supabase credentials missing given env. Ticket creation will happen in-memory/mock.')
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

// Mock Ticket Store (in memory for now, could be Supabase)
const tickets: any[] = []

/**
 * POST /api/ai/chat
 * Generate conversational AI response using GPT-4o with Tool Calling
 */
router.post('/', async (req: Request, res: Response): Promise<any> => {
    try {
        const { message, context, systemPrompt, model, history, userId } = req.body

        if (!message) {
            return res.status(400).json({ error: 'Message is required' })
        }

        console.log('[chat] 💬 Processing message:', message.substring(0, 50) + '...')

        // Check for "Human Agent Request" intent (simplified keyword check for speed, LLM can also decide)
        // If the user explicitly asks for a human, we should prioritize checking availability.

        // Define tools
        const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
            {
                type: 'function',
                function: {
                    name: 'create_support_ticket',
                    description: 'Create a support ticket when a user reports a specific issue (order, billing, bugs) OR when no human agent is available.',
                    parameters: {
                        type: 'object',
                        properties: {
                            issue_summary: {
                                type: 'string',
                                description: 'Brief summary of the user\'s issue',
                            },
                            priority: {
                                type: 'string',
                                enum: ['low', 'medium', 'high', 'urgent'],
                                description: 'Priority level based on user urgency',
                            },
                            category: {
                                type: 'string',
                                enum: ['order_status', 'product_quality', 'billing', 'technical_issue', 'other'],
                                description: 'Category of the issue',
                            },
                            description: {
                                type: 'string',
                                description: 'Detailed description of the issue',
                            }
                        },
                        required: ['issue_summary', 'priority', 'category', 'description'],
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'check_agent_availability',
                    description: 'Check if a human support agent is currently online to take over the chat.',
                    parameters: {
                        type: 'object',
                        properties: {}, // No params needed
                    },
                },
            },
        ]

        // Construct messages history
        let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: systemPrompt || "You are a helpful AI assistant."
            }
        ]

        if (history && Array.isArray(history)) {
            messages = [...messages, ...history]
        } else {
            messages.push({
                role: 'user',
                content: `Context: ${context || 'None'}\n\nUser: ${message}`
            })
        }

        // First API call
        const completion = await openai.chat.completions.create({
            model: model || 'gpt-4o',
            messages,
            tools,
            tool_choice: 'auto',
            temperature: 0.7,
        })

        const responseMessage = completion.choices[0].message

        // Check for tool calls
        if (responseMessage.tool_calls) {
            console.log('[chat] 🛠️ AI wants to use tools:', responseMessage.tool_calls.length)
            messages.push(responseMessage)

            const meta: any = {}

            for (const toolCall of responseMessage.tool_calls as any[]) {
                let toolOutput = ''

                if (toolCall.function.name === 'create_support_ticket') {
                    const args = JSON.parse(toolCall.function.arguments)
                    console.log('[chat] 🎫 Creating ticket:', args)

                    // Insert into Supabase
                    let ticketId = `TKT-${Math.floor(Math.random() * 10000)}`
                    let userEmail: string | undefined

                    if (supabase) {
                        try {
                            // Get user email if userId is provided
                            if (userId) {
                                const { data: profile } = await supabase
                                    .from('user_profiles')
                                    .select('email')
                                    .eq('id', userId)
                                    .single()
                                if (profile?.email) {
                                    userEmail = profile.email
                                }
                            }

                            const { data: ticket, error } = await supabase
                                .from('support_tickets')
                                .insert({
                                    user_id: userId, // Ensure userId is passed in body
                                    subject: args.issue_summary,
                                    description: args.description || args.issue_summary,
                                    priority: args.priority,
                                    category: args.category,
                                    status: 'open'
                                })
                                .select()
                                .single()

                            if (!error && ticket) {
                                ticketId = ticket.id
                                meta.ticket_id = ticket.id
                                meta.ticket_status = 'open'

                                // Send email notification to support team
                                sendNewSupportTicketEmail(
                                    ticket.id,
                                    args.issue_summary,
                                    args.description || args.issue_summary,
                                    args.priority,
                                    args.category,
                                    userEmail
                                ).catch(e => console.error('[chat] Email to support failed:', e))

                                // Send confirmation email to user if we have their email
                                if (userEmail) {
                                    sendTicketConfirmationEmail(
                                        userEmail,
                                        ticket.id,
                                        args.issue_summary
                                    ).catch(e => console.error('[chat] Confirmation email failed:', e))
                                }
                            }
                        } catch (e) {
                            console.error('Error creating ticket in DB:', e)
                        }
                    }

                    toolOutput = JSON.stringify({
                        success: true,
                        ticket_id: ticketId,
                        message: `Ticket created successfully. Reference: ${ticketId}. Our team has been notified via email.`
                    })
                }
                else if (toolCall.function.name === 'check_agent_availability') {
                    try {
                        // Check directly from in-memory store (same process)
                        // Import the online agents map from support routes
                        const { onlineAgents } = await import('../admin/support.js')
                        const isAvailable = onlineAgents && onlineAgents.size > 0

                        if (isAvailable) {
                            meta.handoff = true
                            meta.agent_online = true
                        }

                        toolOutput = JSON.stringify({
                            available: isAvailable,
                            message: isAvailable ? "An agent is online! Determining handoff..." : "No agents are currently online."
                        })
                    } catch (e) {
                        console.error('Error checking availability:', e)
                        toolOutput = JSON.stringify({ available: false, error: "Could not check availability" })
                    }
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolOutput
                })
            }

            // Second API call
            const secondResponse = await openai.chat.completions.create({
                model: model || 'gpt-4o',
                messages,
                tools: [],
                temperature: 0.7,
            })

            const finalContent = secondResponse.choices[0].message.content
            return res.json({ response: finalContent, meta })
        }

        // No tool called
        return res.json({ response: responseMessage.content })

    } catch (error: any) {
        console.error('[chat] ❌ Error generating chat response:', error)
        return res.status(500).json({ error: error.message })
    }
})

export default router
