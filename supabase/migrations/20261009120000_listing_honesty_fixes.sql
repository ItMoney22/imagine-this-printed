-- Listing honesty fixes (Watchtower task 389defc8, found on the 2026-10-07 live walk).
-- Data only, idempotent: every statement can run twice and leaves the same rows.
-- Code that reads these fields ships in the same branch (src/lib/product-kind.ts
-- notIncludedNote / HOME_DECOR_CATEGORY, ProductPage, ProductCard, ProductCatalog).
--
-- Undo notes: the previous values of every column touched here are in
-- memory/watchtower/projects/imagine-this-printed/2026-10-09-listing-honesty-undo.json.

-- 1. Gothic Ghost Face Candle Holder (43d607e5, the only product that sold twice).
--    - The photo shows a "Haunted Nights" candle on the tray: say "Candle not
--      included" (metadata.not_included drives the note under the photo, in
--      Details and on the catalog card).
--    - Out of 3D Prints / "Meet the toys" into Home Decor.
--    - print3d.enabled keeps the order going to the printer fleet: print-bridge
--      routes on category '3d-prints' OR metadata.print3d.enabled, and this row
--      is leaving '3d-prints'. magnet_sockets 0 because it has no magnets
--      (print-bridge would otherwise default it to 2).
--    - "scream-inspired" (trademark risk) removed from every text field.
UPDATE products
   SET category = 'home-decor',
       description = $d$A gothic ghost in flowing black hooded robes, with an ivory mask and deep sculpted folds, holding a raised tray on top for your candle. A bold, darkly elegant piece for a shelf, mantel or desk.

Candle not included: the candle in the photo is for display only.

3D printed to order in our Rockmart, Georgia shop. Wipe clean with a soft, dry cloth, and never leave a lit candle unattended.$d$,
       meta_description = 'Gothic hooded ghost candle holder, 3D printed in black and ivory with a raised candle tray. Candle not included.',
       search_keywords = 'gothic ghost candle holder, halloween candle holder, gothic home decor, spooky candle stand, black and ivory gothic decor, raised candle tray holder, hooded ghost sculpture, 3d printed candle holder',
       metadata = jsonb_set(
                    jsonb_set(
                      replace(replace(replace(metadata::text,
                        'an ivory, scream-inspired ghost mask', 'an ivory ghost mask'),
                        'Ivory scream-inspired mask', 'Ivory mask'),
                        'scream-inspired ', '')::jsonb,
                      '{not_included}', '["Candle"]'::jsonb),
                    '{print3d}',
                    COALESCE(metadata->'print3d', '{}'::jsonb) || '{"enabled": true, "magnet_sockets": 0}'::jsonb),
       updated_at = now()
 WHERE id = '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3';

-- Etsy copy carries the note too (the Etsy listing itself is updated separately).
UPDATE products
   SET metadata = jsonb_set(metadata, '{etsy_pack,description}',
         to_jsonb((metadata->'etsy_pack'->>'description') || E'\n\nCandle not included: the candle in the photos is for display only.'))
 WHERE id = '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3'
   AND metadata->'etsy_pack'->>'description' IS NOT NULL
   AND metadata->'etsy_pack'->>'description' NOT LIKE '%Candle not included%';

-- 2. $8.95 metal prints sold as clocks. They are aluminium prints with no
--    movement or hands, so they are renamed and described as what ships
--    (decision: rename, not a clock-works kit). Both rows are drafts today;
--    fixed anyway so they cannot go live with the claim. Slugs are left alone
--    so existing links keep working.
UPDATE products
   SET name = 'Rustic Forest & Stag Metal Wall Art Print',
       meta_title = 'Rustic Forest & Stag Metal Wall Art Print',
       description = $d$A rustic wilderness scene on aluminium: towering pine silhouettes and a stag below, a flock of birds above, and a ring of Roman numerals worked into the branches.

This is a flat metal art print. It is not a working clock and has no clock movement or hands.

Dye-sublimated onto a glossy aluminium panel for vivid, fade- and scratch-resistant colour. Arrives with a hanger, ready for the wall, and is light enough for a shelf or easel. Made to order in Rockmart, Georgia.$d$,
       meta_description = 'Rustic forest and stag metal wall art print with Roman numeral detail. A flat aluminium print, not a working clock. Ready to hang.',
       search_keywords = 'rustic forest metal wall art, stag metal print, pine tree wall art, farmhouse cabin wall decor, roman numeral wall art, aluminium metal print, lodge style wall art, nature lover home decor',
       metadata = jsonb_set(
                    jsonb_set(metadata, '{marketing_hooks,captions}',
                      '["Rustic forest vibes with a stag metal art print 🦌", "Pine silhouettes and a stag on glossy aluminium for cabin and farmhouse walls", "Bring the outdoors in with a ready-to-hang forest metal print"]'::jsonb),
                    '{marketing_hooks,hashtags}',
                    '["#metalart", "#metalwallart", "#rusticdecor", "#farmhousedecor", "#cabinstyle", "#lodgevibes", "#stagdecor", "#natureinspired", "#homedecor", "#giftideas"]'::jsonb),
       updated_at = now()
 WHERE id = 'e456639a-52c7-4daf-b71a-1b7b2ef8ae6a'
   AND metadata ? 'marketing_hooks';

