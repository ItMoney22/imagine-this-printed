# ITP local orders: Google profile + team/event shirt quotes (2026-10-28)

Watchtower task 8af55c3c (mia-potts), move 4 of Rico's sales diagnosis (c47c3e66,
`docs/sales/2026-10-28-why-itp-sells-little.md` on Rico's branch). **Everything here is a DRAFT.** Nothing is sent,
posted, printed or listed before David's yes on line 8 of **APPROVE: ITP money moves** (525d19e3).

Files in this folder: `flyer.png` (US Letter, 1275x1650 = 150 dpi), `flyer.html` (its source; every number is
sourced in the header comment), `qr-contact-custom.svg`, `rockmart-groups.md` / `.json` (the 30 groups).
Screenshots: `E:/memory/watchtower/projects/imagine-this-printed/2026-10-28-8af55c3c-local-orders/shots/`.

## 1. What Google Maps shows today (fleet browser, logged out, 2026-10-28 20:14Z)

- **There is no Google Business Profile for Imagine This Printed.** A Maps search for "Imagine This Printed Rockmart
  GA" returns other shops (Akins Printing, Georgia Vinyl and Thread, Twisted Line Designs ...).
- **"custom t-shirts Rockmart GA"** lists, in order: Georgia Vinyl and Thread (5.0, 16 reviews, screen printer,
  32 Prospect Rd), **Living Kolors Vinyl TShirts & More LLC (custom t-shirt store, 640 Goodyear Ave)**, Twisted Line
  Designs (255 N Marble St), Numinous Ink (tattoo), RBS Customs (5.0, 174 reviews, Merchants Dr), Southern Dream
  (4.6, 47), Sareegrafix.
- **Our own address already has a pin.** "640 Goodyear Ave" opens one place: *Living Kolors Vinyl TShirts & More
  LLC*, custom t-shirt store, "Floor 1", open until 6 PM, 2 photos (a storefront with an OPEN sign), no phone, no
  website, no reviews, **"Claim this business"** (nobody has claimed it), "Identifies as Black-owned". A web search
  found nothing else about that name. **David has to tell us whose it is** before a profile is made, because Google
  treats two shirt shops at one address as a possible duplicate, and a video verification has to show signage.

## 2. Google Business Profile draft

| Field | Draft | Source / note |
|---|---|---|
| Name | Imagine This Printed | must match the sign on the building (Google rule) |
| Primary category | Custom t-shirt store | the exact label Maps shows on 3 Rockmart competitors |
| More categories | T-shirt store; 3D printing service | confirm each in the category picker (Google publishes no master list) |
| Address | 640 Goodyear Ave, Rockmart, GA 30153 (add a suite/unit if Living Kolors is a separate business) | `WAREHOUSE_ADDRESS` |
| Shows address? | Yes, a storefront: customers come for free pickup | |
| Hours | 10:00 AM to 8:00 PM ET, **days to confirm** (the site never names days; the Living Kolors pin says 6 PM) | `PICKUP_HOURS` |
| Phone | (401) 323-9983 | Stripe support phone, already on the policy pages |
| Website | `https://imaginethisprinted.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp` | tags Google traffic once GA4 (49db0f22) lands |
| Service area | Rockmart and Polk County, 20 miles (local delivery reach) | `MAX_DELIVERY_RADIUS_MILES` |
| Photos | **None yet. Real photos only:** logo (have it), shop front with the sign, the work area, finished shirts on a table or a person | ties to the pass-1 shoot 2224bf29 |

