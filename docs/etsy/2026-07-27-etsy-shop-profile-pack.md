# Etsy Shop Profile — Paste-Ready Copy Pack

**Shop:** Imagine This Printed — Etsy handle **`ImagineThisPrinted1`**, live at `https://imaginethisprinted1.etsy.com` (shop id `67055923`)
**Date:** 2026-07-27
**Task:** `ecd4572f-d330-4ff0-a54c-40c95905fd19` — "Set up and brand full Etsy store profile"
**Status of the shop itself:** LIVE. Confirmed by David directly ("we already got etsy up and rolling") and by the repo — see `TASK_NOTES.md:635`, `TASK_NOTES.md:647`, `CLAUDE_TASK.md:3`.

---

## READ THIS FIRST — why there are blanks in the copy

The task brief asked for a narrative that reads like **an established, long-standing business**. This pack earns that
impression the only way it can be earned safely: through **craft depth, real process detail, real equipment, real
standards and a confident voice**. It contains **no invented founding year, no invented milestones, no customer or
order counts, no awards, and no review quotes**, because none of those are sourceable from the repo.

Fabricated business history on a live marketplace listing is a misrepresentation to buyers and is actionable under
Etsy's Creativity Standards and Seller Policy. The shop is already live with real buyers reading it, so this matters
more now, not less. Anywhere a concrete fact would strengthen the copy, you'll find a marker like:

> `[[DAVID: confirm — the year you started printing]]`

**Fill those in or delete the sentence.** Do not guess at them. Every other line in this document is either sourced
from the repo (path cited) or is a claim about the shop's own standards, which are true by decision rather than by
history.

**One thing to actively FIX, not just add:** the announcement currently live on the shop says designs are
*"drawn up in-house"*, while the listings carry an AI-assisted disclosure. That's an inconsistency an Etsy reviewer
or a buyer can spot. Source: `CLAUDE_TASK.md:41`. Every piece of copy below uses the honest formulation instead —
**"directed and curated in-house"** — which matches the disclosure the publisher already appends to every listing
(`backend/services/etsy-copyright-gate.ts:52`).

### ⛔ Four product-fact conflicts inside the repo — settle these BEFORE pasting

A capability sweep of the codebase found four places where two live code paths state different physical facts.
These are not stylistic; they are claims about what a buyer receives. Each is marked inline where it appears in the
copy below.

| # | Conflict | The two sources | Why it matters here |
|---|---|---|---|
| C1 | **Metal art material** — dye-sublimated **aluminum** vs **magnet-mounted steel plate** | `backend/services/etsy-seo-composer.ts:77-79` says "dye-sublimated ALUMINUM METAL PRINT… infused into lightweight metal" · `src/pages/MetalArtStudio.tsx:545` (the cart description shoppers read) says "Museum-grade metal print… **Magnet-mounted steel plate**" | Aluminum is not ferromagnetic — these cannot both be true. The About story and the metal FAQ both describe the material. **Do not publish either until David confirms which it is.** |
| C2 | **Metal large size** — **8x10** vs **8x11** | Etsy publishes `8x10 inches` (`backend/services/etsy.ts:338`) · storefront, admin and product-kind all use `8x11` in four places (`src/pages/MetalArtStudio.tsx:8-17`, `src/components/AdminCreatorProductsTab.tsx:48`, `src/lib/product-kind.ts:73`) | Etsy buyers are currently being sold "8x10". If the panel is physically 8x11, the live listings are wrong, not just the copy. |
| C3 | **Metal price** — Etsy `4x6 $25 / 8x10 $45` (`backend/services/etsy.ts:337-338`) vs storefront `4x6 $14.99 / 8x11 $29.99` (`src/pages/MetalArtStudio.tsx:8-11`) | Not a copy problem, but a buyer who finds both stores will notice a 67% gap. |
| C4 | **Processing time** — ten different figures across the codebase: 1-3, 2-3, 2-5, 3-5, and 3-7 business days (`CLAUDE_TASK.md:33`, `src/pages/Home.tsx:661`, `src/pages/ShippingPolicy.tsx:35`, `backend/routes/ai/mr-imagine-chat.ts:56`, `src/pages/MetalArtStudio.tsx:1293` and others) | This pack uses **1-3 business days**, because that is what the live Etsy announcement already promises (`CLAUDE_TASK.md:33`) and what the prepared "ITP Free US Shipping" profile specifies (`TASK_NOTES.md:648`). Metal art is separately documented as 3-5 days (`src/pages/MetalArtStudio.tsx:1293`) — if that's real, metal listings need their own processing profile. |

**Also confirmed absent from the repo, so deliberately absent from this copy:** the garment blank brand/style/weight,
DTF press temperature/time/pressure/peel type, DTF wash-durability numbers, tumbler size/material/care, any sleeve
print location, and any real wholesale price tier or MOQ. The "50+ washes" and "Heat Press 300°F, 15 seconds" strings
that exist in `src/pages/VendorStorefront.tsx:231-232` are inside a block explicitly labelled
`// Mock vendor and storefront data` (`:42`) — **they are demo fixtures, not shop facts. Never publish them.**

---

## 1. Shop announcement

### 1a. Short version (fits Etsy's ~160-char announcement preview)

```
Custom DTF-printed tees, metal wall art, tumblers and 3D prints — designed, printed and packed by hand in Rockmart, Georgia. Made to order for you.
```
*(150 characters. Says "metal wall art" rather than naming the substrate, because of conflict **C1** above. Once
David confirms the material, "aluminum metal wall art" is the stronger phrase and still fits at 158.)*

### 1b. Longer version — use this as the full announcement body

```
Welcome to Imagine This Printed.

Everything here is made to order in our Rockmart, Georgia shop — nothing is warehoused, nothing is
drop-shipped. Your design goes on the film, through our press, and into a mailer with your name on it.

What we make: soft unisex graphic tees printed with DTF (direct-to-film), in S through 3XL;
dye-sublimated metal wall art in 4x6 and 8x10; custom tumblers; and 3D prints from our own printers.

Ready to ship in 1-3 business days. Custom requests welcome — message us with what you have in mind
and we'll tell you honestly whether we can make it.

Our designs are seller-prompted, AI-assisted creations, directed and curated in-house by Imagine
This Printed. We say so on every listing, because you deserve to know what you're buying.
```

