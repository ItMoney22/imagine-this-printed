# Jev product-kind dry run — 2026-10-12

Read-only. 2605 live products; Jev asked on the 2605 with words, answered 2605 (0 no answer after one retry). Cost $0.0998 for 2,377,005 input tokens, 109 s. Bar under test: 0.85. Task 28ab467c.

Jev reads only the product's WORDS (name, idea/prompt, description, keywords); the floor reads its FIELDS (category, product_type, garment, template). They are independent on purpose.

## Confidence bar

| bar | Jev at or over it | of those, agrees with the floor | confident disagreements | on-mode reviews |
|---|---|---|---|---|
| 0.6 | 2466 (94.7%) | 2423 (98.3%) | 43 | 43 |
| 0.7 | 2266 (87.0%) | 2232 (98.5%) | 34 | 34 |
| 0.75 | 2132 (81.8%) | 2099 (98.5%) | 33 | 33 |
| 0.8 | 1812 (69.6%) | 1781 (98.3%) | 31 | 31 |
| 0.85 | 1451 (55.7%) | 1422 (98.0%) | 29 | 29 |
| 0.9 | 998 (38.3%) | 973 (97.5%) | 25 | 25 |
| 0.95 | 517 (19.8%) | 497 (96.1%) | 20 | 21 |

## What decides each row with PRODUCT_KIND_JEV=on at the bar

| outcome | rows | on an Etsy listing |
|---|---|---|
| jev decides | 1399 | 57 |
| floor decides | 1152 | 0 |
| review (disagrees) | 29 | 6 |
| admin decides | 25 | 11 |

Shadow (the default) changes behaviour for 0 row(s): those with nothing at all saying what they are, which used to become shirts.

## Kinds: the old copy guess vs the floor vs Jev (confident)

| kind | old copy-repair guess | floor | Jev at 0.85 |
|---|---|---|---|
| hoodie | 24 | 24 | 23 |
| tee | 2483 | 2537 | 1361 |
| youth_tee | 0 | 0 | 2 |
| metal | 34 | 34 | 32 |
| transfer | 6 | 6 | 5 |
| 3d | 0 | 4 | 4 |
| tumbler | 0 | 0 | 2 |
| other | 58 | 0 | 22 |
| none | 0 | 0 | 0 |

## Floor kind × Jev choice (all answers)

| floor \ jev | hoodie | tee | youth_tee | metal | transfer | 3d | tumbler | other |
|---|---|---|---|---|---|---|---|---|
| hoodie | 23 | 1 |  |  |  |  |  |  |
| tee |  | 2469 | 7 | 2 | 3 |  | 3 | 53 |
| metal |  |  |  | 32 |  |  |  | 2 |
| transfer |  | 2 |  |  | 3 |  |  | 1 |
| 3d |  |  |  |  |  | 4 |  |  |

## Confident disagreements (Jev ≥ 0.85 vs the category/floor) — 31

Each of these goes to a human with PRODUCT_KIND_JEV=on. Listed-on-Etsy and active rows first.

