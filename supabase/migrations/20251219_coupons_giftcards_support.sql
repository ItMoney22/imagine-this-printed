-- Migration: Create discount_codes, gift_cards, and support system tables
-- Date: 2024-12-19

-- ===============================
-- DISCOUNT CODES (Coupons) TABLE
-- ===============================
CREATE TABLE IF NOT EXISTS public.discount_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  type TEXT CHECK (type IN ('percentage', 'fixed', 'free_shipping')) DEFAULT 'percentage',
  value NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  min_order_amount NUMERIC DEFAULT 0,
  max_discount_amount NUMERIC,
  per_user_limit INTEGER DEFAULT 1,
  applies_to TEXT CHECK (applies_to IN ('usd', 'itc', 'both')) DEFAULT 'usd',
  created_by UUID REFERENCES auth.users(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Coupon usage tracking
CREATE TABLE IF NOT EXISTS public.coupon_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discount_code_id UUID REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  order_id UUID,
  discount_amount NUMERIC,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===============================
-- GIFT CARDS TABLE
-- ===============================
CREATE TABLE IF NOT EXISTS public.gift_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  itc_amount NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC DEFAULT 0, -- USD equivalent
  balance NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  recipient_email TEXT,
  sender_name TEXT,
  message TEXT,
  redeemed_by UUID REFERENCES auth.users(id),
  redeemed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===============================
-- SUPPORT SYSTEM TABLES
-- ===============================

-- Support tickets table (if not exists)
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  email TEXT, -- For guest tickets
  status TEXT CHECK (status IN ('open', 'waiting', 'in_progress', 'resolved', 'closed')) DEFAULT 'open',
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  category TEXT,
  subject TEXT,
  description TEXT,
  assigned_to UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ticket messages table (if not exists)
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id),
  sender_type TEXT CHECK (sender_type IN ('user', 'agent', 'system', 'ai')) DEFAULT 'user',
  message TEXT,
  is_internal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin notifications table
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT CHECK (type IN ('new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed')) DEFAULT 'new_ticket',
  title TEXT,
  message TEXT,
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent status table (for live chat)
CREATE TABLE IF NOT EXISTS public.agent_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) UNIQUE,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  active_ticket_id UUID REFERENCES public.support_tickets(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat sessions table (for live chat)
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE UNIQUE,
  user_id UUID REFERENCES auth.users(id),
  agent_id UUID REFERENCES auth.users(id),
  status TEXT CHECK (status IN ('waiting', 'active', 'ended')) DEFAULT 'waiting',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===============================
-- ROW LEVEL SECURITY
-- ===============================

-- Enable RLS on all tables
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- Discount codes policies
CREATE POLICY "Anyone can read active discount codes" ON public.discount_codes
  FOR SELECT USING (is_active = true);

CREATE POLICY "Service role full access to discount codes" ON public.discount_codes
  FOR ALL USING (true);

-- Coupon usage policies
CREATE POLICY "Users can view own coupon usage" ON public.coupon_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to coupon usage" ON public.coupon_usage
  FOR ALL USING (true);

-- Gift cards policies
CREATE POLICY "Users can view own redeemed gift cards" ON public.gift_cards
  FOR SELECT USING (auth.uid() = redeemed_by);

CREATE POLICY "Service role full access to gift cards" ON public.gift_cards
  FOR ALL USING (true);

-- Support tickets policies
CREATE POLICY "Users can view own tickets" ON public.support_tickets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tickets" ON public.support_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to support tickets" ON public.support_tickets
  FOR ALL USING (true);

-- Ticket messages policies
CREATE POLICY "Users can view messages on own tickets" ON public.ticket_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.support_tickets WHERE id = ticket_id AND user_id = auth.uid())
    AND is_internal = false
  );

CREATE POLICY "Users can add messages to own tickets" ON public.ticket_messages
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.support_tickets WHERE id = ticket_id AND user_id = auth.uid())
  );

CREATE POLICY "Service role full access to ticket messages" ON public.ticket_messages
  FOR ALL USING (true);

-- Admin notifications policies
CREATE POLICY "Service role full access to admin notifications" ON public.admin_notifications
  FOR ALL USING (true);

-- Agent status policies
CREATE POLICY "Anyone can check agent availability" ON public.agent_status
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to agent status" ON public.agent_status
  FOR ALL USING (true);

-- Chat sessions policies
CREATE POLICY "Users can view own chat sessions" ON public.chat_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to chat sessions" ON public.chat_sessions
  FOR ALL USING (true);

-- ===============================
-- INDEXES
-- ===============================

CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON public.discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_active ON public.discount_codes(is_active);
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON public.gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_active ON public.gift_cards(is_active);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON public.ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_read ON public.admin_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_agent_status_online ON public.agent_status(is_online);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON public.chat_sessions(status);
