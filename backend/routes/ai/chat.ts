import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { sendNewSupportTicketEmail, sendTicketConfirmationEmail } from '../../utils/email.js'
import { createNotification, checkAgentAvailability } from '../admin/support.js'

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

/**
 * POST /api/ai/chat
 * Generate conversational AI response using GPT-4o with Tool Calling
 */
router.post('/', async (req: Request, res: Response): Promise<any> => {
    try {
        const { message, context, systemPrompt, model, history, userId, userEmail: providedEmail } = req.body

        if (!message) {
            return res.status(400).json({ error: 'Message is required' })
        }

        console.log('[chat] 💬 Processing message:', message.substring(0, 50) + '...')

        // Define tools
        const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
            {
                type: 'function',
                function: {
                    name: 'create_support_ticket',
                    description: 'Create a support ticket when a user reports a specific issue (order, billing, bugs) OR when no human agent is available. Always ask for the user\'s email if not already known.',
                    parameters: {
                        type: 'object',
                        properties: {
                            issue_summary: {
                                type: 'string',
                                description: 'Brief summary of the user\'s issue (max 100 chars)',
                            },
                            priority: {
                                type: 'string',
                                enum: ['low', 'medium', 'high', 'urgent'],
                                description: 'Priority level based on user urgency',
                            },
                            category: {
                                type: 'string',
                                enum: ['general', 'order', 'technical', 'billing', 'other'],
                                description: 'Category of the issue',
                            },
                            description: {
                                type: 'string',
                                description: 'Detailed description of the issue from the conversation',
                            },
                            user_email: {
                                type: 'string',
                                description: 'User email for follow-up (if provided in conversation)',
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
                    description: 'Check if a human support agent is currently online to take over the chat. Use this when user explicitly requests to speak to a human.',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'request_live_chat',
                    description: 'Request a live chat handoff to a human agent. Use this after confirming an agent is available.',
                    parameters: {
                        type: 'object',
                        properties: {
                            ticket_id: {
                                type: 'string',
                                description: 'The ticket ID to escalate for live chat',
                            },
                            reason: {
                                type: 'string',
                                description: 'Why the user wants to speak with a human',
                            }
                        },
                        required: ['reason'],
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
                    let userEmail = args.user_email || providedEmail

                    if (supabase) {
                        try {
                            // Get user email if userId is provided and no email given
                            if (userId && !userEmail) {
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
                                    user_id: userId || null,
                                    email: userEmail || 'anonymous@customer.com',
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

                                console.log(`[chat] ✅ Ticket created: ${ticketId}`)

                                // Create admin notification
                                await createNotification(
                                    'new_ticket',
                                    `New Support Ticket: ${args.issue_summary}`,
                                    `Priority: ${args.priority}\nCategory: ${args.category}\n\n${args.description}`,
                                    ticket.id,
                                    userId
                                )

                                // Add initial message to ticket
                                await supabase
                                    .from('ticket_messages')
                                    .insert({
                                        ticket_id: ticket.id,
                                        sender_id: userId || null,
                                        sender_type: 'user',
                                        message: args.description || args.issue_summary,
                                        is_internal: false
                                    })

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
                                if (userEmail && userEmail !== 'anonymous@customer.com') {
                                    sendTicketConfirmationEmail(
                                        userEmail,
                                        ticket.id,
                                        args.issue_summary
                                    ).catch(e => console.error('[chat] Confirmation email failed:', e))
                                }
                            } else {
                                console.error('[chat] ❌ Ticket creation error:', error)
                            }
                        } catch (e) {
                            console.error('[chat] Error creating ticket in DB:', e)
                        }
                    }

                    toolOutput = JSON.stringify({
                        success: true,
                        ticket_id: ticketId,
                        message: `Ticket created successfully. Reference: ${ticketId.slice(0, 8).toUpperCase()}. Our team has been notified and will respond soon.`
                    })
                }
                else if (toolCall.function.name === 'check_agent_availability') {
                    try {
                        // Check from database
                        const availability = await checkAgentAvailability()

                        if (availability.available) {
                            meta.agent_available = true
                            meta.agent_count = availability.count
                        }

                        toolOutput = JSON.stringify({
                            available: availability.available,
                            count: availability.count,
                            message: availability.available
                                ? `${availability.count} support agent(s) are online! I can connect you with a human agent.`
                                : "No agents are currently online. I can create a support ticket for you instead."
                        })
                    } catch (e) {
                        console.error('[chat] Error checking availability:', e)
                        toolOutput = JSON.stringify({ available: false, error: "Could not check availability" })
                    }
                }
                else if (toolCall.function.name === 'request_live_chat') {
                    const args = JSON.parse(toolCall.function.arguments)

                    try {
                        // Check availability first
                        const availability = await checkAgentAvailability()

                        if (availability.available) {
                            // If we have a ticket, escalate it
                            if (args.ticket_id && supabase) {
                                await supabase
                                    .from('support_tickets')
                                    .update({
                                        status: 'waiting',
                                        priority: 'high',
                                        updated_at: new Date().toISOString()
                                    })
                                    .eq('id', args.ticket_id)

                                // Create chat session
                                await supabase
                                    .from('chat_sessions')
                                    .upsert({
                                        ticket_id: args.ticket_id,
                                        user_id: userId,
                                        status: 'waiting',
                                        started_at: new Date().toISOString()
                                    }, {
                                        onConflict: 'ticket_id'
                                    })

                                // Create notification
                                await createNotification(
                                    'agent_needed',
                                    'Customer Requesting Live Chat',
                                    args.reason,
                                    args.ticket_id,
                                    userId
                                )
                            }

                            meta.handoff = true
                            meta.live_chat = true
                            meta.ticket_id = args.ticket_id

                            toolOutput = JSON.stringify({
                                success: true,
                                handoff: true,
                                message: "Connecting you with a support agent now. Please wait a moment..."
                            })
                        } else {
                            toolOutput = JSON.stringify({
                                success: false,
                                handoff: false,
                                message: "Unfortunately, no agents are available right now. A ticket has been created and someone will respond soon."
                            })
                        }
                    } catch (e) {
                        console.error('[chat] Error requesting live chat:', e)
                        toolOutput = JSON.stringify({ success: false, error: "Could not process live chat request" })
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
