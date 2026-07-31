-- Messaging + CRM real-storage tables
-- Written: 2026-07-27
-- Author: earth/zero-nine (Watchtower dispatch, itp-payments-hardening tree)
--
-- NOT auto-applied. supabase/migrations/ is owned by another in-flight agent
-- on this tree, so this file lives in docs/sql/ as a reviewable script.
-- David/another agent should copy this into a real supabase/migrations/*.sql
-- file (or run it directly against the project DB) once merged.
--
-- Covers three Watchtower tasks:
--   0e9fe183 — Back messaging service with real tables and RLS
--   bdeae6c2 — Persist CRM mutations to Supabase (custom_job_requests + CRM notes/tags)
-- (Task ac775fe5, the Community/social wiring task, needed NO new tables —
--  social_submissions/social_posts/social_votes already exist and are real,
--  see supabase/migrations/20251222_social_content.sql.)

-- =====================================================================
-- 1. conversations + messages (direct messaging: customer <-> vendor)
-- =====================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Canonicalized so a pair of users always maps to exactly one row,
  -- regardless of who initiated: participant_one is always the
  -- lexicographically-smaller UUID (enforced by the app, not by DB trigger,
  -- to keep this file simple — see sortParticipantIds() in
  -- src/utils/messaging.ts).
  participant_one UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_two UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tags TEXT[] DEFAULT '{}',
  -- Per-user archive: array of user ids who have archived their view of this
  -- conversation. Archiving is per-participant (one side hiding it must not
  -- delete it for the other side).
  archived_by UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT conversations_distinct_participants CHECK (participant_one <> participant_two),
  CONSTRAINT conversations_unique_pair UNIQUE (participant_one, participant_two)
);

CREATE INDEX IF NOT EXISTS idx_conversations_participant_one ON conversations(participant_one);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_two ON conversations(participant_two);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  message_type VARCHAR(50) NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'file', 'product_inquiry', 'order_update')),
  -- Attachment metadata only (name/size/mimeType/type). No object-storage
  -- upload pipeline is wired up in this pass — see handoff "DELIBERATELY LEFT
  -- OUT". Real files are never persisted server-side yet.
  attachments JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread ON messages(recipient_id) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- conversations: default deny. Only the two named participants can see or
-- touch a conversation row. No DELETE policy anywhere — conversations are
-- archived (per-user), never hard-deleted, so there is no delete path at all
-- (RLS with zero matching policies denies every DELETE, including anon).
CREATE POLICY "Participants can view their conversations" ON conversations
  FOR SELECT USING (auth.uid() = participant_one OR auth.uid() = participant_two);

CREATE POLICY "Participants can create conversations" ON conversations
  FOR INSERT WITH CHECK (auth.uid() = participant_one OR auth.uid() = participant_two);

CREATE POLICY "Participants can update their conversations" ON conversations
  FOR UPDATE USING (auth.uid() = participant_one OR auth.uid() = participant_two)
  WITH CHECK (auth.uid() = participant_one OR auth.uid() = participant_two);

-- messages: default deny. A user may only read a message if they are a
-- participant of its parent conversation (join back to conversations, so
-- conversation_id can't be spoofed to read someone else's thread). A user
-- may only insert as themselves (sender_id = auth.uid()) into a conversation
-- they belong to. Only the recipient may flip is_read (markAsRead). No
-- UPDATE of content/sender is meaningfully possible since the only UPDATE
-- policy is scoped to the recipient, and no DELETE policy exists at all.
CREATE POLICY "Participants can view their messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_one = auth.uid() OR c.participant_two = auth.uid())
    )
  );

CREATE POLICY "Participants can send messages" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_one = auth.uid() OR c.participant_two = auth.uid())
    )
  );

CREATE POLICY "Recipients can mark their messages read" ON messages
  FOR UPDATE USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

CREATE OR REPLACE FUNCTION update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_conversations_updated_at ON conversations;
CREATE TRIGGER trigger_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_conversations_updated_at();

CREATE OR REPLACE FUNCTION update_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_messages_updated_at ON messages;
CREATE TRIGGER trigger_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_messages_updated_at();

COMMENT ON TABLE conversations IS 'Direct-message threads between two users (customer<->vendor). Canonicalized pair per row.';
COMMENT ON TABLE messages IS 'Individual messages within a conversation. RLS restricts to the two participants.';

-- =====================================================================
-- 2. custom_job_requests (CRM "Custom Jobs" tab)
-- =====================================================================
-- Referenced today only by src/pages/CRM.tsx, wrapped in a try/catch because
-- the table doesn't exist yet ("custom_job_requests table may not exist
-- yet"). No submission UI writes to it in this pass — CRM.tsx's
-- updateJobStatus() is the only writer being wired up here. The table starts
-- empty until a future submission flow is built; that's out of scope (see
-- handoff "DELIBERATELY LEFT OUT").

CREATE TABLE IF NOT EXISTS custom_job_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  requirements TEXT,
  budget DECIMAL,
  deadline TIMESTAMPTZ,
  files TEXT[] DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'in_progress', 'completed', 'rejected')),
  assigned_to UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  estimated_cost DECIMAL,
  final_cost DECIMAL,
  notes TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_job_requests_user_id ON custom_job_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_job_requests_status ON custom_job_requests(status);

ALTER TABLE custom_job_requests ENABLE ROW LEVEL SECURITY;

-- Requesting customer can see/create their own row. Staff (admin/manager/
-- founder, resolved server-side via user_profiles.role — never trust a
-- client-asserted role) can see and update all rows, matching the existing
-- social_submissions convention in 20251222_social_content.sql.
CREATE POLICY "Customers can view own job requests" ON custom_job_requests
  FOR SELECT USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder')
    )
  );

CREATE POLICY "Customers can create own job requests" ON custom_job_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Staff can update job requests" ON custom_job_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

-- No DELETE policy: default deny.

DROP TRIGGER IF EXISTS trigger_custom_job_requests_updated_at ON custom_job_requests;
CREATE TRIGGER trigger_custom_job_requests_updated_at
  BEFORE UPDATE ON custom_job_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_messages_updated_at(); -- reuses the generic "set updated_at = now()" function above

COMMENT ON TABLE custom_job_requests IS 'Customer-submitted custom job requests tracked in the admin CRM.';

-- =====================================================================
-- 3. crm_notes + crm_tags (CRM "Customers" tab: addNote / addTag / removeTag)
-- =====================================================================
-- Deliberately NOT columns on user_profiles. That table is central to auth
-- (read/written by other in-flight agents on this tree right now) and
-- ALTERing it for a CRM-only concern is unnecessary blast radius. These are
-- small, additive, admin-only side tables instead — resolves the task's open
-- question about where notes/tags for CRM entries should live.

CREATE TABLE IF NOT EXISTS crm_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  note_type VARCHAR(20) NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('general', 'order', 'complaint', 'follow_up')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_notes_customer_id ON crm_notes(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_crm_tags_customer_id ON crm_tags(customer_id);

ALTER TABLE crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tags ENABLE ROW LEVEL SECURITY;

-- Staff-only (admin/manager/founder) on both tables, in both directions —
-- this is an internal CRM tool, not customer-facing. Default deny for
-- everyone else, including the customer the note/tag is about.
CREATE POLICY "Staff can view crm notes" ON crm_notes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );
CREATE POLICY "Staff can create crm notes" ON crm_notes
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

CREATE POLICY "Staff can view crm tags" ON crm_tags
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );
CREATE POLICY "Staff can create crm tags" ON crm_tags
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );
CREATE POLICY "Staff can delete crm tags" ON crm_tags
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

-- No DELETE policy on crm_notes (notes are an append-only log, matching the
-- existing ContactNote UI which only ever prepends). No UPDATE policy on
-- either table — both are add/remove, never edit-in-place.

COMMENT ON TABLE crm_notes IS 'Append-only internal notes on a customer, shown in the admin CRM.';
COMMENT ON TABLE crm_tags IS 'Admin-assigned tags on a customer, shown in the admin CRM.';
