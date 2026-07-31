-- Social outbox: the review-gated queue Rico (Watchtower browser agent) pulls
-- from to post on TikTok and create/edit Shop listings. Items are created as
-- 'draft' (auto-enqueued when a design goes active, or bulk-enqueued from the
-- admin UI), David edits/approves in the admin Outbox tab, and only 'approved'
-- items are claimable through the bridge API.

CREATE TABLE IF NOT EXISTS public.social_outbox (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'tiktok',
  kind TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'listing')),
  caption TEXT,
  hashtags TEXT[] DEFAULT '{}',
  media_urls TEXT[] DEFAULT '{}',
  listing JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'claimed', 'posted', 'failed')),
  post_url TEXT,
  result_note TEXT,
  claimed_at TIMESTAMP WITH TIME ZONE,
  posted_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One outbox item per product/platform/kind keeps auto-enqueue idempotent
CREATE UNIQUE INDEX IF NOT EXISTS social_outbox_product_platform_kind
  ON public.social_outbox (product_id, platform, kind);

CREATE INDEX IF NOT EXISTS social_outbox_status_idx
  ON public.social_outbox (status, created_at);

-- Service-role only (backend API is the gate)
ALTER TABLE public.social_outbox ENABLE ROW LEVEL SECURITY;