| status | etsy | category | product_type | floor | Jev | old copy | old composer | name | id |
|---|---|---|---|---|---|---|---|---|---|
| rejected | primary:removed transfer:removed download:removed | shirts | polo | tee (conflict) | other 0.98 | tee | tee-copy | Embroidered Golf Dad Polo - Stylish Links & Tees Top | d75ff5ef |
| rejected | primary:removed transfer:removed download:removed | shirts | polo | tee (conflict) | other 0.97 | tee | tee-copy | Embroidered Red Apple Polo for Kids - School Uniform Shirt | 693f33aa |
| rejected | download:removed primary:removed transfer:removed | shirts | polo | tee (conflict) | other 1.00 | tee | tee-copy | Embroidered Golf Ball Polo - Classic Comfort for Dad | 1f61c0c0 |
| rejected | primary:removed transfer:removed download:removed | shirts | polo | tee (conflict) | other 0.98 | tee | tee-copy | Embroidered Apple Polo Shirt for Boys - Personalized Back to School Style | fc4fa7c1 |
| rejected | primary:removed transfer:removed download:removed | shirts | polo | tee (conflict) | other 0.99 | tee | tee-copy | Embroidered Golf Club Polo for the Best Dad | 4ef46492 |
| rejected | download:removed primary:removed transfer:removed | shirts | polo | tee (conflict) | other 1.00 | tee | tee-copy | Tuxedo Cat Polo Shirt - Elegant Feline Bow Tie Design | 4c4027e1 |
| draft | - | t-shirts | tshirt | tee | transfer 0.91 | tee | tee-copy | Vintage Cross & Dad Crest Badge (No Text) - Square DTF | e9abb92b |
| rejected | - | shirts | tshirt | tee | other 0.98 | tee | tee-copy | Humorous Golf Dad Polo - Embroidered Stick Figure Fail | 83e8cd90 |
| rejected | - | shirts | polo | tee (conflict) | other 0.99 | tee | tee-copy | Embroidered Golf Cup Polo - 'Best By Par' Dad Shirt | 166489e7 |
| rejected | - | shirts | polo | tee (conflict) | other 1.00 | tee | tee-copy | Embroidered Apple Polo for Teachers - Professional Educator Attire | 1f7305d0 |
| rejected | - | shirts | polo | tee (conflict) | other 0.97 | tee | tee-copy | Little Scholars Embroidered Apple Polo Shirt for Kids | 39c06b5a |
| rejected | - | shirts | polo | tee (conflict) | other 1.00 | tee | tee-copy | Embroidered Golf Dad Polo - Stylish & Understated | 9a533e86 |
| rejected | - | shirts | polo | tee (conflict) | other 0.97 | tee | tee-copy | Embroidered Apple Polo Shirt for School Days | daaf130e |
| rejected | - | shirts | polo | tee (conflict) | other 1.00 | tee | tee-copy | Golf Dad Polo: Embroidered 'Best Dad By Par' Shirt | 05c23590 |
| rejected | - | shirts | polo | tee (conflict) | other 1.00 | tee | tee-copy | The 'Dad-Vocate' Embroidered Polo: Speak Volumes, Dad-Style | 264cfbaa |
| draft | - | shirts | tshirt | tee | other 0.85 | tee | tee-copy | Let’s Get Basted Thanksgiving Retro Turkey Poster | 47fec69e |
| draft | - | t-shirts | tshirt | hoodie (conflict) | hoodie 1.00 | hoodie | tee-copy@hoodie-price | Design an oversized hoodie back graphic featuring a bold starburst at center wit | 3bb5ac84 |
| draft | - | t-shirts | tshirt | tee | transfer 1.00 | other | tee-copy | Create a DTF transfer with a retro badge shape containing a generic heart icon a | 2ba56b13 |
| draft | - | t-shirts | tshirt | hoodie (conflict) | hoodie 1.00 | hoodie | tee-copy@hoodie-price | Create an abstract Y2K aesthetic hoodie back design: a simple angel-inspired sil | dd498c7c |
| draft | - | t-shirts | tshirt | tee | tumbler 1.00 | other | tee-copy | Design a wraparound tumbler graphic featuring micro-typography blocks and a clea | 7c998c80 |
| draft | - | t-shirts | tshirt | tee | transfer 1.00 | other | tee-copy | Create a high-contrast DTF transfer artwork of a clean minimal badge: a generic | d19fd418 |
| rejected | - | shirts | - | tee | other 0.93 | tee | tee-copy | MERCH STUDIO E2E TEST — do not ship | a75cb324 |
| draft | - | shirts | - | tee | other 0.86 | tee | tee-copy | Best Mom Ever Badge | 19ba795a |
| draft | - | shirts | - | tee | other 0.97 | tee | tee-copy | Pumpkin Carols Invitation | 3ba8e05e |
| draft | - | shirts | - | tee | other 0.85 | tee | tee-copy | Cool Hat Graduation Vibes | 9c97f141 |
| draft | - | shirts | - | tee | other 0.94 | tee | tee-copy | Proud Retired Engineer Flag | f9cf7edb |
| draft | - | shirts | - | tee | tumbler 1.00 | tee | tee-copy | Death Before Decaf | c3dbc00c |
| draft | - | t-shirts | tshirt | tee | other 0.92 | other | tee-copy | A constellation map of imaginary creatures | 307d2c67 |
| draft | - | t-shirts | tshirt | tee | other 0.98 | other | tee-copy | A pair of headphones with cosmic energy emanating | 031db5fe |
| rejected | - | dtf-transfers | tshirt | transfer | tee 0.91 | transfer | tee-copy | Jungle Mischief: Monkeys & Gorilla Gathering | 21979f67 |
| rejected | - | dtf-transfers | tshirt | transfer | tee 0.86 | transfer | tee-copy | Dominic the Donkey - The Festive Friend | 3d5cf461 |

## Rows whose own fields disagree — 16