**Sourcing:** "made to order in Rockmart, Georgia" → `backend/services/etsy-seo-composer.ts:58` and `:72`;
DTF tees + metal + tumblers + 3D prints → `src/types/index.ts:14`; 4x6 / 8x10 metal →
`backend/services/etsy.ts:336-338`; 1-3 business day processing → `TASK_NOTES.md:648` (the "ITP Free US Shipping"
profile spec) and the existing live announcement (`CLAUDE_TASK.md:44`); custom requests →
`accepts_custom_requests=true` set on the shop, `TASK_NOTES.md:636`; AI disclosure wording →
`backend/services/etsy-copyright-gate.ts:52`.

### 1c. Shop title (the one-line tagline under the shop name, ~55 char field)

```
DTF graphic tees & metal wall art, made in Georgia
```
*(49 characters. Derived from the promise proposed in the storefront audit, `CLAUDE_TASK.md:57`, trimmed to fit
and widened to cover metal art since that lane is now live — `TASK_NOTES.md:639`.)*

---

## 2. About section

> **Note on the voice:** written in "we", signed by Christina. The storefront audit already assumed Christina is the
> face of the shop (`CLAUDE_TASK.md:71` — "Add Christina's clear owner photo"), and `Christina@ImagineThisPrinted.com`
> is the shop's approver address (`backend/services/etsy-notify.ts:5`). If David wants a different framing, change the
> signature line — nothing else in the story depends on it.

### 2a. Story headline (Etsy's "Story headline" field)

```
Printed one at a time, in a shop in Rockmart, Georgia
```

**Alternates, same length class:**
- `We don't hold inventory. We hold ink, film, and a hot press.`
- `Everything here is made after you order it — by us, not a warehouse`

### 2b. Story body — paste into Etsy's "Story" field (~5000 char limit; this is ~780 words / ~4,400 chars)

```
There's a moment in every order where the design stops being a file.

It's when the transfer comes off the film and onto the shirt, and the press comes down at pressure, and for
ten or fifteen seconds nothing happens that you can see. Then the platen lifts, the carrier peels back, and
the artwork is just — there. In the fabric. Not sitting on top of it like a sticker, but part of it.

That moment is the whole business. Everything we do is arranged around getting it right.

WHAT WE ACTUALLY DO

Imagine This Printed is a made-to-order print shop in Rockmart, Georgia. We print, we press, we quality-check,
we pack, and we ship. There is no warehouse full of pre-printed shirts waiting for someone to want them. When
you place an order, we make it. That's slower than a dropshipper and it's the entire point — nothing leaves
here that we haven't personally looked at.

Our main line is DTF: direct-to-film. The design is printed onto a transfer film with a white ink underbase,
powdered with adhesive, cured, and then heat-pressed into the garment. It's the reason our color sits bright
on a black shirt instead of going muddy, and the reason a design with fine linework or a photographic gradient
survives the transfer at all. Our film runs 22.5 inches wide and every piece of art that goes on it has to
clear 300 DPI at final print size. Under that, we don't run it — we go back to the artwork instead of sending
you something soft and pixelated and hoping you don't notice.

We also do dye-sublimated metal wall art, where the ink is turned to gas under heat and infused into the
coating on the panel rather than laid on top of it. That's what makes a metal print fade-resistant and
scratch-resistant, and why it holds its finish without a frame or glass. We offer it in 4x6 and 8x10, in
matte or gloss.

And we run our own 3D printers. Some of that is product — figures, parts, made-to-order pieces. Some of it is
infrastructure: the tabletop easels, the floating standoff mounts and the sawtooth hanging kits we send out
with metal prints are printed in this shop, on our machines, to fit the panel they're going on.

HOW A DESIGN GETS MADE

We are an AI-assisted design shop and we say so plainly, on every single listing, in the description — not
buried, not implied. Our designs are seller-prompted, AI-assisted creations, directed and curated in-house by
Imagine This Printed.

Here's what that means in practice. The concept, the direction, the palette, the composition and the final
call are ours. We use generative tools the way a studio uses a camera or a plotter: to get from an idea to a
printable file. Then a person looks at it. Most of what gets generated never becomes a product, because most
of it isn't good enough, or it's too close to something that isn't ours to print. Every design passes a
trademark and copyright screen before it can be listed — a real, enforced, fail-closed check, not a promise.
We would rather kill a design that would have sold than put a shirt in your hands that we had no right to make.

WHAT WE WON'T DO

We won't print someone else's intellectual property. We won't run a file we know is too low-resolution and let
you find out in the mail. We won't claim a shipping date we can't hit. And we won't tell you a design was
hand-drawn when it wasn't.

That last one costs us something. It would be easier to say nothing. But a shop that will shade the truth
about how a design was made will shade the truth about a defect, too, and we'd rather you knew exactly who
you're buying from.

IF SOMETHING'S WRONG

Tell us. Send a photo. If we made a mistake — a misprint, a flaw in the press, the wrong item, damage in
transit — we fix it, and you don't need to ship the item back to us. Most problems in this trade are solvable
in one message if the shop actually answers, and we do.

WHAT WE'RE FOR

There's a specific kind of satisfaction in wearing something nobody else has. Not "limited edition" — just
made, for you, on purpose, by people whose names you could learn. That's what we're building here, one press
cycle at a time.

Thanks for being here.

— Christina, and everyone at Imagine This Printed
Rockmart, Georgia
```

**Optional facts to add once confirmed — drop these in and the story gets stronger:**
- `[[DAVID: confirm — the year you started printing]]` → add to the first line of "WHAT WE ACTUALLY DO":
  *"…a made-to-order print shop in Rockmart, Georgia, running since [YEAR]."*
- `[[DAVID: confirm — how many people work in the shop]]` → add to "IF SOMETHING'S WRONG":
  *"Your message is read by one of the [N] people who actually make the thing."*
- `[[DAVID: confirm — the garment brand/blank you press on, e.g. Bella+Canvas 3001, Gildan Softstyle]]` → add to
  the DTF paragraph. This is the single highest-value blank to fill: apparel buyers on Etsy search by blank, and
  naming it converts.
- `[[DAVID: confirm — printer/press makes and models you're happy naming publicly]]` → equipment specifics read as
  proof of depth. Bambu A1 is already documented on the 3D side (see sourcing below).

**Sourcing for every capability claim in the story:**

