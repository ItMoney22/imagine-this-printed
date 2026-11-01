# Saturn's 5 print picks on Etsy: drafts, prices, publish plan (task 77a4756c)

2026-11-01, dane-marsh. David 2026-11-01 8:05 AM ET: "okay forget the makerworld boost lets just focus on etsy selling
make more $$ that way and offering it to our clients for them to sell." No MakerWorld work was done.

Five **private drafts** on ImagineThisPrinted1 (shop 67055923). Nothing is published, and there are no images on
purpose: real photos of the test print only, never renders. Kit (idempotent scripts, Etsy logs, read-backs):
`E:/memory/watchtower/projects/imagine-this-printed/2026-11-01-77a4756c-print-picks-etsy/`
(`listings.cjs` is the copy, `drafts-apply.cjs` made the drafts, `verify.cjs` reads them back).

## The drafts (read back from Etsy 2026-11-01)

| # | Product | Etsy draft | Taxonomy | Required name question (text, max chars) |
|---|---|---|---|---|
| 1 | Family name shadow ornament | 4607531972 | 1857 Ornaments | "Family name to print", 18 |
| 2 | Name clicker keychain | 4607511235 | 165 Keychains | "Name to print (3 to 6 letters)", 6 |
| 3 | Dinosaur name ornament | 4607511249 | 1857 Ornaments | "Name to print", 8 |
| 4 | Team hoodie pen holder | 4607511267 | 1101 Office & Desk Storage | "Name, number and team colours", 40 |
| 5 | Teacher marker holder | 4607532022 | 1101 Office & Desk Storage | "Teacher name to print", 16 |

All five: physical, who_made i_did, made to order, 3-5 day processing, PLA, 13 tags, quantity 10, shipping profile
"ITP Standard US" ($5 first item, $2 each extra), personalization through Etsy's personalization endpoint
(`POST /v3/application/shops/{shop}/listings/{id}/personalization`, one required `text_input` question; the old
`personalization_*` listing fields are gone). None of the three taxonomies has a required attribute (checked).

Copy rules the validator enforced: no child words in titles or tags (an ornament marked "kids" becomes a CPSIA
children's product), no brand names (Expo, Gateron, Bambu), no tool or model names, an AI-assisted design line, honest
"good to know" lines (layer lines, heat, small parts, magnets, the dino's green band under the hat).

## Proposed prices (PENDING David's approval, APPROVE card in the handoff)

| Product | Etsy comp | Proposed | One sale keeps (est.) | At the comp price |
|---|---|---|---|---|
| Shadow ornament | $17.95 (475 reviews) | **$15.99** | about $12.30 | $14.07 |
| Name clicker | $8.50 (2.8k) | **$9.99** | about $4.63 | $3.28 |
| Dino ornament | $6.59 (1.3k) | **$7.99** | about $4.54 | $3.27 |
| Hoodie pen holder | $19.99 (582) | **$18.99** | about $10.65 | $11.56 |
| Teacher marker holder | $9.35 (9.3k) | **$24.99** | about $6.67 | **-$7.49 (a loss)** |

"Keeps" = price + $5 shipping charged, minus Etsy fees ($0.20 listing, 6.5% transaction, 3% + $0.25 processing,
on item + shipping; third-party 2026 guides, Etsy's own page not read), plastic + power + 10% waste and parts (the
472ad512 numbers), printer time at $1.50 an hour, and postage + packing (GUESSES: $4.10-$5.20 + $0.40-$0.90). Our
labour is not in it: it is what we keep. A sale brought by Offsite Ads costs another 15% (about $2-4.50).

Why: new shop, 0 reviews and 0 sales, so a couple of dollars under the leaders where we have room (shadow, hoodie).
The clicker and dino comps barely cover printer time, so a dollar or so over. **No to the marker holder at $9.35**:
four 20 x 3 mm magnets ($5.40 at $1.35 each) plus 4.2 printer hours lose about $7.50 a sale. $24.99 keeps about
$6.67 but only $1.58 per printer hour, the worst of the five. Cheaper magnets in bulk (a guess, about $0.40 each)
would add about $3.80 a sale. Recommendation: list it at $24.99 or hold it until a cheaper magnet buy.

## Publish plan: one listing goes live only when ALL of these are true

1. **David's price yes** for that listing, recorded on the APPROVE card. Set the approved price on the draft.
2. **Its test print is proven** (card 6345ec5e): it printed from its `<slug>-PRINT.3mf`, the fit parts pass
   (clicker: fit plate 4 with David's 50 Zivlok switches, arriving 11/2; marker holder: an Expo marker in the
   fit-test bores, then `--marker-d` if needed and the copy's "full-size dry erase markers" line re-read).
3. **Real photos** of that print: at least 3 (front, in use, a size shot; the shadow ornament's wall shadow; the
   clicker in a hand). Upload with `POST /application/shops/67055923/listings/{id}/images`, rank 1 first, and never
   `overwrite=true` on a rank that already holds an image (it deletes it). Never a render.
4. **A per-order file path that prints right**: the new-name scripts (`make_*.py`) slice through `lib/itp_slice.py`,
   which sets no bed type, so a fresh name slices on Bambu's default Cool Plate (35 C bed) and the first layer lifts
   on our PEI plates. Re-run `lib/print_check.py` on each new name, or fix `itp_slice.py` first (follow-up card).
5. Then `PATCH /application/shops/67055923/listings/{id}` with `state=active` (that is when Etsy charges the $0.20),
   read it back, and tell Christina it is live (she runs the shop day to day).

Order to expect: shadow ornament and dino ornament first (no bought parts, one plate), then the hoodie (glue step),
then the clicker (switches 11/2), then the marker holder (marker size + magnet price). ITP's Christmas order-by for
3D items is Dec 8 (set 10/28 against USPS Ground Advantage's Dec 17), so a listing that is not live by about Nov 20
misses most of the season.

## Measuring it

For each listing, at +14 and +30 days after it goes live: views, favourites, orders and revenue
(`GET /application/listings/{id}` for views and num_favorers; receipts with `transactions_r` for orders). Filed as a
board card (in the handoff) so it runs on a date, not on someone's memory.

## Client stores (channel 2)

The same five are in the client-store catalog in david-trinidad-com, `src/lib/business-items/catalog.ts`
`STORE_PRODUCTS`, with their client prices read from the quantity-break table (pricing.ts, task 472ad512).
That table is not approved yet, so the prices there are placeholders and every product is held off client stores until
David approves it and its test print is photographed.
