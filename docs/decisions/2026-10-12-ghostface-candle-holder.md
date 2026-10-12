# Ghostface candle holder: keep, rename or remodel (task d434dd6c)

**Date:** 2026-10-12 · **Author:** Daisy Carter · **Status:** waiting on David, APPROVE card `a58ec168-3be1-482e-965e-adfd248656c0` (my pick: **A**)
**Not legal advice.** These are facts, read live today, plus a business call.

## What we sell (prod, read 2026-10-12)

- Product `43d607e5-e8e1-4b57-a52f-110a5cd6a1c3`, **Gothic Ghost Face Candle Holder**, $20, `status=active`, `is_featured=true`. It is row 1 on the storefront.
- Sales: 2 paid, delivered orders, 3 units, $57.93 gross (ITP-MTRQH7VJ-2UO1 9/7, ITP-MTYGMM4V-UQ5X 9/12). That is 2 of ITP's 3 paid orders ever.
- Photos: 3 AI renders (`products/VEVnXe5Z1V.png`, `5FSWetHam_.png`, `68prvFN-dx.png`). All three show the Scream Ghostface mask, unchanged, inside a black hooded shroud. No photo carries the product name as text.
- Text still says "Ghost Face" in: name, meta_title, meta_description, search_keywords, etsy_pack title/description/tags (`ghost face decor`), marketing caption. "scream-inspired" is still live in description, etsy_pack and a caption: the 389defc8 fix is not merged yet (card c831ae55).
- One unposted TikTok draft in `social_outbox` (`ac5d5c7c`) uses the old caption and listing copy.
- **Etsy: not listed.** Shop 67055923 via API today: 14 active, 6 draft, 0 inactive, 0 expired, none matching candle/ghost face/scream. `etsy_listings` has no row for the product. Sifu's audit for 20fa3375 (commit e2ec5e6) found the same.
- History: on 2026-09-01 a customer sent David a photo of a Ghostface-style candle holder. Nine's design that day (`docs/plans/2026-09-01-photo-to-printable-pipeline-design.md` §7) already said the protected part is the face, not the hooded form, and proved an original blank-faced "wraith" version on branch `earth/zero-nine/candle-cradle` (unmerged). The product added on 9/6 went with the Ghostface face instead.

## The exposure (researched 2026-10-12)

1. **Copyright.** Easter Unlimited (Fun World) holds US registration **VA 552-798**. The supplementary registration (1999) titles the work **"Ghost Face Mask with Shroud"**; first published 1991, registered 1993. Our sculpt is that work: the mask in a black hooded shroud. Registration before our use means statutory damages and attorney fees are available, and now that we know, continued sales are knowing (willful). Source: the court's opinion in *Easter Unlimited, Inc. v. Rozier*, 18-cv-06637 (E.D.N.Y. Sept. 27, 2021), Doc. 60, pp. 20-21.
2. **Trademark.** Fun World owns GHOST FACE marks: Reg. 4,256,208 (ghost design + "Ghost Face" wording, cited in the same opinion) and GHOST FACE filings for figurines, decorations and plastic goods (serial 85077247 class 20; 99458405 class 28, status update 2025-10-23; per Justia, not checked on USPTO directly). Our product name uses the exact words.
3. **They litigate.** *Rozier*: Fun World sued an NBA player over "Scary Terry" merch. He won summary judgment only because his use was parody and satire (transformative). A decor piece that reproduces the mask comments on nothing, so that defence does not fit us. Commentators called the ruling an overreach; no appeal was found as of 2024.
4. **Etsy.** Etsy removes a listing on an IP notice and can end selling privileges for repeat notices (Etsy IP policy, House Rules article 482). Its 2019 transparency report counted 13,906 shops closed for repeat infringement. For us that means Christina's whole shop, not one listing. Our Etsy copyright gate (`backend/services/etsy-copyright-gate.ts`) has no Ghostface, Scream or Fun World terms, and it reads text only, so it cannot catch a renamed copy. The Jev IP gate (1371269b) is shadow-only and text-based too.

I found no public report of Fun World sending Etsy takedowns over 3D-printed fan pieces. Unverified either way.

## The options