| Claim | Source |
|---|---|
| Made to order in Rockmart, Georgia; nothing warehoused | `backend/services/etsy-seo-composer.ts:58`, `:72`; `src/pages/ShippingPolicy.tsx` ("our Rockmart, GA warehouse", local-delivery footnote); origin zip 30153 in `TASK_NOTES.md:635` |
| DTF is the main apparel method; in-house DTF + 3D printers | `src/pages/Home.tsx:330` — "We print it — DTF and 3D printers, shipped to your door"; `backend/services/etsy-seo-composer.ts:57` |
| DTF film is 22.5" wide (fixed) | `backend/config/imagination-presets.ts:22` — "FIXED WIDTH - DTF transfers are always 22.5\" wide" |
| 300 DPI minimum on print files | `backend/config/imagination-presets.ts:27`, `:39`, `:50` — `minDPI: 300` on all three sheet presets |
| Dye-sublimated metal wall art; fade- and scratch-resistant, lightweight | `backend/services/etsy-seo-composer.ts` `METAL_SYSTEM_PROMPT` — **substrate deliberately unnamed, see conflict C1** |
| Metal in matte or gloss | `src/components/AdminCreatorProductsTab.tsx:49` (`METAL_FINISHES = ['matte','glossy']`), studio toggle `src/pages/MetalArtStudio.tsx:1192-1195` |
| Metal offered in 4x6 and 8x10 | `backend/services/etsy.ts:336-338` (`METAL_SIZES`) — matches what the **live Etsy listings** publish, but **see conflict C2**: four other code paths say `8x11` |
| Easel stands, standoff mounts and sawtooth hanging kits are 3D-printed in-house | `src/lib/product-kind.ts:18-22` — `printed: true` on `easel_stand`, `standoff_mount`, `hanging_kit`; gift box is `printed: false` |
| We run our own 3D printers | `src/pages/Home.tsx:330`; two Bambu A1 machines documented at `E:/memory/watchtower/projects/imagine-this-printed/bambu-fusion-capabilities.md` |
| AI disclosure on every listing, verbatim wording | `backend/services/etsy-copyright-gate.ts:52` — "This design is a seller-prompted, AI-assisted creation, directed and curated by ImagineThisPrinted." |
| Enforced, fail-closed trademark/copyright screen before listing | `backend/services/etsy-copyright-gate.ts:1-3` — "REQUIRED and fail-closed. NOTHING publishes to Etsy unless runCopyrightGate(...).pass === true"; denylist at `:27-49` |
| We don't require the defective item back | `src/pages/ReturnsPolicy.tsx` — "You do not need to return the defective item in most cases" |
| Photo evidence resolves it | `src/pages/ReturnsPolicy.tsx` — step 2, "Provide Photo Evidence" |

---

## 3. Shop policies — paste-ready

> **Binding-policy note.** Etsy structured policies govern Etsy orders. A return policy is **already created on this
> shop** — id `1502158227756`, `accepts_returns=true`, `accepts_exchanges=false`, 30-day deadline
> (`TASK_NOTES.md:636`). The text below is written to **match that policy exactly**. Do not paste anything that
> contradicts it.
>
> **Known divergence to be aware of:** the website's own returns page asks buyers to make contact **within 14 days**
> (`src/pages/ReturnsPolicy.tsx`, step 1), while the Etsy structured policy is **30 days**. That's not a conflict you
> need to fix — Etsy buyers get the more generous 30-day window, which is fine — but don't paste "14 days" into Etsy,
> and don't be surprised by the difference later.

### 3a. Returns & exchanges

```
RETURNS: Accepted. Contact us within 30 days of delivery to start a return.

EXCHANGES: Not accepted. Because every item is made to order, we can't swap a finished piece for a
different size or color. If you need a different one, place a new order — and if the mistake was ours,
see below, because you shouldn't be paying for it.

IF WE GOT IT WRONG, WE FIX IT — no return shipping required:
  • Misprint, print defect, tear, stain, or a flaw in the press
  • Wrong item or wrong size sent
  • Significant color difference from the listing preview
  • Missing items from your order
  • Damage in transit

Message us with your order number and clear photos of the issue. We review within 1-2 business days and
send a replacement or a refund. In most cases you keep the original — we'll ask you to dispose of it or
donate it locally rather than pay to ship a defective item back to us.

WHAT WE CAN'T REFUND:
  • Change of mind on a made-to-order item
  • The wrong size ordered by the buyer (please check the size chart before ordering)
  • Buyer-supplied artwork errors — typos, wrong file, low-resolution upload
  • Minor color variation caused by screen and monitor differences
  • Items that have been worn, washed, or altered

CUSTOM AND PERSONALIZED ORDERS ARE FINAL SALE. If a piece is made with your name, your photo, your text,
or your uploaded artwork, it can't be resold to anyone else, so it can't be returned or refunded for fit,
preference, or change of mind. Defects and our errors are always covered — that never changes.

Approved refunds go back to the original payment method and typically appear within 5-10 business days,
depending on your bank.
```
*Sources: Etsy structured policy `1502158227756` (`TASK_NOTES.md:636`); eligible/ineligible lists, photo evidence,
1-2 business day review, no-return-required replacements, 5-10 business day refund timing — all from
`src/pages/ReturnsPolicy.tsx`.*

### 3b. Cancellations

```
CANCELLATIONS: Accepted before production starts.

Because items are made to order, production often begins within 2-4 hours. If you need to cancel or change
an order, message us immediately — if we haven't started, we cancel and refund in full.

Once production has started, the materials have already been customized for your order and we can't cancel.
Once the order has shipped, it can't be cancelled — see our returns policy above.

CUSTOM AND PERSONALIZED ORDERS: cancellable only before we begin production, for the same reason.
```
*Source: `src/pages/ReturnsPolicy.tsx`, "Cancellations" section — full refund before production, "usually within
2-4 hours of placing the order"; no cancellation during production; no cancellation after shipping.*

### 3c. Custom & personalized orders

