-- Creator print files leave the public products row (Zero Pluto, 2026-10-07, Watchtower task b312de9c).
--
-- products is readable by anyone ("Anyone can view products" USING (true)), and a Merch Studio publish
-- (backend/routes/storefront.ts POST /api/storefront/products) wrote the creator's print-ready front.png
-- into metadata.print_files.front, metadata.assets.clean and metadata.assets.dtf as a 1-year signed GCS
-- URL. With the public anon key, GET /rest/v1/products?select=metadata->assets->>dtf handed Darrell
-- McCutchen's "Walk By Faith" print file to anyone.
--
-- The print file now lives in the PRIVATE bucket (imagine-this-printed-products: public access
-- prevention enforced) and this table records where. It holds object PATHS, never URLs: the API signs a
-- short-lived link at the moment the press floor needs it (services/print-files.ts).
--
-- Service role only: RLS on with no policies, and every grant revoked from anon/authenticated, so
-- PostgREST refuses the table to the website and to signed-in shoppers alike.
CREATE TABLE IF NOT EXISTS public.product_print_files (
  product_id  uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  bucket      text NOT NULL,
  front_path  text NOT NULL,
  back_path   text,
  source      text NOT NULL DEFAULT 'merch-studio',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_print_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_print_files FROM anon, authenticated;

COMMENT ON TABLE public.product_print_files IS
  'Private print-ready files (GCS bucket + object paths) for creator products. Service role only; never expose through PostgREST. See backend/services/print-files.ts.';

NOTIFY pgrst, 'reload schema';