**Description (under 750 characters; no links and no prices, which Google's description rules discourage):**

> Imagine This Printed is a small print shop at 640 Goodyear Ave in Rockmart, Georgia. We print custom t-shirts and
> hoodies, make 3D-printed gifts and toys, and sell plain tees in four qualities. Teams, churches, schools, family
> reunions and local businesses can tell us how many shirts, the sizes and the date they need them, and we write back
> with a price, usually within a day. Orders of 10 or more take 5 to 10 business days. Pickup at the shop is free,
> and we deliver within 20 miles of Rockmart.

**Services (no photo needed), real prices only:**

| Service | Price on the profile | Source |
|---|---|---|
| Team and event shirts, 12 or more | Free quote | /contact "A custom or big order" (there is no team price in the price module) |
| Printed tees (our designs) | $25 | `products.price` on 22 of 29 live shirts |
| Plain tees, no print | from $3.21 | /blanks |
| Hoodies | $35 to $44.99 | live products |
| 3D-printed gifts and toys | $15.99 to $24.99 | live products |
| Free local pickup | Free | shipping-calculator |
| Local delivery | $10 within 10 miles, $15 within 10 to 20 miles | `LOCAL_DELIVERY_TIERS` |

Products with photos wait for real photos.

**Verification (David's Google login, his step).** Google picks the method per profile. In 2026 most new storefronts
get a **video**: one continuous clip that shows the street and the sign outside, the work area inside (printer, heat
press), and proof you run it (unlocking the door, opening the register). Some still get a postcard (about 5 to 14
days). Sources are third-party guides (BrightLocal, Dalton Luka, Bluehost, dated 2026), so the screen in his account
is the truth. **If the sign outside says Living Kolors, a video for "Imagine This Printed" can fail.**

## 3. The note (one short plain message, same text to every group)

Email version (from wecare@imaginethisprinted.com; replies land in the shop inbox):

> **Subject:** Team shirts printed here in Rockmart
>
> Hi {group name},
>
> I'm {David or Christina} with Imagine This Printed, a print shop at 640 Goodyear Ave in Rockmart. We print shirts
> for local teams, churches, reunions and businesses: your logo, names and numbers, in adult and youth sizes.
>
> If you need 12 or more, send us how many, the sizes and your date, and we'll write back with a price, usually within
> a day. Orders of 10 or more take 5 to 10 business days, and pickup at the shop is free.
>
> You can ask at imaginethisprinted.com/contact (choose "A custom or big order"), reply to this email, or call
> (401) 323-9983. Our flyer is attached if you'd like to share it with your group.
>
> Thank you,
> {David or Christina}
> Imagine This Printed LLC, 640 Goodyear Ave, Rockmart, GA 30153
>
> If you'd rather not hear from us, reply "no thanks" and we won't write again.

Short version for a group's own contact form (under 500 characters):

> Hi! We're Imagine This Printed, a print shop at 640 Goodyear Ave in Rockmart. We print team and event shirts with
> your logo, names and numbers, adult and youth sizes. For 12 or more, tell us how many, the sizes and your date at
> imaginethisprinted.com/contact and we'll send a price, usually within a day. Pickup at the shop is free.
> Thank you! {name}, Imagine This Printed, (401) 323-9983

No discount, no coupon, no invented price. The address line and the "no thanks" line keep the email inside CAN-SPAM.

## 4. Does a 12+ shirt quote reach David? (checked 2026-10-28)

**It reaches the shop, not David.**

- The path that works for a team buyer is `/contact?topic=custom` ("A custom or big order"), no login. The flyer's QR
  opens it with that topic already picked (walked at 390 and 1400; the QR in `flyer.png` decodes to it).
- Jev triage files a team, church, reunion, rec-league or 12-work-shirt request as `bulk_quote`, priority high, never
  spam (5 of 5 sample messages through the production `triageTicket`, live Jev, 2026-10-28).
- The alert email goes to `SUPPORT_EMAIL`, which is **not set on Render** (API and worker), so the code default
  wecare@imaginethisprinted.com gets it. **wecare@ forwards only to Christina's Gmail** (`email_mailboxes.forward_to`),
  and Becky pings Christina's phone. **Nothing goes to David** (davidt@ forwards to his Gmail, but no alert uses it).
- `/wholesale` needs an account plus a company name and business type, so a booster-club parent won't use it. It also
  still shows two invented vendors (card 67755f9a, fix rides SHIP d7a4ccad).
- Fix filed as its own card: big-order (`bulk_quote`) tickets also email David. See the handoff for the id.

## 5. On David's yes (line 8)

1. David settles the Living Kolors question, then creates or claims the profile with his Google login and finishes
   verification (video or postcard). The agent pastes in the fields above and adds real photos as they exist.
2. The agent sends the note to the 30 groups: email rows from wecare@ through the shop's mail system, a few a day;
   contact-form rows through the group's own public form with the fleet browser. Facebook-only rows are a person's
   step from ITP's Facebook page (no bot on Facebook).
3. Replies come back to wecare@ (Christina's Gmail and the shop inbox). The agent logs each one on the list and the
   card: who answered, what they asked, quote sent or not.
4. Print the flyer for the counter and the pickup bag only after the yes.