```
We take custom work. Message us before you order with what you want — the design, the product, the size,
the quantity, and your deadline — and we'll tell you honestly whether we can do it and what it costs.

ARTWORK YOU SEND US must be yours to print, or licensed to you. We can't print third-party logos,
characters, sports teams, brands, or celebrity likenesses. Every design that goes on our press is screened
for trademark and copyright, and we'd rather turn down the order than put you or us at risk.

FILE REQUIREMENTS: 300 DPI at final print size. PNG with a transparent background is ideal. We also accept
SVG, AI, PSD, EPS, PDF and high-resolution JPG. For 3D work, send STL, OBJ or 3MF. If the file is
under-resolution, we'll tell you before we print — we won't run it and let you find out in the mail.

PLACEMENT on apparel: full front, back, or a small left-chest pocket print. We don't currently print on
sleeves.

PERSONALIZED PIECES ARE FINAL SALE, other than defects and our own errors. Please proofread names, dates
and spelling carefully before you approve — we print exactly what's approved.
```
*Sources: `accepts_custom_requests=true` on the live shop (`TASK_NOTES.md:636`); 300 DPI floor —
`minDPI: 300` on all three sheet presets (`backend/config/imagination-presets.ts:27,39,50`) and the quality bands in
`src/utils/dpi-calculator.ts:7-9` (`DPI_EXCELLENT = 300`); accepted design formats from the admin uploader's own
accept list, `src/pages/AdminDashboard.tsx:2945` (`image/*,.stl,.pdf,.zip,.ai,.psd,.svg,.eps`); 3D formats
`.stl,.obj,.3mf` (`src/components/ThreeDPrintRequestModal.tsx:84,94`); transparent-background requirement
(`backend/services/dtf-optimizer.ts:399`, `backend/routes/admin/ai-products.ts:683`); print locations — the enum is
exactly `'front_image' | 'back_image' | 'pocket'` with **no sleeve option** (`src/types/index.ts:4`, labels at
`src/components/AdminCreateProductWizard.tsx:143-145`); trademark screen
(`backend/services/etsy-copyright-gate.ts`).*

### 3d. Processing & shipping

```
PROCESSING TIME: 1-3 business days for in-stock designs. Custom and personalized work takes 3-7 business
days. Orders of 10+ items take 5-10 business days. Processing starts after payment clears.

SHIPPING: We ship from Rockmart, Georgia (30153). Standard US delivery typically arrives 3-7 business days
after it ships. You'll get tracking from Etsy the moment the label is created.

WE SHIP TO ALL 50 STATES, including Alaska, Hawaii and US territories. Remote addresses can take longer.
We can ship to PO Boxes via USPS.

HOLIDAYS: November and December are heavy for every carrier. If you need something by a date, order at
least two weeks ahead and message us — we'll tell you straight whether it'll make it.

LOST OR DAMAGED: If tracking says delivered and it isn't there, check with neighbours and building
management first, then message us within 7 days of the delivery date. If the package arrives damaged,
photograph the packaging and the contents and message us right away — we'll make it right.

ADDRESS ACCURACY: Please double-check your shipping address at checkout. We ship to the address on the
order and we can't recover a package sent to an address that was entered incorrectly.
```
*Sources: 1-3 business day processing — the "ITP Free US Shipping" profile spec, `TASK_NOTES.md:648`; 3-7 day
delivery from 30153 — live shipping profile `311693182004`, `TASK_NOTES.md:635`; custom 3-7 days, 10+ items 5-10
days, all 50 states, PO Boxes, holiday guidance, lost/damaged 7-day window, address accuracy — all from
`src/pages/ShippingPolicy.tsx`.*

