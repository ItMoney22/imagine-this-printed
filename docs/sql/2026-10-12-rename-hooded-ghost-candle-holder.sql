-- Rename the candle holder away from Fun World's GHOST FACE mark (task d434dd6c).
-- Apply ONLY after David picks option A or B on the APPROVE card. Idempotent,
-- and order-independent from 20261009120000_listing_honesty_fixes.sql (that
-- migration never touches name, meta_title, the Etsy title/tags or captions).
-- Undo: docs/decisions/2026-10-12-ghostface-candle-holder/undo.json.
UPDATE products
   SET name = 'Gothic Hooded Ghost Candle Holder',
       meta_title = 'Gothic Hooded Ghost Candle Holder | 3D Printed Home Decor',
       description = regexp_replace(
                       replace(replace(description,
                         'an ivory, scream-inspired ghost mask', 'an ivory ghost mask'),
                         'scream-inspired ', ''),
                       'ghost[ -]?face', 'Hooded Ghost', 'gi'),
       meta_description = regexp_replace(meta_description, 'ghost[ -]?face', 'Hooded Ghost', 'gi'),
       search_keywords = regexp_replace(search_keywords, 'ghost[ -]?face', 'hooded ghost', 'gi'),
       metadata = regexp_replace(
                    replace(replace(replace(replace(metadata::text,
                      'an ivory, scream-inspired ghost mask', 'an ivory ghost mask'),
                      'Ivory scream-inspired mask', 'Ivory mask'),
                      'scream-inspired ', ''),
                      '"ghost face decor"', '"hooded ghost decor"'),
                    'ghost[ -]?face', 'Hooded Ghost', 'gi')::jsonb,
       updated_at = now()
 WHERE id = '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3';

-- The unposted TikTok draft for this product carries the old caption and
-- listing copy. Posted rows are history and are left alone.
UPDATE social_outbox
   SET caption = regexp_replace(caption, 'ghost[ -]?face', 'Hooded Ghost', 'gi'),
       listing = regexp_replace(
                   replace(replace(listing::text,
                     'an ivory, scream-inspired ghost mask', 'an ivory ghost mask'),
                     'scream-inspired ', ''),
                   'ghost[ -]?face', 'Hooded Ghost', 'gi')::jsonb,
       updated_at = now()
 WHERE product_id = '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3'
   AND status = 'draft'
   AND posted_at IS NULL;
