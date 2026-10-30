-- ITP's phone line, (470) 227-8666, on the shared MetaSphere voice bridge
-- (Watchtower task 20d54c05, David 2026-10-30). Written by backend/routes/phone.ts
-- with the service role only.
--
--   phone_calls       one row per inbound call (the parent leg): who called, how it
--                     ended, how long Mr. Imagine talked, and the support ticket the
--                     call left (a message, or a missed call), if any.
--   phone_call_turns  what was said, one line per turn, streamed by the bridge while
--                     the call is live; copied onto the call's ticket at hangup.
--
-- Additive only, nothing reads it but the API. RLS on with no policies: anon and
-- signed-in users see nothing. Rollback = drop both tables.

CREATE TABLE IF NOT EXISTS public.phone_calls (
  call_sid TEXT PRIMARY KEY,
  from_number TEXT,
  to_number TEXT,
  status TEXT,
  duration_seconds INTEGER,
  ai_seconds INTEGER NOT NULL DEFAULT 0,
  ticket_id UUID,
  transcript_filed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_calls_created_at ON public.phone_calls (created_at DESC);

CREATE TABLE IF NOT EXISTS public.phone_call_turns (
  id BIGSERIAL PRIMARY KEY,
  call_sid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('caller', 'assistant')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (call_sid, seq)
);

ALTER TABLE public.phone_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_call_turns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.phone_calls FROM anon, authenticated;
REVOKE ALL ON public.phone_call_turns FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