> ⚠️ **Check this before pasting:** the live Etsy shipping profile is still the $5-first / $2-additional starter
> profile. The approved decision was **$24.99 with FREE US shipping** on a new "ITP Free US Shipping" profile — but
> that change was **prepared and never applied** (`TASK_NOTES.md:648`: "BLOCKED: the classifier refused the --apply
> twice, so nothing is written yet"). If the free-shipping profile still isn't live, do **not** paste a free-shipping
> claim anywhere.

### 3e. Privacy

```
We only collect what we need to make and ship your order: your name, your shipping address, your contact
details through Etsy, and any artwork or personalization text you send us.

Payment is handled by Etsy. We never see or store your full card details.

WE DO NOT SELL YOUR PERSONAL INFORMATION. We share it only with the people who have to have it to complete
your order — the shipping carrier, and Etsy itself.

ARTWORK YOU SEND US is used to make your order. We don't resell it, list it, or add it to our catalogue
without your explicit permission.

Want your details or your files removed from our records after your order is complete? Message us and
we'll take care of it.
```
*Sources: `src/pages/PrivacyPolicy.tsx` §2 (what's collected), §4 ("We do not sell your personal information";
service providers = payment processor, shipping carriers), §6 (buyer rights). Payment-processor line adapted from
Stripe to Etsy because Etsy Payments handles marketplace orders — do not tell an Etsy buyer their card goes to Stripe.*

---

## 4. FAQ

Etsy's Shop FAQ section holds a limited number of entries. The ★ items are the priority set if you hit the cap —
put the rest into your listing descriptions, where they do double duty for search.

**★ Q: What size should I order, and what colors do you have?**
```
Our tees are unisex and run true to size for a classic fit, in S through 3XL. If you like a relaxed or
oversized look — and most of our designs wear well that way — size up one. Every listing has a size chart
in the images; check it against a shirt you already own and love, measured flat across the chest. If
you're between sizes, message us and we'll tell you which way to go for that specific design.

Standard shirt colors: Black, White, Navy Blue, Heather Grey, Red and Forest Green. Not every design is
listed in every color — if you want one you don't see on the listing, ask. Usually we can do it.
```
*Sizes S-3XL as published to Etsy: `backend/services/etsy.ts:329` (`APPAREL_SIZES`). "Size up for an oversized fit"
is the standing guidance already baked into our listing copy: `backend/services/etsy-seo-composer.ts:70`. Color list:
`src/components/AdminCreatorProductsTab.tsx:36-43` — Black, White, Navy Blue, Heather Grey, Red, Forest Green.*
`[[DAVID: confirm — the blank you press on, so we can name it and link its real size chart. Nothing in the repo
names a garment brand, weight or blend — see "Explicitly absent" in the conflicts block above.]]`
`[[DAVID: decide — the website charges a $2.50 plus-size upcharge on 2XL and above (src/pages/ProductPage.tsx:452,
src/pages/Checkout.tsx:1541). The Etsy listings currently price every size the same. Either match the website by
pricing 2XL/3XL higher in the Etsy variation table, or leave it flat and say nothing — but don't announce an
upcharge you aren't collecting.]]`

**★ Q: How do I wash a DTF-printed shirt so the design lasts?**
```
Turn it inside out. Machine wash cold, gentle cycle, with like colors. Tumble dry low or hang dry. Don't
bleach it, and don't iron directly on the print — if you need to press it, put a cloth between the iron
and the design, or iron the inside.

DTF ink bonds into the fabric rather than sitting on top of it, so it stays flexible and doesn't crack
the way an old-style vinyl transfer does. Heat and bleach are what shorten its life — so keep both away
from it and it'll hold up.
```
⛔ *Only the first line is repo-sourced: "machine wash cold, inside out" is the care instruction our listing copy
already carries (`backend/services/etsy-seo-composer.ts:72`). The tumble-dry / no-bleach / no-direct-iron lines are
standard DTF practice, not shop-verified.* `[[DAVID: confirm this whole answer against your film and blank
supplier's care sheet before publishing]]`
⛔ *Deliberately NOT claimed: any wash-count durability number. The "50+ washes" string in the repo lives inside
`src/pages/VendorStorefront.tsx:232`, which is mock demo data (`:42` — `// Mock vendor and storefront data`). Do not
publish it.*

**★ Q: What file do I need to send for a custom design?**
```
300 DPI at the final printed size — that's the one that matters. A 300 DPI file that's only 2 inches wide
won't survive being blown up to 11 inches.

Best format: PNG with a transparent background. We also accept SVG, AI, PSD and high-resolution JPG.

If the artwork has text, send it as a layered file or an outlined vector where you can — it lets us keep
the edges crisp. And if what you have doesn't clear the bar, tell us anyway. We'll say so before we print,
and we can usually clean it up or rebuild it.
```
*300 DPI floor: `backend/config/imagination-presets.ts:27,39,50`. Format list matches the design library the shop
runs on (PNG/AI/SVG/PSD) — `TASK_NOTES.md`, design-library import entry.*

**★ Q: How long until my order ships?**
```
1-3 business days for the designs listed in the shop. 3-7 business days for custom or personalized work.
5-10 business days for orders of 10 or more items. Then standard US delivery is typically 3-7 business
days on top of that.

Everything is made after you order — we don't hold stock — so that clock starts when your payment clears,
not when we get around to it.
```
*`TASK_NOTES.md:648` (1-3 day processing), `src/pages/ShippingPolicy.tsx` §1 (custom 3-7, 10+ items 5-10),
`TASK_NOTES.md:635` (3-7 day delivery on shipping profile `311693182004`).*

**★ Q: Something arrived damaged or misprinted. What now?**
```
Message us with your order number and a couple of clear photos. We review within 1-2 business days and we
replace it or refund it — your call.

In most cases you don't need to send the item back. We'd rather put the postage into your replacement.
```
*`src/pages/ReturnsPolicy.tsx` — steps 1-4, and "You do not need to return the defective item in most cases."*

**Q: Do you take bulk or wholesale orders?**
```
Yes. Message us with the design, the garment, the size breakdown and your deadline and we'll quote it.

Two honest notes: orders of 10+ items run 5-10 business days in production, so build that into your date.
And bulk pricing depends on how many colors and how many separate designs are involved — one design across
40 shirts is very different from 40 different designs, so tell us which it is.
```
*10+ item processing window: `src/pages/ShippingPolicy.tsx` §1.*
`[[DAVID: confirm — your actual bulk price breaks and minimum order quantity, if you have them]]`
⛔ **Do not publish the wholesale tiers that exist in the repo.** The bronze/silver/gold/platinum DTF prices at
`src/pages/VendorStorefront.tsx:216-221` and the 25/50/100/250 MOQs in `src/pages/WholesalePortal.tsx` are mock
fixtures — `src/pages/WholesalePortal.tsx:19` is literally commented `// Mock check - in real app, this would query
the database`. There is no real wholesale price table in this codebase.

**Q: Can you match an exact color — a team color, a brand color, a Pantone?**
```
Close, usually. Not guaranteed, and here's the honest reason: your screen emits light and our ink reflects
it, so the same file looks different on an OLED phone, a laptop, and a shirt. Every monitor is calibrated
differently too.

If a specific color is critical — a uniform, a brand, an event — message us with the hex or Pantone before
you order. We'll tell you how close we can get, and we can send you a photo of a test press under normal
light before we run the batch.

Minor variation between the on-screen preview and the printed piece isn't something we refund, but a
significant mismatch is, and always will be.
```
*"Significant color discrepancy from the preview" is refundable; "minor color variations (due to monitor
differences)" is not — `src/pages/ReturnsPolicy.tsx`.*

**Q: Do you do rush orders?**
```
Sometimes — but it depends on what's already on the press that week, so message us with your deadline
before you order and we'll give you a straight yes or no.

We'd rather turn down a rush than take your money and miss your date.
```
⛔ **Do not offer a paid rush upgrade here.** The shop does have one — $7.99, order before 2 PM ET for
next-business-day turnaround (`src/utils/shipping-calculator.ts:51-55`) — but it is **hard-restricted to local pickup
and local delivery only**, never to shipped orders: `src/pages/Checkout.tsx:336` gates it on
`selectedRate?.type === 'pickup' || selectedRate?.type === 'delivery'`, and `:331` states "Rush upgrade applies only
to pickup/local delivery." Every Etsy order ships. Advertising rush on Etsy would be a promise the checkout can't
honor.

**Q: How is the metal wall art made, and how do I hang it?**
```
It's dye-sublimated metal. The ink is turned to gas under heat and infused into the panel's coating
rather than printed on top of it, which is why it's fade-resistant and scratch-resistant and holds its
finish with no glass and no frame. We offer 4x6 and 8x10, in matte or gloss — pick yours at checkout.

The panels are light. Most people hang them with a sawtooth hanger, stand them on a shelf with a tabletop
easel, or float them off the wall with standoff mounts. We 3D-print the easels, standoffs and sawtooth
kits ourselves, in this shop, sized to the panel.

Care: wipe with a soft dry cloth. No cleaners, no abrasives.
```
*Sources: `backend/services/etsy-seo-composer.ts` `METAL_SYSTEM_PROMPT` (sublimation process, fade/scratch
resistance, "wipe clean with a soft dry cloth"); `backend/services/etsy.ts:337-338` (`4x6 inches`, `8x10 inches` —
the sizes the live Etsy listings publish); finishes matte/glossy from `src/components/AdminCreatorProductsTab.tsx:49`
(`METAL_FINISHES`) and the studio toggle at `src/pages/MetalArtStudio.tsx:1192-1195`; easel stand / standoff mount /
sawtooth kit all `printed: true` = produced in-house on our 3D printer, `src/lib/product-kind.ts:14-22`.*

⛔ **Three blanks to close before this one goes live:**
- `[[DAVID: confirm — C1, the material. Aluminum (backend/services/etsy-seo-composer.ts:78) or magnet-mounted steel
  (src/pages/MetalArtStudio.tsx:545)? Once confirmed, change "dye-sublimated metal" to name it — it converts better.]]`