UPDATE products
   SET description = $d$A dense pine forest in silhouette on aluminium, with a large Roman numeral dial worked into the trees in an antique bronze look.

This is a flat metal art print. The dial is part of the artwork: it is not a working clock and has no clock movement or hands.

Dye-sublimated onto a glossy aluminium panel for vivid, fade- and scratch-resistant colour. Arrives with a hanger, ready for the wall, and is light enough for a shelf or easel. Made to order in Rockmart, Georgia.$d$,
       meta_description = 'Antique bronze forest metal wall art print with a Roman numeral dial design. A flat aluminium print, not a working clock.',
       search_keywords = 'roman numeral wall art, forest metal wall decor, pine tree wall art metal, antique bronze wall art, rustic farmhouse metal decor, timeless nature wall art, woodland wall decor, aluminium metal print',
       metadata = jsonb_set(
                    jsonb_set(
                      jsonb_set(metadata, '{etsy_pack,description}',
                        to_jsonb(replace(metadata->'etsy_pack'->>'description',
                          'with an elegant Roman numeral clock into your home',
                          'with an elegant Roman numeral dial design into your home')
                          || E'\n\nThis is a flat metal art print. It is not a working clock and has no clock movement or hands.')),
                      '{marketing_hooks,captions,1}', '"Antique bronze detail + Roman numerals = instant charm"'::jsonb),
                    '{marketing_hooks,hashtags}',
                    '["#metalwallart", "#romannumerals", "#forestdecor", "#pineart", "#rusticdecor", "#farmhousedecor", "#woodlandstyle", "#antiquebronze", "#homedecor"]'::jsonb),
       updated_at = now()
 WHERE id = '13a5adb4-b879-4009-9fff-a7bc16205309'
   AND metadata ? 'marketing_hooks'
   AND metadata->'etsy_pack'->>'description' NOT LIKE '%not a working clock%';

-- Same honesty line on the stag print's Etsy copy (its Etsy title already says "Metal Print").
UPDATE products
   SET metadata = jsonb_set(metadata, '{etsy_pack,description}',
         to_jsonb((metadata->'etsy_pack'->>'description') || E'\n\nThis is a flat metal art print. It is not a working clock and has no clock movement or hands.'))
 WHERE id = 'e456639a-52c7-4daf-b71a-1b7b2ef8ae6a'
   AND metadata->'etsy_pack'->>'description' IS NOT NULL
   AND metadata->'etsy_pack'->>'description' NOT LIKE '%not a working clock%';

-- 3. Customizable School Icon Design Template (d467c2b6): the photos showed the
--    bare "Student Name / Class" placeholder. Lead with a filled-in example
--    (public/products/examples/, same art with a sample name) and say how the
--    shopper gives us their own name and class.
UPDATE products
   SET images = ARRAY['https://www.imaginethisprinted.com/products/examples/school-icon-example-ava-martinez.png'],
       description = $d$A ready-to-press DTF transfer with your student's name in bold, friendly letters and their class underneath, framed by pencils, books, rulers and an apple. Shown here as "Ava Martinez, Mrs. Lee's 2nd Grade".

After you order, email wecare@imaginethisprinted.com with your order number and the name and class to print. We print your transfer once we have them.

This is the transfer only; no shirt is included.$d$,
       meta_description = 'Custom name school DTF transfer: your student''s name and class framed by pencils, books and an apple. Ready to press.',
       updated_at = now()
 WHERE id = 'd467c2b6-07ee-4856-8c24-fb7624f97a3d';

-- 4. Magnet figures: no data change. ProductPage shows "Ages 14+" and the
--    magnet warning for any 3D listing with print3d.magnet_sockets > 0 or the
--    toy_magnet_pair add-on (src/lib/product-kind.ts hasMagnets).
--
-- 5. DTF category: the $25 lion tee is no longer in it (the 2026-10-07 catalog
--    trim left 2 active DTF rows, both real transfers). Guard so a shirt can
--    never sit in the DTF tab again by accident: an active row named as a
--    tee/shirt in dtf-transfers moves to shirts only when it has a print
--    location (products_print_locations_valid requires one for shirts).
UPDATE products
   SET category = 'shirts', updated_at = now()
 WHERE category = 'dtf-transfers'
   AND status = 'active'
   AND (name ~* '\m(tee|t-shirt|shirt)\M')
   AND name !~* '\mtransfer\M'
   AND COALESCE(array_length(print_locations, 1), 0) >= 1;
