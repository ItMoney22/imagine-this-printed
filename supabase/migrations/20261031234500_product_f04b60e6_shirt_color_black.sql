-- Cowboy vs. Alien Showdown Tee (f04b60e6) gets its garment colour on record.
--
-- Watchtower task 32d53c6f, found by the product-feed spec check (task
-- 1df2f0be). The row has colors = {} and no metadata.shirt_color, so every one
-- of its feed items in /feeds/products.xml goes out with no g:color, and Google
-- disapproves apparel with no colour in the US. The listing has no colour
-- picker; the shirt it was made on is black: its hero image is
-- mockups/cowboy-vs-alien-showdown-tee/composite/cowboy-vs-alien-showdown-tee-black-1791822263209.png.
--
-- Only metadata.shirt_color is set. colors stays {} on purpose: with no colour
-- list, the feed (backend/services/product-feed.ts) and the product page
-- (src/pages/ProductPage.tsx) both read shirt_color as the one garment colour,
-- so the buy box preselects Black and the feed's item ids stay the same.
-- Writing colors would switch the product page to its colour-list path instead.
--
-- One row, by full id. Every other metadata key is kept (jsonb ||). Idempotent
-- and never overrides a colour already recorded: the WHERE skips a row that
-- has any shirt_color, so a re-run (or a later db push) changes nothing.
--
-- Rollback:
--   update public.products set metadata = metadata - 'shirt_color'
--   where id = 'f04b60e6-f89a-45f2-ae2b-2457a89d4ddb';

update public.products
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('shirt_color', 'black'),
    updated_at = now()
where id = 'f04b60e6-f89a-45f2-ae2b-2457a89d4ddb'
  and coalesce(metadata->>'shirt_color', '') = '';