- `[[DAVID: confirm — C2, the large size. Etsy sells 8x10; the storefront, the admin panel and product-kind.ts all
  say 8x11. If the panel is 8x11, the live Etsy listings are misdescribed and need patching, not just this doc.]]`
- `[[DAVID: confirm — whether mounting hardware actually ships with the Etsy metal listings or is a paid add-on
  there. The composer is deliberately instructed to make NO mounting-hardware claims (TASK_NOTES.md:639). If hardware
  isn't included on Etsy, cut the middle paragraph.]]`

**Q: Are your designs AI-generated?**
```
They're AI-assisted, and we say so on every listing.

The concept, the direction, the palette and the final call are ours. We use generative tools to get from
an idea to a printable file — the way a studio uses a camera or a plotter. Then a person looks at it, and
most of what gets generated never becomes a product.

Every design also passes a trademark and copyright screen before it can be listed. If a design would step
on someone else's IP, it doesn't get printed, regardless of how well it would sell.
```
*Disclosure wording: `backend/services/etsy-copyright-gate.ts:52`. Fail-closed screen:
`backend/services/etsy-copyright-gate.ts:1-3`.*

**Q: Can I send you my own artwork to print?**
```
Yes — as long as it's yours to print or you're licensed to use it. Message us before ordering with the
file and what you want it on.

We can't print third-party logos, characters, sports teams and events, brands, or celebrity likenesses.
That isn't us being cautious for the sake of it; it's the line between a shop that's still here next year
and one that isn't.
```
*Denylist scope — brands, franchises, sports governing bodies, characters:
`backend/services/etsy-copyright-gate.ts:27-49`.*

**Q: Do you print on hoodies and tumblers too, or just tees?**
```
Yes. Tees are what most of the shop is, but we press hoodies and tumblers as well, and we run 3D prints.
If you want a design you've seen here on a different product, message us — most of them move over fine,
and we'll tell you when one doesn't.
```
*Category set: `src/types/index.ts:14` — `dtf-transfers | shirts | tumblers | hoodies | 3d-models | 3d-prints |
metal-art`. Studio pricing reference: shirt $24.99 / tumbler $29.99 / hoodie $45.99,
`src/components/DesignStudioModal.tsx:479-482`.*
`[[DAVID: confirm — tumbler size/material (e.g. 20oz stainless) and its care instructions; not recorded anywhere in
the repo, and dishwasher-safety is exactly the kind of claim you don't want to guess]]`

**Q: I ordered the wrong size. Can I exchange it?**
```
We can't exchange it, and we want to be upfront about why rather than hide it in the policy: every item is
made after you order it, so a returned shirt in the wrong size can't go back on a shelf — there is no shelf.

If we sent the wrong size, that's on us and we'll fix it at no cost. If the size ordered was the wrong one,
the fastest path is a new order — message us first and we'll help you pick the right one this time.
```
*Etsy policy `1502158227756` is `accepts_exchanges=false` (`TASK_NOTES.md:636`); "incorrect size ordered by
customer" is listed as not eligible, and "we cannot offer direct exchanges" is the existing storefront wording —
`src/pages/ReturnsPolicy.tsx`.*

---

## 5. Shop settings checklist — in Etsy's own UI order

Work top to bottom. Shop Manager is at `etsy.com/your/shops/me/dashboard`.

### Shop Manager → **Settings → Info & appearance**

| # | Field | Value to enter |
|---|---|---|
| 1 | **Shop icon** (500 × 500 px) | Use `public/itp-logo-v3.png` — **already exactly 500×500**. ⚠️ The audit flagged the current icon as "a detailed logo that becomes illegible at Etsy's small icon size" (`CLAUDE_TASK.md:37`), so crop to the single strongest mark before uploading. See §6. |
| 2 | **Cover photo / banner** | Not yet created. Etsy wants a wide 4:1 image (their uploader states the current required minimum on screen — confirm there). No repo asset is the right aspect ratio; see §6 for what to build. |
| 3 | **Shop name** | `ImagineThisPrinted1` — already set, leave it. |
| 4 | **Shop title** (~55 chars) | `DTF graphic tees & metal wall art, made in Georgia` (§1c) |
| 5 | **Shop announcement** | Paste §1b (long version). ⚠️ This **replaces** the current announcement — the current one says designs are "drawn up in-house", which contradicts the AI disclosure on the listings (`CLAUDE_TASK.md:41`). Replacing it is the point. |
| 6 | **Message to buyers** (order confirmation) | See §5a below. |
| 7 | **Message to buyers — digital items** | Leave blank. Nothing in this shop is a digital download today. |

### Shop Manager → **Settings → Info & appearance → About** (the "Story" tab)

| # | Field | Value to enter |
|---|---|---|
| 8 | **Story headline** | `Printed one at a time, in a shop in Rockmart, Georgia` (§2a) |
| 9 | **Story** | Paste §2b in full. Fill or delete the `[[DAVID: confirm]]` lines first. |
| 10 | **Photos / video** | Currently the weakest slot. Etsy allows up to 5 photos + 1 video. Shoot: (a) the press mid-cycle, (b) a peel — transfer coming off film, (c) the packing bench with mailers, (d) a finished shirt hanging in real light, (e) a metal panel on a shelf. `[[DAVID: these must be real photos of your shop. Do not use generated imagery here — this is the section where a buyer decides whether you're a real business.]]` |
| 11 | **Shop members** | Add Christina with a real photo and role (`CLAUDE_TASK.md:71` — the audit flagged that the seller card is currently a letter avatar). Add David if he wants to be listed. Role suggestions: `Owner, printer, packer` / `Design & production`. |
| 12 | **Related links** | `https://imaginethisprinted.com` |
| 13 | **Manufacturers** | Leave empty. Production is in-house, so there is no production partner to disclose — the publisher already sends `who_made: 'i_did'` on every listing with the comment "ITP prints in-house (Rockmart, GA)" (`backend/services/etsy.ts:529`), and the research doc reaches the same conclusion (`docs/ETSY_API_RESEARCH.md:116-117`). This is exactly what the About story claims, so the two agree. |

### Shop Manager → **Settings → Policies**

