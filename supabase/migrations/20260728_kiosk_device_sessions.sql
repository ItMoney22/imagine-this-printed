-- Kiosk device provisioning + short-lived session tokens.
--
-- Watchtower ITP Closeout campaign, 2026-07-28 (task 83eb5c5b). Prior kiosk
-- auth was 100% client-side: KioskAuthContext minted a `User` object with
-- role:'kiosk' straight from the URL's :kioskId param, with no shared
-- secret, no device attestation, no server-issued session. Anyone who could
-- guess/enumerate a kiosk ID got kiosk UI access.
--
-- These two tables are backend-only (service role). No RLS policy is
-- granted to `anon` or `authenticated` on either — RLS enabled + zero
-- policies means both of those roles get nothing, ever. The service-role
-- key (used only by backend/lib/supabase.ts, never shipped to the browser)
-- bypasses RLS entirely, which is the ONLY way these tables are touched.
-- The browser never queries `kiosk_devices` / `kiosk_sessions` directly —
-- it exchanges a device secret for a session token via
-- POST /api/kiosk/session (backend/routes/kiosk.ts), and the resulting
-- opaque token is the only thing that ever reaches the client.
--
-- Only hashes are ever persisted, matching the raw-secret-never-stored
-- pattern used elsewhere in this backend (see backend/middleware/
-- requireStorefrontSecret.ts's safeEqual / crypto.timingSafeEqual): a
-- leaked database dump does not hand out usable device secrets or session
-- tokens.

CREATE TABLE kiosk_devices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kiosk_id UUID REFERENCES kiosks(id) ON DELETE CASCADE NOT NULL,
  label TEXT,
  secret_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX idx_kiosk_devices_kiosk_id ON kiosk_devices(kiosk_id);
CREATE INDEX idx_kiosk_devices_secret_hash ON kiosk_devices(secret_hash);

CREATE TABLE kiosk_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kiosk_id UUID REFERENCES kiosks(id) ON DELETE CASCADE NOT NULL,
  device_id UUID REFERENCES kiosk_devices(id) ON DELETE CASCADE NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kiosk_sessions_token_hash ON kiosk_sessions(token_hash);
CREATE INDEX idx_kiosk_sessions_kiosk_id ON kiosk_sessions(kiosk_id);
CREATE INDEX idx_kiosk_sessions_device_id ON kiosk_sessions(device_id);

ALTER TABLE kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Audit finding, same task: "All users can view active kiosks" (from
-- 002_rls_policies.sql) had no `TO` clause, so it applied to `anon` too —
-- meaning the public anon key (shipped in every frontend bundle, see
-- .env.example VITE_SUPABASE_ANON_KEY) could `select * from kiosks where
-- is_active = true` straight from the browser and read every active
-- kiosk's full row: commission_rate, partner_commission_rate, settings
-- JSONB, total_sales, everything. This was live and exploitable
-- independent of the role:'kiosk' question the task asked about — role:
-- 'kiosk' itself grants ZERO server-side privileges (grepped backend/ and
-- supabase/: no RLS policy, no route, anywhere checks for role = 'kiosk';
-- it only ever existed as a client-side React context value).
--
-- Nothing legitimate needs this policy after this migration: the kiosk
-- terminal flow no longer queries `kiosks` from the browser at all (it
-- goes through POST /api/kiosk/session and the requireKioskSession-gated
-- routes in backend/routes/kiosk.ts, both service-role). Vendors keep
-- direct query access to their own kiosks via the existing
-- "Vendors can manage their own kiosks" policy (auth.uid() = vendor_id).
DROP POLICY IF EXISTS "All users can view active kiosks" ON kiosks;