| status | category | signals | floor | Jev | name | id |
|---|---|---|---|---|---|---|
| rejected | shirts | category=tee, product_type=other | tee | other 0.99 | Embroidered Golf Cup Polo - 'Best By Par' Dad Shirt | 166489e7 |
| rejected | shirts | category=tee, product_type=other | tee | other 1.00 | Embroidered Apple Polo for Teachers - Professional Educator Attire | 1f7305d0 |
| rejected | shirts | category=tee, product_type=other | tee | other 0.97 | Little Scholars Embroidered Apple Polo Shirt for Kids | 39c06b5a |
| rejected | shirts | category=tee, product_type=other | tee | other 1.00 | Embroidered Golf Dad Polo - Stylish & Understated | 9a533e86 |
| rejected | shirts | category=tee, product_type=other | tee | other 0.97 | Embroidered Apple Polo Shirt for School Days | daaf130e |
| rejected | shirts | category=tee, product_type=other | tee | other 0.98 | Embroidered Golf Dad Polo - Stylish Links & Tees Top | d75ff5ef |
| rejected | shirts | category=tee, product_type=other | tee | other 0.97 | Embroidered Red Apple Polo for Kids - School Uniform Shirt | 693f33aa |
| rejected | shirts | category=tee, product_type=other | tee | other 1.00 | Golf Dad Polo: Embroidered 'Best Dad By Par' Shirt | 05c23590 |
| rejected | shirts | category=tee, product_type=other | tee | other 1.00 | Embroidered Golf Ball Polo - Classic Comfort for Dad | 1f61c0c0 |
| rejected | shirts | category=tee, product_type=other | tee | other 1.00 | The 'Dad-Vocate' Embroidered Polo: Speak Volumes, Dad-Style | 264cfbaa |
| rejected | shirts | category=tee, product_type=other | tee | other 0.98 | Embroidered Apple Polo Shirt for Boys - Personalized Back to School Style | fc4fa7c1 |
| rejected | shirts | category=tee, product_type=other | tee | other 0.99 | Embroidered Golf Club Polo for the Best Dad | 4ef46492 |
| rejected | shirts | category=tee, product_type=other | tee | other 1.00 | Tuxedo Cat Polo Shirt - Elegant Feline Bow Tie Design | 4c4027e1 |
| draft | shirts | category=tee, product_type=hoodie | tee | tee 1.00 | I CHART THEREFORE I AM / Nurse Nerd Humor Chart Graphic | b5f68900 |
| draft | t-shirts | category=tee, product_type=tee?, name=hoodie? | hoodie | hoodie 1.00 | Design an oversized hoodie back graphic featuring a bold starburst at center wit | 3bb5ac84 |
| draft | t-shirts | category=tee, product_type=tee?, name=hoodie? | hoodie | hoodie 1.00 | Create an abstract Y2K aesthetic hoodie back design: a simple angel-inspired sil | dd498c7c |

## Old composer wrote TEE copy for a non-tee — 34

The composer had two prompts, metal and tee; everything not metal-art got "soft unisex tee" copy.

| status | etsy | category | floor kind | Jev | name | id |
|---|---|---|---|---|---|---|
| draft | - | dtf-transfers | transfer | other 0.65 | We Build Character Animal Critter Checklist Sign | 4de08ec3 |
| active | - | hoodies | hoodie | tee 0.55 | Midnight Misfits Moon Portrait (Distressed Monochrome) | 5651547f |
| active | - | 3d-prints | 3d | 3d 0.95 | Gothic Ghost Face Candle Holder | 43d607e5 |
| active | - | hoodies | hoodie | hoodie 1.00 | Unleashed Power Athlete Hoodie / Dynamic Sports Graphic | 56d895e7 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Ancient Gaze Distressed Eye Hoodie for Grunge Style | c549b549 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Ocean Bell Buoy Hoodie - Coastal Comfort & Style | b5c94cac |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Mischievous Goose Embroidered Hoodie - Funny Bird Apparel | a1120d6e |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Retro Mom Vibes Hoodie - Cozy Distressed 90s Style | 2e1997f8 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Mystic Luna Moth Engraving Style Hoodie, Dark Academia | 62fff96b |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Silly Goose Embroidered Hoodie - Playful Streetwear | fd90e6e0 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Meowdy Partner Cat Hoodie - Whimsical Cowboy Feline | 158ad549 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Luna Moth Emblem Hoodie, Mystical Creature Pullover | c5253ed8 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Mischievous Goose Embroidered Heavy Blend Hoodie | 35c9d44a |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Cloud Aesthetic Pullover Hoodie - Soft & Dreamy Comfort | dd2c3e0d |
| active | - | hoodies | hoodie | hoodie 1.00 | Grumpy Cat Cowboy Hat Hoodie - Funny Feline Friend | 868b54ed |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Retro Seals Stack Hoodie - Vintage Animal Lover Gift | b11bb1ae |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Mischievous Goose Waddle Cartoon Hoodie for Teens | e98cf729 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Cat Wearing Cowboy Hat Funny Biscuit Humor Hoodie | 1d5e16d1 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Celestial Luna Moth Linocut Hoodie - Dark Academia Style | db31cb03 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Mischievous Goose Party Pal Whimsical Hoodie | ccea2246 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Mystical Luna Moth Woodcut Style Hoodie for Nature Lovers | 0f003f0f |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Neon Spider Y2K Gothic Hoodie - Luminous Web Streetwear | 2c66eb26 |
| rejected | - | hoodies | hoodie | hoodie 1.00 | Mischievous Goose Embroidered Hoodie - Funny Bird | ef1a7e2f |
| active | - | 3d-prints | 3d | 3d 1.00 | Shadow Raptor Toy Charm | 19d0d6a4 |
| active | - | 3d-prints | 3d | 3d 1.00 | Toy: Robo Rascal | 5eac6a81 |
| active | - | 3d-prints | 3d | 3d 1.00 | Toy: The Wizard Beast | bb5cfb7c |
| draft | - | t-shirts | hoodie | hoodie 1.00 | Design an oversized hoodie back graphic featuring a bold starburst at center wit | 3bb5ac84 |
| draft | - | t-shirts | hoodie | hoodie 1.00 | Create an abstract Y2K aesthetic hoodie back design: a simple angel-inspired sil | dd498c7c |
| active | - | dtf-transfers | transfer | transfer 1.00 | Customizable School Icon Design Template | d467c2b6 |
| active | - | dtf-transfers | transfer | transfer 0.99 | Patriotic Heartbeat DTF | ed566166 |
| draft | - | hoodies | hoodie | hoodie 1.00 | America's 250th Anniversary Hoodie | 7551e1ee |
| rejected | - | dtf-transfers | transfer | tee 0.91 | Jungle Mischief: Monkeys & Gorilla Gathering | 21979f67 |
| rejected | - | dtf-transfers | transfer | transfer 0.75 | Retro Synthwave Sunset Tee Design | aebf7a33 |
| rejected | - | dtf-transfers | transfer | tee 0.86 | Dominic the Donkey - The Festive Friend | 3d5cf461 |

