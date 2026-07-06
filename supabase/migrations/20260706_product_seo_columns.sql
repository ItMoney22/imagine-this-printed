-- Per-design SEO metadata (Prisma already mapped these; live DB verified
-- missing them 2026-07-06). Populated by the post-approval SEO pack + hourly
-- backfill sweep. search_keywords is comma-separated text to match the
-- existing Prisma String? mapping.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS meta_title TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS meta_description TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_keywords TEXT;

-- Slug lookups now serve public product URLs (/product/<slug>)
CREATE INDEX IF NOT EXISTS products_slug_idx ON public.products (slug);
