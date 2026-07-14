-- Add alt_text column for Merch Studio SEO image alt text.
-- meta_title, meta_description, and search_keywords already exist
-- (20260706_product_seo_columns.sql); this adds the missing alt_text.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS alt_text TEXT;