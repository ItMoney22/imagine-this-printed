-- Messaging + CRM real-storage tables (promoted from docs/sql/2026-07-27-messaging-crm-tables.sql)
--
-- Watchtower tasks: 190ab42b (this promotion), 0e9fe183 (messaging service +
-- real tables), bdeae6c2 (CRM mutations persisted to Supabase). Task ac775fe5
-- (community) needed no new tables -- social_submissions/social_posts/
-- social_votes already exist, see 20251222_social_content.sql.
--
-- Creates FIVE tables with RLS: conversations, messages, custom_job_requests,
-- crm_notes, crm_tags.
--
-- ---------------------------------------------------------------------------
-- CORRECTION TO THE TASK PREMISE, verified live 2026-07-28 (read-only query
-- against information_schema/pg_policies over the production DB, no writes):
-- NONE of the five tables above exist in production. The docs/sql file's own
-- header already said as much ("NOT auto-applied... David/another agent
-- should copy this into a real supabase/migrations/*.sql file... once
-- merged") -- it was written but never actually run against the DB. So this
-- migration is a REAL create in production, not the no-op the task board
-- text assumed. It is still written idempotently (guarded so a second run,
-- or a run after the tables already exist for any other reason, is a safe
-- no-op) per the task's explicit requirement.
-- ---------------------------------------------------------------------------
-- COLLISION FOUND AND HANDLED: 001_initial_schema.sql:253-271 already
-- declares a DIFFERENT `messages` table -- `conversation_id TEXT NOT NULL`
-- (no FK; a `conversations` table never existed before this file) plus
-- subject/is_archived/is_pinned/priority/reply_to/read_at columns the real
-- messaging feature never uses. Verified live: production has NO `messages`
-- table at all, so 001's declaration was apparently never applied there
-- either (same kind of repo/live drift as 20260727_fix_itc_wallet_schema_drift.sql).
-- grep across backend/ + src/ confirms src/utils/messaging.ts is the ONLY
-- caller of `.from('messages')` in this repo, and it only ever used the NEW
-- shape -- the old shape is dead code with zero readers/writers anywhere.
-- The only place it can exist is a fresh/dev DB that ran 001 top to bottom.
-- The DO block right below retires that dead legacy table -- but ONLY when
-- it (a) actually matches the old shape and (b) is empty, so this can never
-- silently drop real data. If a non-empty table somehow matches the legacy
-- shape, it RAISEs a WARNING and leaves it alone for a human instead of
-- creating the new messages table.
-- ---------------------------------------------------------------------------
-- WHY THE CRM STAFF-ROLE CHECKS BELOW USE A RAW SUBQUERY, NOT
-- public.get_user_role(): verified live 2026-07-28 that public.user_profiles
-- has BOTH an `id` and a `user_id` column, which means public.get_user_role()
-- as currently deployed in production errors with "column reference
-- \"user_id\" is ambiguous" on every call -- this is exactly the bug
-- 20260728_fix_get_user_role_ambiguity.sql fixes, and that migration had NOT
-- been applied live as of this writing. CREATE POLICY doesn't execute the
-- predicate at creation time, so calling get_user_role() here would work
-- once that other migration also lands -- but this migration must be correct
-- on its own without depending on another in-flight migration being applied
-- in the same batch. The raw
-- `EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN (...))`
-- form only ever references `id` (never `user_id`), so it cannot hit that
-- ambiguity bug, and it only ever reads the CALLER's own row (auth.uid() =
-- id), which "Users can view their own profile" in 002_rls_policies.sql
-- already allows. This matches the pattern the original docs/sql draft used.
-- ---------------------------------------------------------------------------
-- Applying this migration to production: a real create (see above), fully
-- idempotent -- safe to run twice, safe to run after a partial manual apply.
-- Applying to a fresh DB (001 -> ... -> here): retires the dead legacy
-- `messages` table if empty, then creates the real schema. NOT applied by
-- this campaign pass -- David applies it by hand (see handoff for the RLS
-- proof + smoke test to run immediately after).

-- =====================================================================
-- 0. Retire the dead legacy `messages` table from 001_initial_schema.sql,
--    only if it is both the old shape AND empty. Never drops real data.
-- =====================================================================
DO $$
DECLARE
  is_legacy_shape BOOLEAN;
  legacy_row_count BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name = 'conversation_id' AND data_type = 'text'
  ) INTO is_legacy_shape;

  IF is_legacy_shape THEN
    EXECUTE 'SELECT count(*) FROM public.messages' INTO legacy_row_count;
    IF legacy_row_count = 0 THEN
      DROP TABLE public.messages CASCADE;
    ELSE
      RAISE WARNING 'public.messages has the legacy 001_initial_schema.sql shape (conversation_id TEXT) AND % existing row(s) -- NOT dropping automatically. The new messaging schema was NOT created this run; a human needs to reconcile this table by hand first.', legacy_row_count;
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 1. conversations + messages (direct messaging: customer <-> vendor)
-- =====================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Canonicalized so a pair of users always maps to exactly one row,
  -- regardless of who initiated: participant_one is always the
  -- lexicographically-smaller UUID (enforced by the app, not by DB trigger,
  -- to keep this file simple -- see sortParticipantIds() in
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
  -- Attachment metadata (id/type/name/size/mimeType/gcsPath). Real files are
  -- uploaded to GCS server-side -- see backend/routes/messaging.ts -- and only
  -- the storage path is kept here, never a long-lived signed URL. Access is
  -- re-authorized and a fresh short-lived signed URL minted per request; see
  -- 2f4f06ea handoff for the full design.
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
-- touch a conversation row. No DELETE policy anywhere -- conversations are
-- archived (per-user), never hard-deleted, so there is no delete path at all
-- (RLS with zero matching policies denies every DELETE, including anon).
DROP POLICY IF EXISTS "Participants can view their conversations" ON conversations;
CREATE POLICY "Participants can view their conversations" ON conversations
  FOR SELECT USING (auth.uid() = participant_one OR auth.uid() = participant_two);

DROP POLICY IF EXISTS "Participants can create conversations" ON conversations;
CREATE POLICY "Participants can create conversations" ON conversations
  FOR INSERT WITH CHECK (auth.uid() = participant_one OR auth.uid() = participant_two);

DROP POLICY IF EXISTS "Participants can update their conversations" ON conversations;
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
DROP POLICY IF EXISTS "Participants can view their messages" ON messages;
CREATE POLICY "Participants can view their messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_one = auth.uid() OR c.participant_two = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can send messages" ON messages;
CREATE POLICY "Participants can send messages" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_one = auth.uid() OR c.participant_two = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Recipients can mark their messages read" ON messages;
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
-- yet"). No submission UI writes to it yet -- CRM.tsx's updateJobStatus() is
-- the only writer. The table starts empty until a future submission flow is
-- built.

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
-- founder, resolved server-side via user_profiles.role -- never trust a
-- client-asserted role) can see and update all rows, matching the existing
-- social_submissions convention in 20251222_social_content.sql. Raw subquery
-- (not public.get_user_role()) -- see header comment for why.
DROP POLICY IF EXISTS "Customers can view own job requests" ON custom_job_requests;
CREATE POLICY "Customers can view own job requests" ON custom_job_requests
  FOR SELECT USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder')
    )
  );

DROP POLICY IF EXISTS "Customers can create own job requests" ON custom_job_requests;
CREATE POLICY "Customers can create own job requests" ON custom_job_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Staff can update job requests" ON custom_job_requests;
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
-- (touched by several other in-flight migrations this same day) and
-- ALTERing it for a CRM-only concern is unnecessary blast radius. These are
-- small, additive, admin-only side tables instead.

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

-- Staff-only (admin/manager/founder) on both tables, in both directions --
-- this is an internal CRM tool, not customer-facing. Default deny for
-- everyone else, including the customer the note/tag is about.
DROP POLICY IF EXISTS "Staff can view crm notes" ON crm_notes;
CREATE POLICY "Staff can view crm notes" ON crm_notes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );
DROP POLICY IF EXISTS "Staff can create crm notes" ON crm_notes;
CREATE POLICY "Staff can create crm notes" ON crm_notes
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

DROP POLICY IF EXISTS "Staff can view crm tags" ON crm_tags;
CREATE POLICY "Staff can view crm tags" ON crm_tags
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );
DROP POLICY IF EXISTS "Staff can create crm tags" ON crm_tags;
CREATE POLICY "Staff can create crm tags" ON crm_tags
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );
DROP POLICY IF EXISTS "Staff can delete crm tags" ON crm_tags;
CREATE POLICY "Staff can delete crm tags" ON crm_tags
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

-- No DELETE policy on crm_notes (notes are an append-only log, matching the
-- existing ContactNote UI which only ever prepends). No UPDATE policy on
-- either table -- both are add/remove, never edit-in-place.

COMMENT ON TABLE crm_notes IS 'Append-only internal notes on a customer, shown in the admin CRM.';
COMMENT ON TABLE crm_tags IS 'Admin-assigned tags on a customer, shown in the admin CRM.';
