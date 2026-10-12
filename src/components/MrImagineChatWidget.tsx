// The shop chat (task 5878a61f, mockup approved by David 2026-10-07, approval dca0616d).
//
// Mr. Imagine answers the common questions straight from src/lib/help-facts.ts (the same answers as /help), and
// "Talk to a person" hands the customer to Christina: her reply, sent from Becky on her phone, lands right here
// (backend/routes/print-bridge.ts /ticket-reply) and in their email. The waiting state says who they are waiting
// for, how long it has been, and that they can leave: a guest adds an email so the reply still reaches them.
// Phones: no floating launcher (it covered buttons, task 5e10e099); the phone header's chat button opens the panel under it.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Mail, MessageCircle, Send, UserRound, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/SupabaseAuthContext'
import { helpTopic, shopChatKnowledge, type HelpItem } from '../lib/help-facts'
import { OPEN_SHOP_CHAT, type OpenShopChatDetail } from './support/chat-events'
import { OPEN_CHAT_EVENT } from './MobileTopBar'
import {
    clearLiveChat, formatWait, isEmail, loadLiveChat, saveLiveChat, stageFromPoll, waitingLine, type HandoffStage,
} from './support/live-chat-state'
import '../styles/support.css'

// API base URL for production
const API_BASE = import.meta.env.VITE_API_BASE || ''
const PERSON = 'Christina'

interface Message {
    role: 'user' | 'assistant' | 'person' | 'note'
    content: string
    timestamp: Date
    link?: { to: string; label: string }
    id?: string
}

const SYSTEM_PROMPT = `
You are Mr. Imagine, the friendly purple mascot of Imagine This Printed, a small custom print shop in Rockmart, Georgia.
You help shoppers in the shop chat on the website.

RULES (CRITICAL):
- Never call yourself an AI, a bot, a model or an assistant program, and never name any technology or company behind the site. The design tool is called Imagination Station.
- Answer ONLY from the SHOP FACTS below. If the answer is not there, say you are not sure and offer to connect them with Christina from the shop.
- You cannot look up orders. For order status, point them to the link in their order email, or My Orders if they have an account.
- Never talk about admin pages, dashboards, costs, margins or how the website is built.
- Keep replies to 2 or 3 short sentences. At most one emoji.

TOOLS:
- If something went wrong with an order, a payment or the website, ask for the details, then call create_support_ticket.
- If they want a person, call request_live_chat. Christina from the shop answers right here in the chat.

SHOP FACTS:
${shopChatKnowledge()}
`

const GREETING = "Hi! I'm Mr. Imagine from Imagine This Printed. Ask me about sizes, shipping, pickup or your order, or tap Talk to a person to reach Christina."

/** Instant answers for the quick chips, from the help page's own answers. */
const CHIPS: { label: string; ask: string; answer: () => HelpItem; link: { to: string; label: string } }[] = [
    { label: 'Track my order', ask: 'Where is my order?', answer: () => helpTopic('shipping').items[2], link: { to: '/help#shipping', label: 'More about shipping' } },
    { label: 'Sizing help', ask: 'How do your sizes fit?', answer: () => helpTopic('sizing').items[0], link: { to: '/help#sizing', label: 'See the size chart' } },
    { label: 'Shipping cost', ask: 'How much is shipping?', answer: () => helpTopic('shipping').items[0], link: { to: '/help#shipping', label: 'More about shipping' } },
]

