-- Wholesale application persistence (Watchtower task 0af32316-5bf6-4df8-9f81-b842ed121c69).
--
-- WHY: src/pages/WholesalePortal.tsx used to call `alert('Application
-- submitted!')` and throw the form data away — every inbound wholesale lead
-- was silently dropped. This table gives applications somewhere real to
-- land, and the admin_notifications type CHECK is extended (same pattern as
-- 20260706_blank_inventory.sql did for 'low_stock'/'order_stalled') so a new
-- application shows up in the existing admin alert surface, not a new one.

CREATE TABLE IF NOT EXISTS public.wholesale_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  company_name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  tax_id TEXT,
  contact_first_name TEXT,
  contact_last_name TEXT,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  address JSONB DEFAULT '{}',
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wholesale_applications_user_id ON public.wholesale_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_wholesale_applications_status ON public.wholesale_applications(status);

ALTER TABLE public.wholesale_applications ENABLE ROW LEVEL SECURITY;

-- A signed-in user can read their own application(s) so the portal can show
-- an "application pending" state. All writes go through the backend
-- (service role), which is the only path that also notifies admins.
DROP POLICY IF EXISTS "Users can view their own wholesale applications" ON public.wholesale_applications;
CREATE POLICY "Users can view their own wholesale applications" ON public.wholesale_applications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to wholesale applications" ON public.wholesale_applications;
CREATE POLICY "Service role full access to wholesale applications" ON public.wholesale_applications
  FOR ALL USING (auth.role() = 'service_role');

-- ===========================================================================
-- 2026-08-16 (Watchtower task ae9c62ac) — this block is DEFUSED, not deleted.
--
-- As originally written it rewrote the whole type list from the wholesale
-- branch's point of view, so applying it TODAY would have dropped
-- 'payment_dispute' (chargeback alerts, live since 20260727) and 'new_order'.
-- The list is now the full union, so a cold run of this file can no longer
-- destroy another branch's types.
--
-- It is also redundant: `20260816_admin_notifications_type_union.sql` owns the
-- type list now and computes it as a union instead of restating a literal.
-- The part of THIS file that production still needs is the
-- `wholesale_applications` TABLE above — it is missing from prod, which is why
-- POST /api/wholesale/apply currently drops every inbound wholesale lead. That
-- is tracked separately; do not apply this file just for the CHECK.
-- ===========================================================================
ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN (
    'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
    'low_stock', 'order_stalled', 'health_alert',
    'payment_dispute',
    'wholesale_application',
    'new_order'
  ));
