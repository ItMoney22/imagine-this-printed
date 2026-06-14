-- Audit Logs Migration
-- Creates the audit_logs table that 6 writers reference but which never existed
-- live (every audit insert was failing silently; the AdminDashboard "Audit Logs"
-- tab read an empty table).
--
-- Unified superset schema. Writers were reconciled in the same change:
--   - wallet-logger.ts: entity_type -> entity
--   - ai-jobs-worker.ts: details    -> metadata
-- The other writers (orders.ts, stripe.ts, order-reward-service.ts,
-- AdminDashboard.tsx) already used entity / entity_id / changes.
--
-- Column types are intentionally TEXT for the actor/entity ids: system actions
-- (worker cleanup) have no user, and some callers pass non-UUID actor labels
-- (e.g. 'admin'), so a UUID column would reject otherwise-valid inserts.

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT,                              -- actor; nullable for system actions
  action      TEXT NOT NULL,                     -- e.g. 'order_completed', 'ROLE_CHANGE', 'wallet_credit'
  entity      TEXT,                              -- entity type label, e.g. 'order','wallet','User','VendorProduct'
  entity_id   TEXT,                              -- id of the affected entity
  changes     JSONB,                             -- before/after diff
  metadata    JSONB,                             -- arbitrary context (formerly worker `details` + wallet `metadata`)
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity  ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs(action);

-- ============================================
-- Row Level Security
-- Backend writers use the service-role key (RLS bypassed). The only client-side
-- caller is AdminDashboard (anon key + admin session), which both reads the tab
-- and inserts 5 admin actions — so admins/managers need SELECT + INSERT.
-- ============================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
CREATE POLICY "Admins can view audit logs" ON audit_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

DROP POLICY IF EXISTS "Admins can insert audit logs" ON audit_logs;
CREATE POLICY "Admins can insert audit logs" ON audit_logs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );
