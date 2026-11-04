-- Task 4c100f9f (2026-11-04): print-ready/ asset rows leave the public read and
-- the public gallery.
--
-- A print-ready/ file is a design at full press size with no watermark. It now
-- lives in the private bucket, and its product_assets row keeps a signed link,
-- because about twenty readers (Step Flow, the worker, Etsy, the order floor)
-- use that column as a plain URL. That is only safe if the public cannot read
-- the row, and the row must not be copied into products.images:
--
--   1. "Public can read published assets" let anyone read every asset row of an
--      active product, so the row handed out the link. It now skips print-ready/
--      rows. Admins (their own policy) and the service role still read them.
--   2. auto_sync_product_images rebuilds products.images from every 'mockup' and
--      'source' row on any asset write, which is how the Folgers tee's press
--      file became a thumbnail. It now skips print-ready/ rows.
--
-- Every other row reads and syncs exactly as before.
--
-- 83a2ab40 has a wider sync_product_images rewrite in draft. It also skips
-- print-ready/ urls, so it can land after this one; do not re-apply this file
-- after that one, or its Step Flow guard is lost.
--
-- Rollback: restore the two bodies below.
--   create or replace function public.sync_product_images(p_product_id uuid)
--   returns void language plpgsql as $function$
--   BEGIN
--     UPDATE products
--     SET images = (
--       SELECT COALESCE(array_agg(url ORDER BY created_at), ARRAY[]::text[])
--       FROM product_assets
--       WHERE product_id = p_product_id
--         AND kind IN ('mockup', 'source')
--         AND url IS NOT NULL
--     )
--     WHERE id = p_product_id;
--   END;
--   $function$;
--   drop policy "Public can read published assets" on public.product_assets;
--   create policy "Public can read published assets" on public.product_assets
--     for select using (exists (select 1 from products
--       where products.id = product_assets.product_id and products.status = 'active'));

create or replace function public.sync_product_images(p_product_id uuid)
returns void
language plpgsql
as $function$
begin
  update products
  set images = (
    select coalesce(array_agg(url order by created_at), array[]::text[])
    from product_assets
    where product_id = p_product_id
      and kind in ('mockup', 'source')
      and url is not null
      and coalesce(path, '') not like 'print-ready/%'
  )
  where id = p_product_id;
end;
$function$;

drop policy if exists "Public can read published assets" on public.product_assets;

create policy "Public can read published assets" on public.product_assets
  for select
  using (
    coalesce(path, '') not like 'print-ready/%'
    and exists (
      select 1 from products
      where products.id = product_assets.product_id
        and products.status = 'active'
    )
  );