const timeLabel = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function MrImagineChatWidget() {
    const { user } = useAuth()
    const [isOpen, setIsOpen] = useState(false)
    // The phone header's chat button opens the panel through this event.
    useEffect(() => {
        const open = () => { setUnreadCount(0); setIsOpen(true) }
        window.addEventListener(OPEN_CHAT_EVENT, open)
        return () => window.removeEventListener(OPEN_CHAT_EVENT, open)
    }, [])
    const [unreadCount, setUnreadCount] = useState(0)
    const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: GREETING, timestamp: new Date() }])
    const [inputValue, setInputValue] = useState('')
    const [isTyping, setIsTyping] = useState(false)
    const [ticketId, setTicketId] = useState<string | null>(null)
    const [stage, setStage] = useState<HandoffStage>('none')
    const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null)
    const [now, setNow] = useState(Date.now())
    const [replyEmail, setReplyEmail] = useState<string | null>(user?.email || null)
    const [emailDraft, setEmailDraft] = useState('')
    const [emailError, setEmailError] = useState<string | null>(null)
    const [handoffError, setHandoffError] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const seenIds = useRef<Set<string>>(new Set())
    const lastPollAt = useRef<string | null>(null)
    const isOpenRef = useRef(isOpen)
    const dingAudioRef = useRef<HTMLAudioElement | null>(null)
    const resumed = useRef(false)
    isOpenRef.current = isOpen

    const live = stage === 'waiting' || stage === 'connected' || stage === 'connecting'

    useEffect(() => {
        dingAudioRef.current = new Audio('/mr-imagine/audio/ding.mp3')
        return () => { dingAudioRef.current?.pause(); dingAudioRef.current = null }
    }, [])

    useEffect(() => { if (user?.email && !replyEmail) setReplyEmail(user.email) }, [user?.email, replyEmail])

    const playDing = () => {
        const a = dingAudioRef.current
        if (a) { a.currentTime = 0; a.play().catch(() => undefined) }
    }

    // Read the person's replies (and, on a resumed chat, the whole thread) from the ticket.
    const pollMessages = useCallback(async (id: string, full = false) => {
        try {
            const url = new URL(`${API_BASE}/api/admin/support/tickets/${id}/messages/poll`, window.location.origin)
            if (!full && lastPollAt.current) url.searchParams.set('since', lastPollAt.current)
            const response = await fetch(url.toString())
            if (!response.ok) return
            const data = await response.json()
            const rows: any[] = data.messages || []
            const fresh: Message[] = []
            let personReplied = false
            for (const m of rows) {
                if (m.id && seenIds.current.has(m.id)) continue
                if (m.id) seenIds.current.add(m.id)
                const text = String(m.message || m.content || '').trim()
                if (!text) continue
                if (m.sender_type === 'agent') {
                    personReplied = true
                    fresh.push({ id: m.id, role: 'person', content: text, timestamp: new Date(m.created_at) })
                } else if (full && m.sender_type === 'user' && !text.startsWith('Contact Email:')) {
                    fresh.push({ id: m.id, role: 'user', content: text, timestamp: new Date(m.created_at) })
                }
            }
            if (rows.length) lastPollAt.current = rows[rows.length - 1].created_at
            if (fresh.length) {
                setMessages((prev) => [...prev, ...fresh])
                if (fresh.some((m) => m.role === 'person') && !full) {
                    playDing()
                    if (!isOpenRef.current) setUnreadCount((n) => n + fresh.filter((m) => m.role === 'person').length)
                }
            }
            setStage((cur) => stageFromPoll(cur, data, personReplied || cur === 'connected'))
        } catch (error) {
            console.error('[shop chat] poll failed:', error)
        }
    }, [])

    // A chat in progress survives a reload or a trip to another page.
    useEffect(() => {
        if (resumed.current) return
        resumed.current = true
        const saved = loadLiveChat(typeof window !== 'undefined' ? window.localStorage : null)
        if (!saved) return
        setTicketId(saved.ticketId)
        setWaitStartedAt(Date.parse(saved.startedAt))
        if (saved.email) setReplyEmail(saved.email)
        setStage('waiting')
        setMessages((prev) => [...prev, { role: 'note', content: `Welcome back. Your chat with ${PERSON} is still open.`, timestamp: new Date() }])
        pollMessages(saved.ticketId, true)
    }, [pollMessages])

    // Poll while the person might answer.
    useEffect(() => {
        if (!ticketId || !(stage === 'waiting' || stage === 'connected')) return
        const t = setInterval(() => pollMessages(ticketId), 3000)
        return () => clearInterval(t)
    }, [ticketId, stage, pollMessages])

    // The waiting clock.
    useEffect(() => {
        if (stage !== 'waiting') return
        const t = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(t)
    }, [stage])

    // An ended chat no longer resumes.
    useEffect(() => {
        if (stage === 'ended') clearLiveChat(window.localStorage)
    }, [stage])

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, stage, isOpen])

    const add = (m: Omit<Message, 'timestamp'>) => setMessages((prev) => [...prev, { ...m, timestamp: new Date() }])

    const startHandoff = useCallback(async (lastMessage?: string) => {
        if (live) return
        setHandoffError(null)
        setStage('connecting')
        try {
            const res = await fetch(`${API_BASE}/api/support/live-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: lastMessage || '',
                    email: replyEmail || user?.email || undefined,
                    name: user?.displayName || user?.username || undefined,
                    ticketId: ticketId || undefined,
                    userId: user?.id || undefined,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.ticketId) throw new Error(data.error || 'Could not reach the shop')
            setTicketId(data.ticketId)
            if (data.email) setReplyEmail(data.email)
            if (data.live) {
                const startedAt = new Date().toISOString()
                saveLiveChat(window.localStorage, { ticketId: data.ticketId, startedAt, email: data.email || null })
                setWaitStartedAt(Date.parse(startedAt))
                setNow(Date.now())
                lastPollAt.current = startedAt
                setStage('waiting')
            } else {
                setStage('away')
            }
        } catch (error: any) {
            console.error('[shop chat] hand-off failed:', error)
            setStage('none')
            setHandoffError(error?.message || 'Could not reach the shop')
        }
    }, [live, replyEmail, ticketId, user?.id, user?.email, user?.displayName, user?.username])

    // Other pages open this chat ("Chat with us").
    useEffect(() => {
        const onOpen = (e: Event) => {
            setIsOpen(true)
            setUnreadCount(0)
            if ((e as CustomEvent<OpenShopChatDetail>).detail?.talkToPerson) startHandoff()
        }
        window.addEventListener(OPEN_SHOP_CHAT, onOpen)
        return () => window.removeEventListener(OPEN_SHOP_CHAT, onOpen)
    }, [startHandoff])

    const saveEmail = async (e: React.FormEvent) => {
        e.preventDefault()
        const email = emailDraft.trim()
        if (!isEmail(email)) { setEmailError('That email does not look right.'); return }
        setEmailError(null)
        if (!ticketId) return
        try {
            const res = await fetch(`${API_BASE}/api/support/tickets/${ticketId}/contact-email`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || 'Could not save your email')
            setReplyEmail(data.email || email)
            const saved = loadLiveChat(window.localStorage)
            if (saved) saveLiveChat(window.localStorage, { ...saved, email: data.email || email })
        } catch (error: any) {
            setEmailError(error?.message || 'Could not save your email')
        }
    }

    const endChat = async () => {
        if (ticketId) {
            fetch(`${API_BASE}/api/support/tickets/${ticketId}/end-chat`, { method: 'POST' }).catch(() => undefined)
        }
        setStage('ended')
    }

    const startOver = () => {
        clearLiveChat(window.localStorage)
        seenIds.current.clear()
        lastPollAt.current = null
        setTicketId(null)
        setStage('none')
        setWaitStartedAt(null)
        setHandoffError(null)
        setMessages([{ role: 'assistant', content: GREETING, timestamp: new Date() }])
    }

    const askChip = (chip: typeof CHIPS[number]) => {
        const item = chip.answer()
        add({ role: 'user', content: chip.ask })
        setTimeout(() => add({ role: 'assistant', content: item.a, link: chip.link }), 250)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const userMessage = inputValue.trim()
        if (!userMessage) return
        setInputValue('')
        const history = [...messages, { role: 'user' as const, content: userMessage, timestamp: new Date() }]
        setMessages(history)

        // Handed to a person: the message goes on the ticket, where she reads it.
        if ((live || stage === 'away') && ticketId) {
            try {
                const res = await fetch(`${API_BASE}/api/admin/support/tickets/${ticketId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: userMessage, userId: user?.id || null }),
                })
                if (!res.ok) throw new Error(String(res.status))
            } catch (error) {
                console.error('[shop chat] send failed:', error)
                add({ role: 'note', content: 'That message did not send. Please try again.' })
            }
            return
        }

        setIsTyping(true)
        try {
            const response = await fetch(`${API_BASE}/api/ai/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage,
                    systemPrompt: SYSTEM_PROMPT,
                    history: history.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })),
                    userId: user?.id || null,
                    userEmail: replyEmail || user?.email || null,
                }),
            })
            const data = await response.json()
            if (!data.response) throw new Error('No reply')
            add({ role: 'assistant', content: data.response })
            if (!isOpenRef.current) setUnreadCount((n) => n + 1)
            const meta = data.meta
            if (meta?.ticket_id) setTicketId(meta.ticket_id)
            if (meta?.handoff && meta?.ticket_id) {
                const startedAt = new Date().toISOString()
                saveLiveChat(window.localStorage, { ticketId: meta.ticket_id, startedAt, email: replyEmail })
                setWaitStartedAt(Date.parse(startedAt))
                lastPollAt.current = startedAt
                setStage('waiting')
            }
        } catch (error) {
            console.error('[shop chat] reply failed:', error)
            add({ role: 'assistant', content: 'Sorry, I lost my train of thought. Could you say that again? Or tap Talk to a person.' })
        } finally {
            setIsTyping(false)
        }
    }

    const personReplied = messages.some((m) => m.role === 'person')
    const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content
    const waitSeconds = waitStartedAt ? (now - waitStartedAt) / 1000 : 0
    const headerTitle = stage === 'connected' ? PERSON : 'Imagine This Printed'
    const headerSub = stage === 'connected' ? 'Imagine This Printed, Rockmart GA'
        : stage === 'waiting' || stage === 'connecting' ? `${PERSON} is on her way`
        : 'Shop chat'
    const showChips = stage === 'none' && messages.filter((m) => m.role === 'user').length < 2

    return (
        // Phones: the launcher lives in the header band (never over page content); the open panel drops
        // in below the header. sm+: classic bottom-right corner.
        <div className={`sp-root fixed z-50 flex-col items-end pointer-events-none sm:inset-auto sm:bottom-6 sm:right-6 ${isOpen ? 'flex inset-x-3 top-[72px]' : 'max-lg:hidden flex'}`}>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 16, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.97 }}
                        transition={{ duration: 0.2 }}
                        role="dialog"
                        aria-label="Shop chat"
                        className="sp-chat-panel mb-4 w-full sm:w-[380px] max-w-[calc(100vw-1.5rem)] rounded-2xl overflow-hidden pointer-events-auto flex flex-col"
                        style={{ maxHeight: 'min(620px, calc(100dvh - 96px))', height: '560px' }}
                    >
                        {/* Header */}
                        <div className="sp-chat-head px-4 py-3 flex items-center justify-between gap-2 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="relative shrink-0">
                                    {stage === 'connected' ? (
                                        <div className="sp-avatar-person w-10 h-10 rounded-full grid place-items-center font-bold border-2 border-card">C</div>
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-card border-2 border-card overflow-hidden">
                                            <img src="/mr-imagine/mr-imagine-head-happy.png" alt="" className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h3 className="font-display text-lg leading-tight truncate">{headerTitle}</h3>
                                    <p className="text-xs opacity-90 truncate">{headerSub}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                {live && (
                                    <button onClick={endChat} className="text-xs font-semibold px-2.5 py-1 rounded-full border border-card hover:bg-card hover:text-primary transition-colors">
                                        End chat
                                    </button>
                                )}
                                <button onClick={() => setIsOpen(false)} aria-label="Close chat" className="p-1.5 rounded-full hover:bg-card hover:text-primary transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="sp-chat-body flex-1 overflow-y-auto p-4 space-y-3">
                            {messages.map((msg, idx) => {
                                if (msg.role === 'note') {
                                    return <p key={idx} className="text-center text-xs text-muted py-1">{msg.content}</p>
                                }
                                if (msg.role === 'person') {
                                    return (
                                        <div key={msg.id || idx} className="flex items-end gap-2">
                                            <div className="sp-avatar-person w-7 h-7 rounded-full grid place-items-center text-xs font-bold shrink-0">C</div>
                                            <div className="max-w-[80%]">
                                                <p className="text-[11px] font-semibold text-text-secondary mb-0.5">{PERSON} <span className="font-normal text-muted">{timeLabel(msg.timestamp)}</span></p>
                                                <div className="sp-bubble-person px-3.5 py-2.5 rounded-2xl rounded-bl-md text-sm whitespace-pre-wrap">{msg.content}</div>
                                            </div>
                                        </div>
                                    )
                                }
                                const mine = msg.role === 'user'
                                return (
                                    <div key={idx} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${mine ? 'sp-bubble-me rounded-br-md' : 'sp-bubble-them rounded-bl-md'}`}>
                                            {msg.content}
                                            {msg.link && (
                                                <Link to={msg.link.to} onClick={() => setIsOpen(false)} className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                                                    {msg.link.label} <ArrowRight className="w-3.5 h-3.5" />
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}

                            {isTyping && (
                                <div className="flex justify-start">
                                    <div className="sp-bubble-them px-3 py-2.5 rounded-2xl rounded-bl-md text-xs text-muted">Mr. Imagine is writing...</div>
                                </div>
                            )}

                            {showChips && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {CHIPS.map((c) => (
                                        <button key={c.label} type="button" onClick={() => askChip(c)} className="sp-chip">{c.label}</button>
                                    ))}
                                    <button type="button" onClick={() => startHandoff(lastUserText)} className="sp-chip sp-chip-person inline-flex items-center gap-1">
                                        <UserRound className="w-3.5 h-3.5" /> Talk to a person
                                    </button>
                                </div>
                            )}

                            {handoffError && stage === 'none' && (
                                <p className="text-xs text-muted">We could not reach the shop just now. Try again, or <Link to="/contact" className="text-primary font-semibold" onClick={() => setIsOpen(false)}>send us a message</Link>.</p>
                            )}

                            {/* Waiting for Christina */}
                            {(stage === 'connecting' || stage === 'waiting') && (
                                <div className="sp-wait rounded-2xl p-4" aria-live="polite">
                                    <div className="flex items-center gap-3">
                                        <div className="sp-avatar-person w-10 h-10 rounded-full grid place-items-center font-bold shrink-0">C</div>
                                        <div className="min-w-0">
                                            <p className="font-semibold text-text leading-tight">{PERSON} from our shop is on her way</p>
                                            <p className="text-xs text-muted">{stage === 'connecting' ? 'Sending her your message' : `Waiting ${formatWait(waitSeconds)}`}</p>
                                        </div>
                                    </div>
                                    <div className="sp-progress mt-3" role="progressbar" aria-label={`Waiting for ${PERSON}`}><span /></div>
                                    <ul className="mt-3 space-y-1 text-xs">
                                        <li className="flex items-center gap-1.5 text-text-secondary"><Check className="w-3.5 h-3.5 text-primary" /> {stage === 'connecting' ? 'Sending your message' : `Sent to ${PERSON}`}</li>
                                        <li className="flex items-center gap-1.5 text-muted"><span className="w-3.5 h-3.5 grid place-items-center"><span className="w-1.5 h-1.5 rounded-full bg-accent" /></span> {stage === 'waiting' ? waitingLine(waitSeconds) : 'Opening the chat'}</li>
                                    </ul>
                                    {stage === 'waiting' && (
                                        replyEmail ? (
                                            <p className="mt-3 flex items-start gap-1.5 text-xs text-text-secondary">
                                                <Mail className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                                                <span>Leave anytime. Her reply also goes to <strong className="text-text">{replyEmail}</strong>.</span>
                                            </p>
                                        ) : (
                                            <form onSubmit={saveEmail} className="mt-3">
                                                <p className="text-xs text-text-secondary mb-1.5">Leave anytime. Add your email and her reply goes there too.</p>
                                                <div className="flex gap-2">
                                                    <input type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="you@example.com" aria-label="Your email" className="sp-input !py-2 text-sm" />
                                                    <button type="submit" className="sp-btn !py-2 !px-3 text-sm">Save</button>
                                                </div>
                                                {emailError && <p className="mt-1 text-xs text-accent">{emailError}</p>}
                                            </form>
                                        )
                                    )}
                                </div>
                            )}

                            {stage === 'connected' && messages.every((m) => m.role !== 'person') && (
                                <p className="text-center text-xs text-muted">{PERSON} joined the chat</p>
                            )}

                            {/* Nobody reachable: the ticket is filed and she writes back by email */}
                            {stage === 'away' && (
                                <div className="sp-wait rounded-2xl p-4">
                                    <p className="font-semibold text-text">{PERSON} is away from the shop right now</p>
                                    <p className="mt-1 text-xs text-text-secondary">Your message is saved. She will write back by email{replyEmail ? ` to ${replyEmail}` : ''}, usually within a day.</p>
                                    {!replyEmail && (
                                        <form onSubmit={saveEmail} className="mt-3 flex gap-2">
                                            <input type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="you@example.com" aria-label="Your email" className="sp-input !py-2 text-sm" />
                                            <button type="submit" className="sp-btn !py-2 !px-3 text-sm">Save</button>
                                        </form>
                                    )}
                                    {emailError && <p className="mt-1 text-xs text-accent">{emailError}</p>}
                                    {ticketId && <p className="mt-2 text-xs text-muted">Reference {ticketId.slice(0, 8).toUpperCase()}</p>}
                                </div>
                            )}

                            {/* End of the chat */}
                            {stage === 'ended' && (
                                <div className="sp-card p-4 text-center">
                                    <p className="font-display text-xl text-text">Chat ended</p>
                                    <p className="mt-1 text-sm text-text-secondary">
                                        {personReplied
                                            ? `Thanks for chatting with ${PERSON}.${replyEmail ? ` Her replies are in your email at ${replyEmail}.` : ''}`
                                            : replyEmail
                                                ? `${PERSON} will still write back to ${replyEmail}.`
                                                : 'Still need a hand? Send us a message and we will write back.'}
                                    </p>
                                    {ticketId && <p className="mt-1 text-xs text-muted">Reference {ticketId.slice(0, 8).toUpperCase()}</p>}
                                    <button type="button" onClick={startOver} className="sp-btn mt-3 !py-2 text-sm">Start a new chat</button>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        {stage !== 'ended' && (
                            <form onSubmit={handleSubmit} className="p-3 border-t border-border bg-card shrink-0">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        placeholder={live ? `Message ${PERSON}` : 'Type a message'}
                                        aria-label="Message"
                                        className="sp-input !rounded-full !py-2.5 text-sm"
                                    />
                                    <button type="submit" aria-label="Send" disabled={!inputValue.trim() || isTyping} className="sp-btn !rounded-full !p-2.5 shrink-0">
                                        <Send size={16} />
                                    </button>
                                </div>
                                {stage === 'none' && !showChips && (
                                    <button type="button" onClick={() => startHandoff(lastUserText)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                                        <UserRound className="w-3.5 h-3.5" /> Talk to a person
                                    </button>
                                )}
                            </form>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Launcher */}
            {!isOpen && (
                <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => { setUnreadCount(0); setIsOpen(true) }}
                    aria-label={unreadCount ? `Shop chat, ${unreadCount} new` : 'Open shop chat'}
                    className="sp-launcher pointer-events-auto relative flex items-center gap-2 rounded-full bg-card border-2 border-card sm:pr-3.5"
                >
                    <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-card shrink-0 block">
                        <img src="/mr-imagine/mr-imagine-head-happy.png" alt="" className="w-full h-full object-cover" />
                    </span>
                    <span className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-text">
                        <MessageCircle className="w-4 h-4 text-primary" /> {live ? `${PERSON} is on her way` : 'Chat with us'}
                    </span>
                    {unreadCount > 0 && (
                        <span className="sp-badge absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-bold grid place-items-center border-2 border-card">
                            {unreadCount}
                        </span>
                    )}
                </motion.button>
            )}
        </div>
    )
}