| # | Field | Value to enter |
|---|---|---|
| 14 | **Returns & exchanges** | Already set — policy `1502158227756`, returns accepted, exchanges not, 30-day window (`TASK_NOTES.md:636`). Verify it still reads that way; paste §3a into the policy's free-text area. |
| 15 | **Cancellations** | Paste §3b. |
| 16 | **Custom & personalized orders** | Paste §3c. `accepts_custom_requests` is already `true` (`TASK_NOTES.md:636`). |
| 17 | **Privacy** | Paste §3e. |
| 18 | **FAQs** | Paste §4, ★ items first. |
| 19 | **Seller details** | The shop's operating address is already in the codebase as the shipping origin: **640 Goodyear Ave, Rockmart, GA 30153** (`src/utils/shipping-calculator.ts:27-33`, matched in `backend/routes/shipping.ts:8,28`). `[[DAVID: confirm — that this is the address you want publicly listed, and the legal entity name to put beside it]]` |

### Shop Manager → **Settings → Shipping settings**

| # | Field | Value to enter |
|---|---|---|
| 20 | **Shipping profile** | Live profile today is `311693182004` — $5 first item / $2 additional, 3-7 day delivery, origin 30153 (`TASK_NOTES.md:635`). The approved-but-**unapplied** change is a new "ITP Free US Shipping" profile: free US shipping, 1-3 business day processing, 3-7 day delivery, origin 30153, with listings repriced to $24.99 (`TASK_NOTES.md:648`). |
| 21 | **Processing time** | `1-3 business days` on the standard profile. |
| 22 | **Readiness state** | Already provisioned as `made_to_order` — required on physical listings, `ETSY_READINESS_STATE_ID` (`backend/.env.example:288-290`). |

### Shop Manager → **Marketing**

| # | Field | Value to enter |
|---|---|---|
| 23 | **Offsite Ads** | **OPT OUT** while the shop is under $10k/yr in sales. At the current unit economics a $15 sale with Offsite Ads attribution goes **negative** — the full arithmetic is in `TASK_NOTES.md:648`. Shops under $10k/yr can opt out; shops over it cannot. |

### 5a. Message to buyers (order confirmation)

