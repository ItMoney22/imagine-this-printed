import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, Search, Filter, MessageSquare, Clock, AlertCircle, RefreshCw, UserCheck, UserX, PhoneCall, PhoneOff } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/SupabaseAuthContext'

interface Ticket {
    id: string
    user: {
        email: string
        first_name: string
        last_name: string
        avatar_url: string
    }
    status: 'open' | 'in_progress' | 'resolved' | 'closed'
    priority: 'low' | 'medium' | 'high' | 'urgent'
    category: string
    subject: string
    description: string
    created_at: string
}

interface TicketMessage {
    id: string
    sender: {
        first_name: string
        last_name: string
        role: string
    }
    content: string
    created_at: string
    is_internal: boolean
}

const AdminSupport: React.FC = () => {
    const { user } = useAuth()
    const [tickets, setTickets] = useState<Ticket[]>([])
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
    const [messages, setMessages] = useState<TicketMessage[]>([])
    const [loading, setLoading] = useState(true)
    const [replyContent, setReplyContent] = useState('')
    const [isAgentOnline, setIsAgentOnline] = useState(false)
    const [isLiveChatActive, setIsLiveChatActive] = useState(false)
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Filter states
    const [statusFilter, setStatusFilter] = useState('all')
    const [priorityFilter, setPriorityFilter] = useState('all')

    useEffect(() => {
        fetchTickets()
        checkAgentStatus()
    }, [statusFilter, priorityFilter])

    useEffect(() => {
        if (selectedTicket) {
            fetchTicketMessages(selectedTicket.id)
        }
    }, [selectedTicket])

    const fetchTickets = async () => {
        try {
            setLoading(true)
            let url = `${import.meta.env.VITE_API_BASE}/api/admin/support/tickets?limit=50`
            if (statusFilter !== 'all') url += `&status=${statusFilter}`
            if (priorityFilter !== 'all') url += `&priority=${priorityFilter}`

            const response = await axios.get(url, { withCredentials: true })
            setTickets(response.data.tickets)
        } catch (error) {
            console.error('Error fetching tickets:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchTicketMessages = async (ticketId: string) => {
        try {
            const response = await axios.get(`${import.meta.env.VITE_API_BASE}/api/admin/support/tickets/${ticketId}`, { withCredentials: true })
            setMessages(response.data.messages)
        } catch (error) {
            console.error('Error fetching messages:', error)
        }
    }

    const handleReply = async () => {
        if (!selectedTicket || !replyContent.trim()) return

        try {
            await axios.post(`${import.meta.env.VITE_API_BASE}/api/admin/support/tickets/${selectedTicket.id}/reply`, {
                content: replyContent,
                adminId: 'current-admin-id', // Ideally get this from auth context
                status: 'in_progress' // Auto update status on reply
            }, { withCredentials: true })

            setReplyContent('')
            fetchTicketMessages(selectedTicket.id)
            // Optionally refresh ticket status in list
        } catch (error) {
            console.error('Error sending reply:', error)
            alert('Failed to send reply')
        }
    }

    const toggleAgentStatus = async () => {
        try {
            const newStatus = !isAgentOnline
            await axios.post(`${import.meta.env.VITE_API_BASE}/api/admin/support/status`, {
                adminId: 'current-admin-id', // Get from context
                isOnline: newStatus
            }, { withCredentials: true })
            setIsAgentOnline(newStatus)
        } catch (error) {
            console.error('Error updating status:', error)
        }
    }

    const checkAgentStatus = async () => {
        // In a real app we'd fetch this user's specific status or the global availability
        // For now, toggle locally or fetch initial
    }

    // Live Chat Functions
    const claimLiveChat = async () => {
        if (!selectedTicket || !user) return
        try {
            await axios.post(`${import.meta.env.VITE_API_BASE}/api/admin/support/tickets/${selectedTicket.id}/claim`, {
                adminId: user.id
            }, { withCredentials: true })
            setIsLiveChatActive(true)
            startLiveChatPolling()
        } catch (error: any) {
            console.error('Error claiming live chat:', error)
            alert(error.response?.data?.error || 'Failed to claim live chat')
        }
    }

    const releaseLiveChat = async () => {
        if (!selectedTicket) return
        try {
            await axios.post(`${import.meta.env.VITE_API_BASE}/api/admin/support/tickets/${selectedTicket.id}/release`, {}, { withCredentials: true })
            setIsLiveChatActive(false)
            stopLiveChatPolling()
        } catch (error) {
            console.error('Error releasing live chat:', error)
        }
    }

    const startLiveChatPolling = () => {
        if (pollIntervalRef.current) return
        pollIntervalRef.current = setInterval(() => {
            if (selectedTicket) {
                fetchTicketMessages(selectedTicket.id)
            }
        }, 2000)
    }

    const stopLiveChatPolling = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
        }
    }

    // Clean up polling when ticket changes or component unmounts
    useEffect(() => {
        return () => stopLiveChatPolling()
    }, [])

    useEffect(() => {
        if (isLiveChatActive && selectedTicket) {
            startLiveChatPolling()
        } else {
            stopLiveChatPolling()
        }
    }, [isLiveChatActive, selectedTicket])

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'urgent': return 'text-red-500 bg-red-500/10'
            case 'high': return 'text-orange-500 bg-orange-500/10'
            case 'medium': return 'text-yellow-500 bg-yellow-500/10'
            case 'low': return 'text-green-500 bg-green-500/10'
            default: return 'text-gray-400 bg-gray-500/10'
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'open': return 'text-blue-400 border-blue-400/30'
            case 'in_progress': return 'text-purple-400 border-purple-400/30'
            case 'resolved': return 'text-green-400 border-green-400/30'
            case 'closed': return 'text-gray-400 border-gray-400/30'
            default: return 'text-gray-400'
        }
    }

    return (
        <div className="flex h-[calc(100vh-120px)] gap-6">
            {/* Ticket List */}
            <div className="w-1/3 flex flex-col glass-card border-white/5 bg-black/40 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-white/5 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            Support Tickets
                        </h2>
                        <button
                            onClick={toggleAgentStatus}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 transition-all ${isAgentOnline
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                }`}
                        >
                            {isAgentOnline ? <UserCheck size={14} /> : <UserX size={14} />}
                            {isAgentOnline ? 'Online' : 'Offline'}
                        </button>
                    </div>

                    <div className="flex gap-2">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 focus:outline-none focus:border-purple-500"
                        >
                            <option value="all">All Status</option>
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="resolved">Resolved</option>
                        </select>
                        <select
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                            className="bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 focus:outline-none focus:border-purple-500"
                        >
                            <option value="all">All Priorities</option>
                            <option value="urgent">Urgent</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                        <button onClick={fetchTickets} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70">
                            <RefreshCw size={14} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <RefreshCw className="animate-spin text-purple-500" />
                        </div>
                    ) : tickets.map(ticket => (
                        <div
                            key={ticket.id}
                            onClick={() => setSelectedTicket(ticket)}
                            className={`p-3 rounded-xl cursor-pointer transition-all border ${selectedTicket?.id === ticket.id
                                    ? 'bg-purple-500/10 border-purple-500/50'
                                    : 'bg-white/5 border-transparent hover:bg-white/10'
                                }`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusColor(ticket.status)}`}>
                                    {ticket.status.replace('_', ' ').toUpperCase()}
                                </span>
                                <span className="text-[10px] text-white/40">
                                    {new Date(ticket.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <h4 className="font-medium text-white/90 truncate">{ticket.subject}</h4>
                            <p className="text-xs text-white/50 truncate mb-2">{ticket.description}</p>
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center text-[10px] font-bold text-white">
                                        {ticket.user?.first_name?.[0] || 'U'}
                                    </div>
                                    <span className="text-xs text-white/60">{ticket.user?.first_name} {ticket.user?.last_name}</span>
                                </div>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${getPriorityColor(ticket.priority)}`}>
                                    {ticket.priority}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Ticket Details & Chat */}
            <div className="w-2/3 flex flex-col glass-card border-white/5 bg-black/40 rounded-2xl overflow-hidden">
                {selectedTicket ? (
                    <>
                        <div className={`p-4 border-b border-white/5 flex justify-between items-center ${isLiveChatActive ? 'bg-green-500/10' : 'bg-white/5'}`}>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-bold text-white">{selectedTicket.subject}</h3>
                                    {isLiveChatActive && (
                                        <span className="px-2 py-0.5 text-[10px] font-bold bg-green-500 text-white rounded-full animate-pulse">
                                            LIVE
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-4 text-xs text-white/50 mt-1">
                                    <span>ID: {selectedTicket.id.slice(0, 8)}</span>
                                    <span>Category: {selectedTicket.category}</span>
                                    <span>User: {selectedTicket.user.email}</span>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {isLiveChatActive ? (
                                    <button
                                        onClick={releaseLiveChat}
                                        className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 transition-all bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                                    >
                                        <PhoneOff size={14} />
                                        End Live Chat
                                    </button>
                                ) : (
                                    <button
                                        onClick={claimLiveChat}
                                        className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 transition-all bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30"
                                    >
                                        <PhoneCall size={14} />
                                        Take Over Chat
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {/* Original Description */}
                            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                                <p className="text-sm text-white/80 whitespace-pre-wrap">{selectedTicket.description}</p>
                            </div>

                            {/* Messages */}
                            {messages.map(msg => (
                                <div key={msg.id} className={`flex ${msg.is_internal ? 'justify-center' : (msg.sender.role === 'admin' ? 'justify-end' : 'justify-start')}`}>
                                    {msg.is_internal ? (
                                        <span className="text-xs text-white/30 italic bg-white/5 px-2 py-1 rounded">Internal Note: {msg.content}</span>
                                    ) : (
                                        <div className={`max-w-[80%] rounded-2xl p-3 ${msg.sender.role === 'admin'
                                                ? 'bg-purple-600/20 border border-purple-500/30 text-white'
                                                : 'bg-white/10 border border-white/5 text-white/80'
                                            }`}>
                                            <div className="flex justify-between items-baseline mb-1 gap-4">
                                                <span className="text-xs font-bold opacity-70">{msg.sender.first_name}</span>
                                                <span className="text-[10px] opacity-40">{new Date(msg.created_at).toLocaleTimeString()}</span>
                                            </div>
                                            <p className="text-sm">{msg.content}</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="p-4 border-t border-white/5 bg-black/20">
                            <div className="flex gap-2 pb-2">
                                <button className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/60">Fast Reply</button>
                                <button className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/60">Internal Note</button>
                            </div>
                            <div className="flex gap-2">
                                <textarea
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    placeholder="Type your reply..."
                                    className="flex-1 bg-black/50 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-purple-500/50 resize-none h-20"
                                />
                                <button
                                    onClick={handleReply}
                                    className="px-6 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-all"
                                >
                                    Send
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-white/30">
                        <MessageSquare size={48} className="mb-4 opacity-50" />
                        <p>Select a ticket to view conversation</p>
                    </div>
                )}
            </div>
        </div>
    )
}

export default AdminSupport
