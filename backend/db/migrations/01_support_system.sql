-- Create support_tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  status TEXT CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')) DEFAULT 'open',
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  category TEXT, -- 'order_status', 'product_quality', 'billing', 'technical_issue', 'other'
  subject TEXT,
  description TEXT,
  assigned_to UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Create ticket_messages table
CREATE TABLE IF NOT EXISTS ticket_messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id), -- NULL for system messages if needed, but usually linked to user or agent
  content TEXT,
  is_internal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;

-- Policies for support_tickets
-- Users can view their own tickets
CREATE POLICY "Users can view own tickets" ON support_tickets
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create tickets
CREATE POLICY "Users can insert own tickets" ON support_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins/Agents can view all tickets (This assumes you have a way to check roles, e.g., metadata or separate table)
-- Simplifying for now: If you use Supabase Dashboard or Service Role in backend, RLS is bypassed.
-- For client-side admin usage, you'd need a policy like:
-- CREATE POLICY "Admins can view all tickets" ON support_tickets
--   FOR ALL USING (auth.jwt() ->> 'role' = 'service_role' OR exists(select 1 from user_profiles where id = auth.uid() and role in ('admin', 'manager', 'support')));

-- Policies for ticket_messages
-- Users can view messages on their tickets
CREATE POLICY "Users can view own ticket messages" ON ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM support_tickets WHERE id = ticket_messages.ticket_id AND user_id = auth.uid()
    )
  );

-- Users can add messages to their tickets
CREATE POLICY "Users can add messages to own tickets" ON ticket_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets WHERE id = ticket_messages.ticket_id AND user_id = auth.uid()
    )
  );