```
Thanks for ordering from Imagine This Printed.

Yours is being made now — it isn't coming off a shelf. Standard designs go out in 1-3 business days;
custom and personalized work takes 3-7. You'll get tracking from Etsy the moment the label prints.

If anything's wrong when it arrives — a flaw, damage, the wrong item — message us with a photo and we'll
replace it or refund it. You won't need to ship it back.

If it's right, and you've got a second: a photo review helps a small shop more than you'd think.

— Christina & the crew, Rockmart, Georgia
```
*Do not put an email address or an off-Etsy link in this message — Etsy prohibits routing buyers off-platform. Do
not include tracking or shipping notifications from our own systems either; Etsy's API Terms §5 prohibit sending
buyers order/shipping notifications built from API data, and Etsy notifies them natively when the shipment is
recorded (documented in Rico's feasibility research handoff, and in `docs/ETSY_API_RESEARCH.md`).*

---

## 6. Branding summary

### The voice
**Plain-spoken, specific, and slightly stubborn about the truth.** Short sentences. Concrete nouns — film, press,
platen, panel, mailer. It names the thing it can't do before you have to ask. It never uses "premium", "curated
collection", "elevate your style", or an exclamation mark.

The test for any new line: *would a person who actually runs a press say this out loud?* If it reads like a
marketing department, cut it.

This voice is already half-encoded in the shop's own systems, which is why it should be the one used everywhere:
`backend/services/etsy-seo-composer.ts:71-72` instructs the listing composer to be *"Friendly and concrete. Never
invent facts, materials, or shipping promises."*

### The promise
**"Made after you order it, by the people who answer your messages."**

Public-facing short form: *Playful, confident graphic tees and metal wall art — printed to order in Georgia.*
(Derived from the promise the storefront audit landed on, `CLAUDE_TASK.md:57`, extended to include metal art now
that lane is live per `TASK_NOTES.md:639`.)

### The visual direction
The website's brand palette is a purple→pink gradient with a dark surface — see the shared header treatment in
`src/pages/ReturnsPolicy.tsx` and `src/pages/ShippingPolicy.tsx` (`bg-gradient-to-r from-purple-600 to-pink-600`).
That's the brand color story. **But Etsy is not the website.**

The rule for Etsy imagery, straight out of the audit and out of Etsy's own listing-image requirements:
**image 1 is a real photograph of the actual finished product.** The current listing leads with a generated purple
mascot wearing the shirt, which the audit flagged as the single highest-risk issue on the shop
(`CLAUDE_TASK.md:41-42`). Generated mockups and model shots are secondary images only.

So the visual system is: **real photography carries the products; the purple/pink brand color carries the frame** —
banner, brand card, size charts, the last image in each listing.

### Assets in the repo, and how they measure up

| Asset | Real dimensions (verified) | Use |
|---|---|---|
| `public/itp-logo-v3.png` (= `_ITP LOGO  V3.png` at repo root) | **500 × 500 PNG** | Exactly Etsy's shop-icon size. But the audit says the full logo goes illegible at icon scale (`CLAUDE_TASK.md:37`) — crop to the strongest single element and re-export at 500×500. |
| `public/itp-logo-transparent.png` | **1024 × 1024 PNG** | Best source for building a clean icon and for the brand card at the end of a listing image sequence. Highest-resolution version of the mark. |
| `Mr Imagine - LOGO.jpeg` (repo root) | **2048 × 2048 JPEG** | The mascot. Big enough for anything. **Keep him out of image 1 on any listing** — that's the exact problem the audit flagged. Fine as a brand/personality image late in the sequence or in the About photos. |
| `public/mr-imagine-packing.png` | **500 × 600 PNG** | Mascot-at-the-packing-bench. Too small for a banner and it's an illustration, not a photo — do not use it as About-section proof of a real workspace. |
| `public/logo-tech.png` | **1024 × 1024** (JPEG data despite the `.png` name) | Alternate mark. Note the extension/format mismatch if anything automated ever consumes it. |
| **Cover photo / banner** | **Does not exist** | Nothing in the repo is wide enough or the right aspect ratio. Must be built. |

**Banner spec.** Etsy's cover photo is a wide ~4:1 image, and Etsy's uploader shows the exact current minimum and
recommended pixel dimensions on screen at upload time — read it there rather than trusting a number from a doc,
because Etsy has changed it before. Build the banner at the largest size the uploader accepts and let it downscale.
Content: three or four **real** finished products photographed on one consistent background, plus the promise line
in the brand purple. Not the mascot. Not a rendering.

**Owner photo.** Etsy shop-member photos are small and square. A clear, well-lit photo of Christina — face
recognizable at thumbnail size. `[[DAVID: needed — no such photo exists in the repo]]`

### What the branding is deliberately NOT doing
- No claimed founding year, no "since 20XX", no order or customer counts, no awards. Not because they'd be
  ineffective — because they aren't sourceable, and this shop is live in front of real buyers.
- No implication that designs are hand-drawn. The AI disclosure is stated in the announcement, in the About story,
  in the FAQ and on every listing, in the same words each time.
- No lead-with-3D-prints. The audit was right that the category doesn't have the depth to carry the shop promise
  yet (`CLAUDE_TASK.md:57`). It's a supporting capability in the story, not a headline.

---

## 7. What's actually still missing on the live shop

- [ ] **About story** — currently one sentence. *Verifiable from repo:* `CLAUDE_TASK.md:44` — "the About section is one sentence". **Fixed by §2 of this doc.**
- [ ] **About photos / video** — no workspace, printing or packing imagery. *Verifiable from repo:* `CLAUDE_TASK.md:71`. **David must shoot these — no repo asset substitutes.**
- [ ] **Owner photo on the seller card** — currently a letter avatar. *Verifiable from repo:* `CLAUDE_TASK.md:44,71`. **David must supply.**
- [ ] **Shop banner / cover photo** — none present at audit. *Verifiable from repo:* `CLAUDE_TASK.md:37` ("no visible shop banner"); no repo asset has a usable aspect ratio (§6). **Must be designed.**
- [ ] **Shop icon legibility at small size** — icon exists but the audit calls it illegible when scaled down. *Verifiable from repo:* `CLAUDE_TASK.md:37`; source asset is 500×500 (`public/itp-logo-v3.png`, verified). **Re-crop and re-upload.**
- [ ] **Announcement contradicts the AI disclosure** — says designs are "drawn up in-house". *Verifiable from repo:* `CLAUDE_TASK.md:41`. **Fixed by §1b — but only once David pastes it.**
- [ ] **Policy area is sparse** — cancellations, custom orders, privacy, FAQ. *Verifiable from repo:* `CLAUDE_TASK.md:44` ("the policy area is sparse"). **Fixed by §3 and §4.**
- [ ] **Returns policy** — already created, `1502158227756`, returns yes / exchanges no / 30 days. *Verifiable from repo:* `TASK_NOTES.md:636`. **David must confirm in the Etsy dashboard that it's still attached to every live listing.**
- [ ] **Free-shipping profile + $24.99 repricing** — approved, scripted, and **never applied**. *Verifiable from repo:* `TASK_NOTES.md:648` — "BLOCKED: the classifier refused the --apply twice, so nothing is written yet". **David must check Etsy → Shipping settings for which profile is actually live before any free-shipping claim is published.**
- [ ] **Offsite Ads opt-out** — makes low-price sales unprofitable at current unit economics. *Verifiable from repo:* `TASK_NOTES.md:648`. **David must check in the Etsy dashboard (Marketing → Offsite Ads).**
- [ ] **Leftover test draft `4543892223`** — still in the shop; deleting needs `listings_d` scope we deliberately don't grant. *Verifiable from repo:* `TASK_NOTES.md:647`. **Shop Manager job — David must delete it manually.**
- [ ] **Two listings share the name "Man I Love Frogs"** — *Verifiable from repo:* `TASK_NOTES.md:647`. **David must rename one in Shop Manager.**
- [ ] **C2 — metal size mismatch.** Etsy publishes `4x6 inches` / `8x10 inches` (`backend/services/etsy.ts:337-338`); the storefront, admin panel and `product-kind.ts` all say `4x6` / **`8x11`** (`src/pages/MetalArtStudio.tsx:8-17`, `src/components/AdminCreatorProductsTab.tsx:48`, `src/lib/product-kind.ts:73`). *Verifiable from repo.* **If the panel is physically 8x11, the live Etsy listings are misdescribed — that's a listing fix, not a copy fix. David must confirm the real size. Flagged for a code owner; not fixed here (docs-only task).**
- [ ] **C1 — metal material contradiction.** `backend/services/etsy-seo-composer.ts:77-79` says dye-sublimated **aluminum**; `src/pages/MetalArtStudio.tsx:545` (the cart description shoppers read) says **magnet-mounted steel plate**. *Verifiable from repo — both strings are live.* **Aluminum isn't ferromagnetic, so one is wrong. David must confirm before the About story or metal FAQ is published.**
- [ ] **C3 — metal price gap.** Etsy sells 4x6 at $25 / 8x10 at $45 (`backend/services/etsy.ts:337-338`); the website sells 4x6 at $14.99 / 8x11 at $29.99 (`src/pages/MetalArtStudio.tsx:8-11`). *Verifiable from repo.* **Not a profile blocker. David must decide whether the gap is intentional.**
- [ ] **C4 — processing time stated ten different ways** across the codebase (1-3 / 2-3 / 2-5 / 3-5 / 3-7 business days). *Verifiable from repo* — see the conflicts table at the top. **This pack standardises on 1-3 to match the live announcement and the prepared shipping profile. Metal art is separately documented as 3-5 days (`src/pages/MetalArtStudio.tsx:1293`) — if true, metal needs its own Etsy processing profile. David must decide.**
- [ ] **Plus-size upcharge is charged on the website but not on Etsy.** $2.50 on 2XL+ (`src/pages/ProductPage.tsx:452`, `src/pages/Checkout.tsx:1541`); Etsy variations are priced flat across S-3XL (`backend/services/etsy.ts:582`). *Verifiable from repo.* **David must decide which way to align — the FAQ copy deliberately says nothing until he does.**
- [ ] **Live listing image 1 is a generated mascot scene, not a real product photo** — the audit's highest-risk finding. *Verifiable from repo:* `CLAUDE_TASK.md:41-42`. **David must photograph real product and replace image 1.**
- [ ] **Shop title / current announcement text as actually stored** — set via API but the values were never recorded. *Cannot verify from repo.* **David must read them in the Etsy dashboard before overwriting.**
- [ ] **Garment blank brand/weight/blend, DTF wash-care sheet, tumbler size/material/care, real bulk price breaks and MOQ** — needed to finish the copy. *Cannot verify from repo — a full capability sweep found none of these, and the numbers that look like specs (`50+ washes`, `Heat Press 300°F, 15 seconds`, the wholesale tiers) are inside mock data blocks. Flagged inline as `[[DAVID: confirm]]`.*
- [ ] **Rush order upgrade must NOT be advertised on Etsy.** It's real ($7.99, before 2 PM ET) but hard-gated to local pickup/delivery only (`src/pages/Checkout.tsx:331,336`). *Verifiable from repo.* **No action needed — just don't add it later.**