## Nothing says what it is — 0

These were silently filed as shirts before. Now they go to a human (or, with Jev on and sure, to Jev's kind).


## Unsure on an ambiguous row — 0


## Jev confidence spread (all answers)

| confidence | rows | agrees with floor |
|---|---|---|
| 0–0.5 | 56 | 73.2% |
| 0.5–0.6 | 83 | 89.2% |
| 0.6–0.7 | 200 | 95.5% |
| 0.7–0.8 | 454 | 99.3% |
| 0.8–0.85 | 361 | 99.4% |
| 0.85–0.9 | 453 | 99.1% |
| 0.9–0.95 | 481 | 99.0% |
| 0.95–1 | 517 | 96.1% |

Taxonomy note: a youth tee files under shirts (482) like the adult tee; `other` has no category (null), so an `other` row can only list after a human files it.

## Decision: the bar is 0.85 (dr-dill, 2026-10-12)

Agreement with the floor is 99% in every confidence bucket from 0.7 up, so the bar mostly decides how many
CONTRADICTIONS surface for a human with `PRODUCT_KIND_JEV=on`. Hand-labelled, the 29 reviews at 0.85 are:

- **21 real misroutes** — 13 embroidered polos filed under `shirts` (ITP's capability boundary does not sell
  polos; they would have listed under Etsy's T-shirts node), 2 "hoodie back design" prompts filed under
  `t-shirts`, 2 "DTF transfer" prompts and 1 "wraparound tumbler graphic" filed under `t-shirts`, 2 tee designs
  filed under `dtf-transfers` (Jungle Mischief, Dominic the Donkey — the "shirts landing as dtf-transfers"
  bug), and 1 E2E test row.
- **8 false alarms** — design names that read as other items (a "Poster", a "Badge", an "Invitation", a "Hat",
  a "Flag", "Death Before Decaf" → tumbler, two prompt-style art descriptions).

At 0.95 the false alarms drop to 3 but 2 real misroutes (0.86, 0.91) slip through. A false alarm costs one
glance at a draft; a missed misroute lists under the wrong Etsy category with the wrong copy. 0.85 it is
(`PRODUCT_KIND_MIN_CONFIDENCE`, env override `PRODUCT_KIND_JEV_MIN_CONFIDENCE`), the same tier the
jev-decisions skill gives "skipping a safety check".

Admin precedence on live rows: 25 rows carry an admin pick (Step Flow garment / metal brief); on 2 of them Jev
confidently disagreed (e9abb92b, 83e8cd90) and the admin's pick stood, unasked.

Shadow (the default) changes 0 live rows. Full per-row data: E:/memory/watchtower/projects/imagine-this-printed/
2026-10-12-28ab467c-product-kind/jev-product-kind-dryrun-2026-10-12.json (2.9 MB, kept out of git).