| | Option | Name risk | Copyright risk | Sales | Cost |
|---|---|---|---|---|---|
| **A** | Rename now + remodel the face; sell on the site only until the new one replaces it | gone today | shrinks to ~1-2 weeks, then gone | keeps Halloween sales | ~$1 generation + one test print (estimate) |
| B | Rename only | gone today | **stays as long as it sells** | keeps sales | $0 |
| C | Pull today, remodel, relaunch under the new name | gone today | gone today | none until the remodel lands | same as A |
| D | Keep as is (David signs) | stays | stays, and is now knowing | keeps sales | $0 |

**My pick: A.** The money on the table is small both ways (3 units in 5 weeks), so the deciding factor is the worst case: a claim that reaches Etsy takes down the whole shop. A removes the name echo today and the copied face within days, and keeps the one product that sells live through Halloween. If David wants zero exposure from today, C costs only the next 1-2 weeks of this product. B is half a fix: the shape is the copyrighted part, so a rename alone does not remove the main risk.

Whatever the pick, **the current sculpt never goes on Etsy.**

## What happens on each pick

- **A:** apply `docs/sql/2026-10-12-rename-hooded-ghost-candle-holder.sql` to prod, re-read the row and the storefront, then file the remodel card below.
- **B:** apply the same SQL; nothing else.
- **C:** apply the same SQL, set `status='draft', is_active=false` on 43d607e5 (reversible), file the remodel card. Relaunch flips it back with the new photos.
- **D:** no change. Record "David accepted the risk on <date>" in the handoff and on this file; keep it off Etsy.

Rename = text only. The photos carry no name text, so they change only under A or C (remodel).

## The rename SQL (ready, NOT applied)

`docs/sql/2026-10-12-rename-hooded-ghost-candle-holder.sql`. Proven on live prod on 2026-10-12 inside transactions that were rolled back:

- after: 0 "Ghost Face"/"scream" hits on the product row and the unposted draft (before: hits in 6 product fields + the draft);
- name `Gothic Hooded Ghost Candle Holder`, Etsy title `Gothic Hooded Ghost Candle Holder | Spooky Home Decor`, tag `hooded ghost decor`;
- idempotent (twice = once), and gives the same result run before or after the pending 389defc8 migration `20261009120000_listing_honesty_fixes.sql` (that migration never touches name, meta_title, Etsy title/tags or captions);
- live row unchanged after rollback.

Undo values: `docs/decisions/2026-10-12-ghostface-candle-holder-undo.json`. Left alone on purpose: past orders, order lines and sent emails (history, not storefront copy).

## Remodel card (file on A or C)

POST `/api/tasks/internal`, project `imagine-this-printed`, `metadata.follow_up_of = d434dd6c-3ce1-406b-ace4-138a7f2f6862`, `earns_or_saves: "David ask (APPROVE a58ec168): removes the Ghostface copyright risk from ITP's only repeat seller"`.

> **ITP: remodel the hooded ghost candle holder with an original face + new photos**
> The live candle holder 43d607e5 copies Fun World's "Ghost Face Mask with Shroud" (VA 552-798). Keep the hooded robe, raised arms and tray (not protected); replace the mask with an original face (smooth blank ivory face with hollow eye voids, no Ghostface features: no long drooping mouth, no teardrop eyes). Path, no manual sculpt: the print-factory interpretation route proven 2026-09-01 on `earth/zero-nine/candle-cradle` (reference image -> image-to-3D shell -> Blender voxel remesh + union with the `candle_cradle` fixture -> STL). Match today's size (6 in wide x 7 in tall, tray for a 3-wick jar); the 9/1 wraith came out 513 g at 254x168x148 mm, too heavy for a $20 piece, so hollow it and report grams and print hours. Then: one test print on an A1, new product photos (no Scream look-alike anywhere, candle not included note kept), swap images on 43d607e5, re-check the product page at 390 and 1400. Only after that may it go on Etsy. Backstory: docs/decisions/2026-10-12-ghostface-candle-holder.md.

## Open questions

- Which file printed the 3 sold units? If it came from MakerWorld or similar, most of those licences are non-commercial, which is a second, separate problem the remodel also fixes. Unknown (guess, not checked).
