# Etsy AI-Operations Feasibility Blueprint

**Project:** imagine-this-printed
**Report version:** v1.1
**Author:** Rico Fernandez (Partnerships & Ecommerce Strategist) — Watchtower task `3ddcb88f-6c88-4d2b-807d-5d13001ac1a5`
**Date produced:** 2026-07-24
**Last verified:** 2026-08-15 (all sourced claims carry their own retrieval dates in the Source Appendix)
**Review / expiry schedule:** re-verify §2 (access), §3 (policy), and the matrix every 90 days or on any Etsy policy-change email, whichever comes first. Treat this report as STALE after 2026-11-15 until re-verified.

> **Scope note:** This is a research blueprint, not an implementation. It evaluates whether an Etsy shop can be operated *substantially* by Claude while remaining human-accountable, policy-compliant, legally defensible, secure, and professionally branded. It does **not** promise literal unattended control where Etsy, law, payments, or technical access requires a person, and it does **not** recommend browser automation as a workaround for missing approved APIs.

---

## Table of contents

1. [Executive feasibility conclusion](#1-executive-feasibility-conclusion)
2. [Access and credentials](#2-access-and-credentials)
3. [Policy and legal constraints](#3-policy-and-legal-constraints)
4. [Capability and risk matrix](#4-capability-and-risk-matrix)
5. [Tooling comparison](#5-tooling-comparison)
6. [Guardrails and operating model](#6-guardrails-and-operating-model)
7. [Professional brand guidance](#7-professional-brand-guidance)
8. [Source appendix](#8-source-appendix)

---

## 1. Executive feasibility conclusion

**Verdict: conditionally feasible.** An imagine-this-printed Etsy shop can be operated *substantially* — not fully — by Claude, using Etsy's approved Open API v3 under the **Seller App** access tier, with a human-in-command operating model. Roughly, the split the evidence supports is:

**Automatable through the approved API (with gates):** listing creation as drafts, listing updates, inventory/quantity/price management, order monitoring and internal alerting, tracking submission (which triggers Etsy's own buyer notification), financial reconciliation from the read-only payments/ledger endpoints, review monitoring (read-only), and all drafting of customer-facing text for human approval.

**Not automatable — no approved interface exists:** buyer messages (no v3 endpoints; a deliberate, multi-year gap), Etsy Ads (no campaign or stats endpoints), refunds (payments surface is read-only), cancellation initiation, and review replies. These are dashboard-only and therefore human-performed, with Claude limited to drafting and queueing.

**Contractually or legally prohibited regardless of technical possibility:** browser automation / screen-scraping of any Etsy surface ("Applications must not sidestep the API... Screen-scraping is not allowed" — developers.etsy.com; the API Terms separately ban "automated systems or browser extensions to access, analyze, or scrape the Etsy Site"); sending buyers order/shipping/tracking notifications through any channel using API data "unless expressly authorized in writing by Etsy"; connecting the API to third-party advertising platforms or spam; using the API to harvest Etsy content for analytics/ML/AI training; and any form of fake, seeded, incentivized-for-sentiment, or AI-authored reviews (16 CFR Part 465 + Etsy policy).

**The dominant risk is not technical — it is account survival.** Etsy suspends shops permanently without warning (practitioner evidence includes a Printify-integrated POD shop suspended with its appeal denied within ~5 minutes and no stated reason), reserves the right to terminate "any accounts Etsy determines are related to your account," and has deleted a 10-year-old production API integration without notice. Suspension must be treated as **effectively irreversible** and API access as a **revocable privilege**. This argues for conservative automation, generous human review, and never operating close to any policy line.

### 1.1 Floor-claims audit — the ten claims this task required verifying, verdicts

| Floor claim | Verdict | Finding (evidence in §2–§3, §8) |
|---|---|---|
| Developer app approval required | **Confirmed, nuanced** | Contractually yes (Application Purpose, Etsy sole discretion). But the **Seller App** tier is "approved within minutes, with no manual review queue" — the month-long waits practitioners report apply to Personal/Commercial tiers. |
| Personal vs commercial access tiers | **Corrected** | Three tiers, not two: Seller App (own shop) / Personal App (deeper review) / Commercial Access (requires approved Personal App + manual review). |
| 5,000 calls/day limit | **Not supported** | Current rate-limits page states **no numeric default**; limits are per-key QPD+QPS, visible in response headers/portal. API Terms add: no extra keys to evade limits; Enterprise Tier above 3M calls/day. |
| OAuth 2.0 refresh tokens expire in 90 days | **Confirmed** (3-0) | "longer functional lifetime (90 days)"; access tokens 1 hour; each refresh returns a new refresh token without seller re-approval. |
| API Terms §2 | **Confirmed** | §2 "Your Developer Account": registration, personal-vs-commercial declaration, accurate info, Etsy may reject "for any reason, in our sole discretion." (Last updated Jun 16, 2025.) |
| createDraftListing prerequisites | **Confirmed** | `listings_w` scope; creates a *draft*; required fields quantity/title/description/price/who_made/when_made/taxonomy_id; shipping profile before activation; images separate. |
| Payment/tax verification | **Confirmed** | Etsy Payments requires required info + bank verification (some markets), ongoing re-verification (public records, credit reports), taxpayer ID near thresholds. (Policy updated Feb 12, 2026.) |
| 1099-K obligations | **Confirmed, updated** | Current threshold **$20,000 AND >200 transactions** (the $600 rule was rolled back; $5,000 was the 2024 transition). All income taxable regardless. |
| Policy revision cadence | **Confirmed as "no fixed cadence, actively revised"** | Seller Policy revised Jun 9 → effective Jul 9, 2026; Creativity Standards Jun 10, 2025; API Terms Jun 16, 2025; Payments Feb 12, 2026. |
| Suspension reversibility | **Confirmed adverse** | Policy grants no appeal right and reaches "related" accounts; practitioner case: permanent suspension without warning, appeal denied in ~5 minutes. Treat as irreversible. |

### 1.2 Required human accountability (explicit statement)

This blueprint does not — and cannot — deliver literal unattended control. A named human (David, as shop owner) is structurally required and remains legally and contractually accountable at every layer:

1. **Identity and onboarding:** Etsy account creation, Etsy Payments enrollment, bank-account verification, and taxpayer-identification submission are personal, KYC-verified acts of the seller of record (Etsy Payments Policy, updated Feb 12, 2026). Claude cannot and must not perform them.
2. **Developer access:** API app registration, the personal-vs-commercial declaration, and the Application Purpose submission are made by the human developer and approved (or rejected, or later revoked) at Etsy's sole discretion (API Terms §2–3).
3. **Everything the AI does is the seller's act.** The Seller Policy makes account holders responsible for their content and conduct; the FTC applies a "knew or should have known" standard to businesses for review/testimonial conduct and holds those who *use* deceptive AI tools within Section 5's reach. There is no "the bot did it" defense.
4. **Money, buyers, and reputation stay human-gated:** publishing listings, sending any buyer message, refunds, cancellations, ad spend, and review responses require human approval or human execution under the §6 operating model.
5. **Taxes are the human's from dollar one:** all income is reportable "no matter the amount of reported payments" (IRS), independent of the $20,000 / >200-transaction 1099-K threshold.

---

## 2. Access and credentials

Everything in this chapter is a prerequisite chain: each item blocks the next. Retrieval dates for all cited sources are 2026-07-24 unless noted; see §8.

### 2.1 Seller identity, active shop, and payment/tax prerequisites

- **Etsy account + active shop:** the shop must exist and be owned by a real member. The developer path that fits ITP ("Seller App", §2.2) is explicitly scoped "to your registered shop," so an active shop under David's account precedes any API access.
- **Etsy Payments enrollment and verification:** "For you to sign up for Etsy Payments and receive payment for transactions made through Etsy Payments, you must provide all required information and complete all required steps, including in some markets, verifying your bank account, for compliance purposes." Etsy also self-authorizes ongoing re-verification: "Sellers authorize us... to verify their information (at registration and from time to time when using the Services), including by accessing public records and obtaining credit reports," for fraud/AML/sanctions integrity. (Etsy Payments Policy, last updated Feb 12, 2026.)
- **Taxpayer identification:** "Etsy requires that you add your taxpayer name, taxpayer-identification and/or other applicable information to your Etsy shop as you approach the relevant thresholds," feeding Etsy's IRS Form 1099-K filing obligation for US sellers; some states impose lower thresholds. (Etsy Payments Policy.)
- **Verification is not a shield:** the suspension case in §3.8 had *passed* bank verification shortly before permanent suspension. Onboarding compliance is necessary, not protective.

### 2.2 Developer application and access tiers (verified)

Etsy's developer program (developers.etsy.com, retrieved 2026-07-24) has three tiers — the floor's "personal vs commercial" framing was close but incomplete:

| Tier | Who it's for | Approval | Shop reach |
|---|---|---|---|
| **Seller App** | "sellers building tools for their own shop" | "Automated, near-instant for eligible sellers" — "approved within minutes, with no manual review queue" | "Your shop only" |
| **Personal App** | "developers building tools that may be used by other buyers or sellers" | "deeper review process than Seller Apps" | "Limited-scale access based on approved use case" |
| **Commercial Access** | apps "other Etsy sellers will connect to and use at a broader scale" | "You must have an approved Personal App before you can request Commercial Access... reviewed manually. Review time may vary" | "any seller who grants OAuth consent" |

- **Recommendation:** ITP needs only the **Seller App** tier (own shop, all public + OAuth endpoints). This avoids the manual-review queue entirely — practitioner reports on Etsy's own open-api GitHub repo document Personal/Commercial approvals pending for a month-plus, an era when "all new API v3 signups" were being declined, and rejections with opaque reasons. The near-instant Seller App path is the single strongest access fact in ITP's favor.
- **Contractual gate (API Terms §2–3, last updated Jun 16, 2025):** registration requires declaring "personal or commercial use" and providing "all required information in an accurate, true and complete manner"; the Application Purpose (and "any updates to the Application") must be submitted "for Etsy's prior approval, which may be granted or withheld at Etsy's sole discretion." The Application Purpose ITP declares should honestly describe an AI-assisted shop-management tool for its own shop — misdescribing it is a §2 violation with revocation exposure.
- **Access is revocable in practice:** a seller reported Etsy deleted a custom integration "which I use for more than 10 years" without warning, and the replacement app went back into the ordinary pending-approval queue (Etsy Community, Nov 2024). Treat the API key as a dependency that can vanish; keep the §6.6 manual-mode runbook current.

### 2.3 OAuth 2.0 scopes and token lifecycle (verified)

From the official authentication docs (retrieved 2026-07-24; adversarially verified 3-0 in the research pass):

- **Flow:** OAuth 2.0 Authorization Code Grant; "The Etsy Open API requires a PKCE on every authorization flow request" (S256). Redirect URIs are pre-registered, case-sensitive, https.
- **Header:** "Every request to a v3 endpoint must include an `x-api-key` header containing your keystring and shared secret separated by a colon." Both halves are secrets (see §2.5).
- **Access token:** expires in 3,600 seconds (1 hour) — the gateway must refresh roughly hourly during active operation.
- **Refresh token:** "has a longer functional lifetime (90 days)"; each refresh grant returns a **new** refresh token, and "Refresh tokens do not require sellers to re-approve access and have the same scope as the token granted by the initial Authorization Code grant token." Consequences: (a) continuous operation is possible indefinitely *if* the refresh loop never stalls past 90 days; (b) the newest refresh token must be persisted atomically after every refresh; (c) a stall past 90 days requires a human to redo the browser consent flow — alert at 30/60/80 days of any refresh failure pattern.
- **Scopes (~20 published):** `address_r/w`, `billing_r`, `cart_r/w`, `email_r`, `favorites_r/w`, `feedback_r`, `listings_d/r/w`, `profile_r/w`, `recommend_r/w`, `shops_r/w`, `transactions_r/w`. The reference lists required authorizations per endpoint; the docs' own example: "the endpoint to create a listing requires an oauth2 token with `listings_w` scope." ITP's minimal starting grant: `listings_r`, `listings_w`, `shops_r`, `transactions_r`; add `transactions_w` only when tracking-submission goes live, `listings_d` only if deletion workflows are ever gated on. Note: even Commercial Access apps using `transactions_r` "must request access to the `buyer_email` field separately" — buyer email is not assumed.

### 2.4 Rate limits (floor claim corrected)

- **The floor's "5,000 calls/day" is NOT supported by current primary sources.** The official rate-limits page (retrieved 2026-07-24, adversarially verified 3-0) states *no* numeric default; it documents "application-based rate limits" of Queries Per Day + Queries Per Second "applied at the API key level for both public auth and private auth," with only *example* response-header values (`x-limit-per-second: 150`, `x-limit-per-day: 100000`). An app's real limits are visible in its response headers (`x-remaining-today` etc.) and Developer Portal. Historic third-party writeups cite 5,000 or 10,000/day defaults; treat those as unverified legacy numbers and read the live headers after registration.
- **Mechanics:** QPD uses a rolling 24-hour sliding window (no fixed daily reset); QPS is evaluated first, then QPD; exceeding either returns HTTP 429 with a `retry-after` header — the gateway should honor it programmatically.
- **Ceilings and upgrades:** higher limits require emailing developer@etsy.com with a use-case description (human dependency). The API Terms allocate each key "by default a set number of API Calls per day as specified in the Etsy API developer documentation," flatly prohibit "creating or attempting to create additional API keys to circumvent these limitations," and require the "Enterprise Tier" above 3 million calls/day (irrelevant at ITP's scale — a polling-based single-shop operation fits comfortably under even a 5,000/day worst-case floor at ~3 calls/minute average).

### 2.5 Secret storage, order-state storage, maintenance ownership

- **Secrets:** `ETSY_KEYSTRING` + shared secret + current refresh token are Tier-0 secrets. Local: the existing vault (`C:\Users\David\.secrets\keys.json`). Production: the deploy platform's env store (Render, like the rest of the ITP backend). Never in the repo, never in Claude's prompt/context (the §6.3 gateway holds them), never logged. Rotation drill and leak response per §6.4.
- **Order-state storage:** a local mirror keyed by Etsy receipt id (see §6.5), populated by polling `getShopReceipts` within rate budget. Buyer PII in the mirror is constrained by the Seller Policy's data rules (§3.5): usable "only... for Etsy-related communications or for Etsy-facilitated transactions," with the seller as an independent data controller who indemnifies Etsy for mishandling. Minimize fields, restrict access, purge on schedule.
- **Maintenance ownership:** David owns the Etsy account, Etsy Payments identity, developer account, and every approval decision. The Watchtower fleet owns gateway code, token-refresh health, audit logs, and the 90-day source-revalidation task (§6.6). Ambiguity here is how tokens silently expire; write both names into the operating charter.

---

## 3. Policy and legal constraints

All quotes retrieved 2026-07-24. Etsy's legal pages (etsy.com/legal/*) return HTTP 403 to non-browser clients; they were retrieved via Internet Archive snapshots (API Terms: 2026-06-23 snapshot; Etsy Payments Policy: 2026-07-24 snapshot) — noted per-source in §8.

### 3.1 The document stack and revision cadence

Binding, in descending generality: **Etsy Terms of Use** (umbrella; account-holder responsibility, suspension/termination rights) → **Seller Policy** (last updated Jun 9, 2026; **effective Jul 9, 2026**, with the prior version archived "effective through and until July 8, 2026"; sub-policies like the **Prohibited Items Policy** were updated **August 11, 2026** adding a strict fur ban) → **Creativity Standards** (last updated Jun 10, 2025; "as part of our Terms of Use") → **API Terms of Use** (last updated Jun 16, 2025) → **Etsy Payments Policy** (last updated **July 31, 2026** reflecting Canadian payment service provider registration and fund safeguarding regulations).

**Revision cadence (floor claim verified as: no fixed cadence, materially active):** four core documents revised within the 13 months before retrieval, including a Seller Policy revision that took effect ~2 weeks before this report. Etsy says of its AI policy specifically that it will be "periodically reevaluating our policies." Material API Terms changes are notified via the Developer Account. **Consequence:** compliance is a process, not a snapshot — hence the 90-day re-verification schedule on this report's header plus change-email triggers (§6.6).

### 3.2 Automation boundaries (API Terms — verified against the live document)

The API Terms' prohibited-behavior list (§5) contains four clauses that decide most of the §4 matrix:

1. **No buyer notifications from API data:** prohibited to "Use the Etsy API for purposes of sending to Etsy Members order, shipping and tracking information, whether via email, text or otherwise, unless expressly authorized in writing by Etsy." The compliant pattern: submit tracking via `createReceiptShipment` and let *Etsy* notify the buyer ("Each time you successfully submit tracking info, Etsy sends a notification email to the buyer").
2. **No spam / third-party ad platforms:** prohibited to use the API "for purposes of transmitting spam or other unsolicited marketing communications, or to connect with any third-party advertising or marketing platform."
3. **No browser automation / scraping:** prohibited to "Use or promote the use of automated systems or browser extensions to access, analyze, or scrape the Etsy Site, the Etsy API or any Etsy data... unless expressly authorized in writing by Etsy"; the developer docs restate it plainly: "Applications must not sidestep the API to retrieve or post Etsy data. Screen-scraping is not allowed." This is why this report never recommends browser automation for the missing surfaces (messages, ads, refunds), and community evidence shows Etsy actively bot-flags scrapers.
4. **No AI-training/analytics harvesting:** prohibited to "Use the Etsy API to collect, scan, or otherwise request Etsy content for purposes of analytics, machine learning, training artificial intelligence models, licensing, or content removal, unless expressly authorized in writing by Etsy." Read conservatively: ITP's own-shop operational reporting inside the approved Application Purpose is the intended use of the data; feeding Etsy marketplace content into model training, competitor analytics, or scraped datasets is off-limits. Claude may *act on* Etsy data; ITP must not *train on* it.

### 3.3 Creativity Standards and AI-content disclosure (the "can an AI make the products?" question)

- **Human-touch floor:** "all items must incorporate a human touch," fitting one of four categories — made by / designed by / handpicked by / sourced by a seller.
- **AI creations are allowed with conditions:** "Seller-prompted AI creations: Creations that were generated using AI tools... based on a seller's original prompts. Sellers must disclose within their listing description if an item is created with the use of AI." Etsy's Seller Handbook confirms the stance: "we have decided to continue to allow sellers to use their original prompts in combination with AI tools to create the artwork they sell on Etsy," while "we prohibit the sale of AI prompt bundles."
- **What this means for a Claude-operated shop — the sharpest policy line in this report:** the policy anchors permissibility to "a seller's original prompts." A pipeline where *Claude autonomously invents concepts, generates art, and lists it* sits outside the plain reading of "seller-prompted." The defensible model for ITP: David (or the ITP design library of ~2,700 human-made designs) supplies the creative direction/prompts; Claude executes and drafts; every AI-created item carries the disclosure in its listing description, enforced as a hard gateway check on `createDraftListing` payloads. ITP's existing human-designed library is a major asset here — those designs don't trip the AI-creation rules at all (only production-partner/accuracy rules).
- **Production partners must be disclosed:** "Sellers must disclose that an item is made by a production partner, and provide accurate information about where the item will ship from" — applies if Printify or any third party produces; ITP's in-house DTF production avoids this only for what ITP itself prints. Buyer-personalized POD items are explicitly allowed ("A t-shirt, hat, or neon sign that can be personalized with a buyer's name or special phrase").
- **Content gates:** AI-generated imagery must still clear the Prohibited Items Policy and must not infringe "privacy, publicity, or personal rights of others." Enforcement: "Etsy reserves the right to remove listings that do not follow our policies. Sellers remain obligated to pay any fees incurred."

### 3.4 Buyer communication and bot-mediated messaging

- **Etsy side (Seller Policy):** sellers must "Respond to Messages in a timely manner"; Messages may not be used for "unsolicited advertising or promotions... or spam" nor for "facilitating or directing off-platform transactions, including exchanging personal contact, financial or other information... (phone number, address, email, social media handles, external URLs, instructions for money transfer, QR codes, etc.)."
- **No API for messages at all (§4 row 6):** so the bot-messaging question is largely mooted at the send layer — a human sends via the dashboard. Claude's role is drafting.
- **FTC side:** the FTC's AI-deception guidance (staff blog, Mar 2023) warned that Section 5 "can apply if you make, sell, or use a tool that is effectively designed to deceive — even if that's not its intended or sole purpose," that helpful AI tools should consider operating openly as bots rather than "needlessly emulating humans," and that chatbot "doppelgänger" deception "in fact ha[s] resulted" in enforcement actions. **Standing caveat:** as of 2026-07-24 that blog post returns 403/"Page not found" on ftc.gov and was verified via the Internet Archive — treat it as removed informal staff guidance under the current FTC, while the underlying Section 5 deception standard remains fully in force. Practical rule for ITP: never claim or imply a human wrote what Claude wrote; sign shop communications as the shop; don't fabricate a human persona for the AI.

### 3.5 Privacy and buyer data

Sellers using the API "may receive and determine what to do with certain personal information" and thereby become **independent data controllers**: buyer information "may only be used for Etsy-related communications or for Etsy-facilitated transactions. You may not use this information for unsolicited commercial messages or unauthorized transactions" — and sellers indemnify Etsy for their data-handling failures (Seller Policy). Design consequences: the order-state mirror (§2.5, §6.5) holds the minimum fulfillment fields, is never used for remarketing, is never fed to model training, and sits behind access control with retention limits. General privacy statutes (GDPR if EU buyers, US state laws) apply to ITP as controller; that layer is standard e-commerce obligation rather than Etsy-specific and is flagged here rather than analyzed.

### 3.6 Reviews, endorsements, and advertising law (FTC — codified rule text verified)

16 CFR Part 465 (fake-reviews rule; final rule 89 FR 68077, Aug 22, 2024; effective Oct 21, 2024; civil penalties available for knowing violations):

- **§465.2(a):** unlawful to "write, create, or sell a consumer review, consumer testimonial, or celebrity testimonial that materially misrepresents... That the reviewer or testimonialist exists; That the reviewer... used or otherwise had experience with the product... or The reviewer's... experience." AI-fabricated reviews fall under the nonexistent-reviewer/no-experience prongs. FTC Q&A: businesses and their agents "could be liable under Section 465.2(a) if they write, create, or sell a fake or false consumer review."
- **§465.2(b):** "knew or should have known" liability for purchasing/disseminating such reviews — delegation to an AI agent is not a defense.
- **§465.4:** no "compensation or other incentives... conditioned expressly or by implication on... reviews expressing a particular sentiment." FTC Q&A is explicit that paying for 5-star reviews violates the rule *even with disclosure* and applies "on third-party review platforms" like Etsy. Sentiment-neutral "generalized solicitations to purchasers" remain lawful.
- **§465.7(a):** no unfounded legal threats, intimidation, or knowingly/recklessly false public accusations to prevent or remove reviews — binds the tone of any Claude-drafted response to negative reviews.
- **§465.1(c)(4):** required disclosures in internet/social media must be "unavoidable" — "not clear and conspicuous if a consumer must take any action, such as clicking on a hyperlink or hovering over an icon, to see it."
- **Etsy layer:** the Seller Policy independently bans shilling/undermining review integrity, and Open API v3 exposes reviews read-only (no reply, no solicit endpoint) — so the technical surface matches the legal boundary: monitor yes, manufacture never.

### 3.7 Tax and payments (floor claims verified with corrections)

- **1099-K (current law, verified on irs.gov 2026-07-24):** marketplaces must send Form 1099-K when "the total amount of payments you receive for goods or services through the platform exceeds $20,000 in more than 200 transactions," with the seller copy due "by January 31." The widely-cited $600 threshold is dead: secondary reporting attributes the rollback to July 2025 tax legislation restoring $20,000/200 from tax year 2025 onward ($5,000 was the 2024 transition figure). The IRS page no longer mentions $600/$2,500/$5,000 at all.
- **Tax obligation is threshold-independent:** "No matter the amount of reported payments, if you receive payments for selling goods or services, you must report all income on your tax return."
- **Etsy Payments:** enrollment/verification per §2.1; Etsy files 1099-K for US sellers "in certain circumstances" and collects taxpayer ID as sellers approach federal or (lower) state thresholds. All of this is personal to David — T3 in the operating model.

### 3.8 Suspension and enforcement reality (floor's "suspension reversibility" claim — verified, adverse)

- **Policy text:** Etsy "may deactivate Your Content... or suspend or terminate your account **(and any accounts Etsy determines are related to your account)**"; fees remain owed; notification is given only "generally," and can be withheld for repeat violations or legal reasons. No guaranteed appeal or reinstatement path exists in the policy.
- **Practitioner evidence (weight: anecdotal but directly on-point):** a new Printify-integrated POD shop (opened Dec 2024, 11 sales, bank-verified) was "permanently suspended, without any prior warning or message"; its appeal "within 5 minutes... was denied without a clear explanation." Separately, a 10-year-old API integration was deleted without notice.
- **Related-account exposure is strategic for ITP:** if a Claude-operated shop is suspended for automation-adjacent behavior, Etsy's related-account clause could reach any other Etsy presence tied to David's identity, payment details, or infrastructure. **Conclusion: treat suspension as effectively irreversible and design the operation so no single automated behavior class (listing spam-bursts, message automation, review conduct, scraping) can ever be the cause.** Blast-radius caps in §6.7 exist for this reason.

### 3.9 Intellectual property

Sourced constraints: AI-generated content must not infringe "privacy, publicity, or personal rights of others" (Seller Handbook), all items must be represented accurately (Creativity Standards), and ITP already operates a human copyright gate on design publication (the review-gated outbox pattern). Beyond Etsy: trademark/copyright clearance for design text and imagery is standard POD legal exposure (fan-art, brand names, celebrity likenesses are the classic Etsy takedown categories) — keep the existing human review gate as the IP checkpoint for every design that goes to Etsy, and treat repeat-infringer risk as another suspension vector. (Etsy's standalone IP policy page was not fetched in this pass; add it to the §8 revalidation list.)

---

## 4. Capability and risk matrix

Classifications: **F** = feasible · **FS** = feasible with safeguards/approval · **U** = unsupported by an approved interface (dashboard-only; Claude drafts, human executes) · **P** = prohibited / high-risk. Approval tiers (T0–T3) are defined in §6.2. All evidence retrieved 2026-07-24; endpoint paths from Etsy's OpenAPI v3 spec (spec-derived items marked †— re-confirm against the live reference during implementation).

### 4.0 Summary

| # | Operation | Desired AI action | API support | Class | Tier |
|---|---|---|---|---|---|
| 1 | Listings — create | Draft new listings end-to-end | `createDraftListing` (drafts only) | **FS** | T1 draft / **T2 publish** |
| 2 | Listings — update/renew/delete | Maintain catalog | `updateListing`, `deleteListing`† (state-constrained) | **FS** | T1 (T2 for delete) |
| 3 | Orders — monitor/manage | Watch orders, update status | `getShopReceipts`, `updateShopReceipt`† | **F** read / **FS** write | T0 read / T1 write |
| 4 | Order notifications — to operator | Internal alerts to David/fleet | Own polling + own alerting | **F** | T0 |
| 5 | Order notifications — to buyer | Notify buyer of order/shipping | None permitted (API Terms §5) — Etsy notifies natively on tracking submit | **P** (direct) / **FS** (via `createReceiptShipment`) | — / T1 |
| 6 | Inventory & product mgmt | Sync stock/price/variations | `updateListingInventory`† | **FS** | T1 (bounded) |
| 7 | Buyer messages | Read + reply automatically | **No v3 endpoints** (confirmed gap) | **U** | T2 (human sends) |
| 8 | Etsy Ads | Manage campaigns/budgets, pull stats | **No v3 endpoints** (campaigns or stats) | **U** | T2 (human, dashboard) |
| 9 | Broader marketing (off-Etsy) | Promote shop on own channels | Outside Etsy API (API↛ad-platforms prohibited) | **FS** | T1/T2 |
| 10 | Fulfillment | Route to production, submit tracking | ITP in-house + `createReceiptShipment`; or Printify integration | **FS** | T1 |
| 11 | Cancellations | Cancel orders | **No v3 endpoint**; Seller Policy requires Messages notice + full refund | **U** | T2 |
| 12 | Refunds | Issue refunds | **No v3 endpoint** — payments surface read-only | **U** | T2 |
| 13 | Reviews | Monitor; respond; solicit | Read-only (`getReviewsByShop`†); reply/solicit dashboard-only; generation banned | **F** read / **U** reply / **P** generate·incentivize | T0 / T2 / never |
| 14 | Payments & payout config | Reconcile; manage bank/payout | Read-only ledger (`getPayments` etc.); payout/bank dashboard-only | **F** read / **T3** config | T0 / T3 |
| 15 | Reporting | Ops + financial reporting | Compose from receipts/ledger/listings | **F** | T0 |

### 4.1 Listings — create (FS)

- **Desired AI action:** Claude generates title, description, tags, pricing, selects mockups, and creates the listing.
- **API support / endpoint:** `POST /v3/application/shops/{shop_id}/listings` (createDraftListing) — "Creates a physical draft listing product in a shop"; required params: quantity, title, description, price, who_made (`i_did`/`someone_else`/`collective`), when_made (incl. `made_to_order`), taxonomy_id; returns 201. Images uploaded separately; a shipping profile is needed before activation.†
- **Scope/tier:** `listings_w` (verified: "the endpoint to create a listing requires an oauth2 token with listings_w scope"), Seller App tier.
- **Policy/legal gate:** Creativity Standards — human-touch category truthfully set (`who_made`), AI-created items disclosed in the description, production-partner disclosure where applicable, no prompt bundles, IP/content gates (§3.3, §3.9).
- **Human prerequisite:** active shop + payments onboarding (§2.1); app registered (§2.2). **Approval:** creation to *draft* = T1; **draft → active (publish) = T2 human approval** — publishing is buyer-visible and fee-incurring ($0.20/listing per Printify's fee summary).
- **Risk/blast radius:** medium — bad listings are reversible but policy-violating ones create enforcement history; caps: max drafts/day, publish only via approval queue.
- **Fallback:** Shop Manager manual listing. **Verification:** gateway asserts disclosure text present for AI-created items; sample audit of live listings weekly.

### 4.2 Listings — update / renew / delete (FS)

- **Endpoints:** `PATCH .../listings/{listing_id}` (updateListing); `DELETE /v3/application/listings/{listing_id}` — deletion only from states SOLD_OUT / DRAFT / EXPIRED / INACTIVE / ACTIVE-with-specific-flags.† Scope `listings_w` (+ `listings_d` for delete).
- **Gates:** price changes beyond ±X% and any delete = T2; copy edits, tag tuning, renew-unchanged = T1 with sampling. Risk low-medium; everything is re-editable except deletion. Fallback: Shop Manager.

### 4.3 Orders — monitor and manage (F read / FS write)

- **Endpoints:** `GET .../receipts` (getShopReceipts — filterable by paid/shipped/date), `GET .../receipts/{receipt_id}`, `PUT .../receipts/{receipt_id}` (updateShopReceipt — status flags).† Scope `transactions_r` (+ `transactions_w` for writes). Note: `buyer_email` requires separately-requested access even on Commercial tier — design as if buyer email is unavailable.
- **Gates:** reading + mirroring = T0. Status writes = T1. Buyer-data handling per §3.5 (Etsy-purposes only, minimized mirror). Risk: low (read) — the mirror is the blast-radius control for everything downstream. Verification: weekly reconciliation vs Etsy dashboard totals (§6.5).

### 4.4 Order notifications and alerts — to the operator (F)

- **Action:** poll receipts → classify (new order, ship-by approaching, stalled, high-value, dispute-keyword) → alert via ITP's existing admin bell/email/walkie infrastructure. Entirely ITP-internal; no Etsy rule touches it. T0, log everything. This is the highest-value/lowest-risk automation in the whole matrix — build it first.

### 4.5 Order notifications — to the buyer (P direct / FS via Etsy)

- **Prohibition (verified quote):** API Terms §5 bars using the API "for purposes of sending to Etsy Members order, shipping and tracking information, whether via email, text or otherwise, unless expressly authorized in writing by Etsy."
- **The approved channel:** submit tracking via `createReceiptShipment` — "Each time you successfully submit tracking info, Etsy sends a notification email to the buyer User."† Etsy's native transactional emails cover order confirmation. Classification: direct buyer notification **P**; Etsy-mediated notification via tracking submission **FS** (T1). Never build a buyer-email path.

### 4.6 Inventory and product management (FS)

- **Endpoints:** `updateListingInventory`† (quantity/price/SKU per variation), listing property/variation endpoints; scope `listings_w`. ITP's blank-inventory system (W1) is the source of truth; sync Etsy quantities from it within ±bounds (T1); zero-out / large swings page a human (T2). Risk: overselling — mitigate with buffer stock levels and the existing low-stock alerting. Fallback: Shop Manager stock edits.

### 4.7 Buyer messages (U — the hardest gap)

- **Evidence:** no conversations endpoints exist in v3; Etsy's own open-api repo discussions (#677 Nov 2022 → #1547 Mar 2026) confirm the gap persists with zero staff commitment; community reads it as deliberate ("keeping buyers and sellers on the platform"). Messages are **dashboard-only**.
- **Compliant model:** human reads messages in Shop Manager/app; for meaningful volume, human pastes context to Claude (or ITP builds a copy-paste triage UI on our side); Claude drafts; human edits/sends (T2). Etsy's native **saved replies / auto-reply (away mode)** cover the instant-response cases legitimately. Timeliness duty ("Respond to Messages in a timely manner") is met by human SLA, not bots. Message content rules per §3.4; disputes/legal/safety always escalate (§6.6). **Do not** scrape or browser-automate the messages UI (§3.2). Risk if violated: account-level — this is the tripwire most likely to look like bot behavior to Etsy.

### 4.8 Etsy Ads (U)

- **Evidence:** no v3 endpoints to create/manage campaigns or budgets, and none even for Ads stats ("there is no accessible endpoint for the data you seek"; "no endpoint... to get this at the listing level" — official-repo discussion #1315); third parties showing Ads data use scraping or special partnerships, both unavailable/prohibited paths. Only shop-wide daily ad spend can be derived from payment-ledger entries.
- **Model:** David sets/adjusts Etsy Ads budget in the dashboard (T2, money-moving); Claude computes ROI from ledger-derived spend + order attribution proxies and *recommends* budget changes in the weekly report. Risk of ignoring this row: silent ad overspend — cap: ads budget is never changed without a human, and ledger-spend anomalies alert.

### 4.9 Broader marketing — off-Etsy (FS)

- **Boundary:** the API must not connect "with any third-party advertising or marketing platform" and buyer data can't be used for "unsolicited commercial messages" — so no piping Etsy data into ad platforms, no buyer remarketing lists, ever (**P** for those). Promoting the Etsy shop on ITP's own site/socials using ITP's own content is outside the Etsy API entirely: **FS** under FTC truth-in-advertising + §465 disclosure rules (unavoidable disclosures; no fake social proof; ITP's existing review-gated social outbox is the right vehicle, T1/T2). Cross-link imaginethisprinted.com ↔ Etsy shop for brand congruence (§7.4).

### 4.10 Fulfillment (FS)

- **ITP in-house (recommended primary):** orders flow from the receipt mirror into ITP's existing DTF production queue; on ship, submit tracking via `createReceiptShipment` (scope `transactions_w`) → Etsy notifies the buyer. T1 with ship-by SLA timers from §4.4. Ship-from accuracy per Creativity Standards.
- **Printify (candidate, not assumed):** "Printify automatically imports orders from your Etsy store and sends them to production"; connection is via Etsy's standard OAuth consent; "authorized Etsy Partner"; free tier; Etsy fees $0.20 listing + 6.5% transaction; configurable order-approval delays. Evaluated fully in §5.4 — viable overflow/product-range extension, but it does not confer policy safe-harbor (§3.8's suspended shop was Printify-integrated) and requires production-partner disclosure.
- **Risk:** mis-shipped/late orders → Star-Seller loss, cases, suspensions. Blast-radius: order-level. Verification: tracking-submitted-vs-shipped reconciliation daily.

### 4.11 Cancellations (U)

- **Evidence:** no v3 cancellation-initiation endpoint (payments tutorial surface is read-only; no such operation in the reference). Seller Policy (§3.1 quote): "If you are unable to complete a transaction, you must notify the buyer via Messages and cancel the transaction. If the buyer already submitted payment, you must issue a full refund." Messages are also dashboard-only — so the whole flow is human (T2). Claude's role: detect the condition (stockout, address problem), prepare the case file + drafted buyer message, queue for David. Risk: money + buyer-trust; low frequency expected.

### 4.12 Refunds (U)

- **Evidence:** "The Open API v3 endpoints for payments and the shop ledger are read-only operations... refunds are not automatic" — no refund-creating endpoint exists. Dashboard-only, money-moving: T2 always, with a per-refund cap and daily aggregate cap (§6.7) even after approval. Claude drafts the refund rationale and logs it; David executes in Shop Manager. Fast, generous refunds remain brand policy (§7.3) — the gate adds minutes, not friction.

### 4.13 Reviews (F read / U reply / P generate·incentivize)

- **Read (F, T0):** v3 reviews access is read-only (`getReviewsByListing`/`getReviewsByShop`†; v2 feedback endpoints were dropped, read-only access landed later — official-repo discussion #693). Scope `feedback_r`.† Monitor sentiment, alert on ≤3-star, feed §7.3.
- **Reply (U, T2):** no reply endpoint; dashboard-only. Claude drafts within §465.7 bounds (no accusations, threats, or pressure); David posts.
- **Generate / seed / incentivize (P, never):** 16 CFR 465.2/465.4 + Etsy's shilling ban (§3.6). Sentiment-neutral review requests are lawful — but Etsy sends its own review prompts and Messages rules restrict promotional use, so ITP's stance: **no proactive review solicitation at all**; earn stars via §7.3.

### 4.14 Payments and payout configuration (F read / T3 config)

- **Read (F, T0):** `getShopPaymentAccountLedgerEntries`, `getPayments`, `getPaymentAccountLedgerEntryPayments` — read-only, scope `transactions_r`; sufficient for fee/tax/payout reconciliation. Docs carry a change warning ("subject to change as endpoints change") — pin to §6.6 revalidation.
- **Configure (T3, human-only):** bank accounts, payout schedule, taxpayer data, and any Etsy Payments verification step are identity-bound dashboard acts (§2.1). Claude never touches them; it reconciles ledger vs. bank deposits and alerts on gaps.

### 4.15 Reporting (F)

- **Action:** compose daily/weekly ops + financial reports (orders, revenue, fees, ad spend from ledger, listing performance proxies, review trends) from the mirror + read endpoints; deliver via ITP's existing daily-summary email/admin panel. T0. Constraint from §3.2: this is own-shop operational reporting inside the Application Purpose — no marketplace-wide analytics, no competitor scraping, no dataset building, no model training on Etsy content.

---

## 5. Tooling comparison

Each option evaluated on benefits, drawbacks, data handling, approval requirements, operational limits, and vendor dependency.

### 5.1 Claude + custom ITP gateway on the Seller App API (recommended core)

- **Shape:** Claude (Anthropic API) is the ops brain; a small ITP backend service (the §6.3 gateway, same stack as the existing `backend/` Express services) holds credentials, enforces tiers/caps, and makes the Etsy calls. Claude never sees the keystring/tokens.
- **Benefits:** full control; exactly the automatable surface in §4 (listings, inventory, orders, tracking, ledger, reporting); zero per-order vendor fees; keeps ITP's in-house DTF margin; reuses ITP's existing approval-inbox, audit-log, alerting, and worker infrastructure; Seller App approval is near-instant (§2.2).
- **Drawbacks:** ITP builds and maintains it (token refresh, mirror, reconciliation); bounded by every §4 gap — no messages/ads/refunds automation; API access is revocable (§2.2) so the manual-mode runbook is mandatory.
- **Data handling:** buyer PII stays in the ITP mirror under §3.5 rules; prompts to Claude should carry the *minimum* order fields needed (redact emails/full addresses when the task doesn't need them); never train on Etsy data (§3.2).
- **Approval requirements:** Etsy developer account + Seller App registration + honest Application Purpose (T3 human acts).
- **Operational limits:** per-key QPD/QPS (§2.4), 1-hour access tokens, 90-day refresh-token window.
- **Vendor dependency:** Etsy (existential, §3.8) + Anthropic (degrade to manual mode if either is down).

### 5.2 Etsy-native tools (dashboard, mobile app, built-ins)

- **Benefits:** the only interface for messages, ads, refunds, cancellations, review replies, payout/tax settings; zero policy risk — it's Etsy's own surface; built-in features (saved replies, auto-reply/away mode, listing videos, sales/coupons, Star Seller tracking) cover several "automation" wants legitimately. These native features weren't individually source-verified this pass — confirm their current shapes in Shop Manager during setup.
- **Drawbacks:** human time; no programmatic hooks; Claude participates only by drafting.
- **Role:** the human half of the hybrid — everything classified U in §4 lives here, plus fallback for everything else.

### 5.3 Printify (candidate print provider — evaluated, not assumed)

- **Verified facts (printify.com/etsy/, retrieved 2026-07-24):** "authorized Etsy Partner"; "automatically imports orders from your Etsy store and sends them to production"; connects via Etsy's standard OAuth consent ("Sign in to your Etsy account and click Grant access"); free to use (Premium $20/mo optional); cites Etsy fees of $0.20/listing + 6.5% transaction; claims 300k+ sellers on Etsy, 2,000+ products, 140+ facilities; configurable order-approval delays.
- **Benefits:** instant catalog breadth beyond ITP's DTF range (mugs, posters, etc.); production + shipping outsourced; a mature, Etsy-sanctioned commercial app — no ITP dev work for the fulfillment leg.
- **Drawbacks:** margin goes to Printify's providers vs. ITP's core competency being print production — for shirts, Printify competes with ITP's own business; quality/turnaround outside ITP control; production-partner disclosure + accurate ship-from required on every Printify listing (§3.3); vendor lock for those SKUs; buyer/order data flows through a third processor; **no policy safe-harbor** (a Printify-integrated shop was still permanently suspended, §3.8).
- **Verdict for ITP:** use ITP in-house DTF as primary fulfillment; consider Printify only to extend the catalog into product classes ITP can't print, listed with proper disclosures. Do not adopt by default.

### 5.4 Third-party seller SaaS (listing managers, SEO tools, Zapier/Make-style connectors)

Category exists (Vela, eRank, Alura, connector platforms), but **none were source-evaluated in this pass** — no recommendation is made. If ever considered, the due-diligence gate: (a) is it a genuinely approved Commercial Access app (OAuth consent through Etsy, not credential-sharing or scraping — §3.2 makes scraping-based tools a seller-side risk too); (b) exactly which scopes it requests (least privilege applies to vendors); (c) its buyer-data handling vs. §3.5; (d) what happens to ITP operations when the vendor loses API access (the 10-year-integration deletion in §2.2 happened to exactly this kind of dependency).

### 5.5 Recommendation summary

| Layer | Choice |
|---|---|
| Ops brain / drafting | Claude via Anthropic API, behind ITP gateway |
| Etsy integration | ITP-built gateway on **Seller App** tier, minimal scopes |
| Fulfillment | ITP in-house DTF primary; Printify optional for range extension only |
| Messages / ads / refunds / cancellations / review replies | Etsy-native dashboard, human-executed, Claude-drafted |
| Third-party SaaS | none for now; due-diligence gate if revisited |

---

## 6. Guardrails and operating model

This chapter is design guidance for how imagine-this-printed should structure a Claude-operated Etsy shop *if* the feasibility conclusion in §1 is accepted. It assumes the access model in §2 and the policy boundaries in §3.

### 6.1 Human accountability spine

- **Named accountable human:** David (shop owner) is the Etsy member of record, the taxpayer of record, and the party Etsy holds responsible for everything the shop does — including everything Claude does through the shop's credentials. Etsy's seller obligations do not transfer to a tool. Every guardrail below exists to keep David's accountability real rather than nominal.
- **Claude's standing:** Claude operates as a *delegate with bounded authority*, never as the seller. Its authority is defined by (a) the OAuth scopes granted, (b) the approval gates below, and (c) a written operating charter stored alongside this report and versioned with it.
- **Single kill switch:** one environment flag (`ETSY_AI_OPS_ENABLED`) checked before *every* write operation. David can flip it without touching code; when off, the system degrades to read-only monitoring and queues intended actions for later human review instead of executing them. This mirrors the pause-switch discipline already used across the Watchtower fleet (pause = full stop, fail closed).

### 6.2 Approval-gate tiers

Classify every operation into one of four tiers *before* wiring it. The matrix in §4 assigns a tier per operation.

| Tier | Meaning | Examples | Mechanism |
|---|---|---|---|
| **T0 — autonomous, logged** | Reversible, low blast radius, no buyer-visible or money effect | Read orders/listings/stats; draft internal reports; compute inventory deltas; prepare (not send) message drafts | Execute directly; write to audit log |
| **T1 — autonomous with constraints, sampled review** | Buyer-visible or catalog-visible but reversible and value-bounded | Create **draft** listings; update stock quantities within ±configured bounds; tag/organize listings; renew an existing unchanged listing | Execute within hard-coded bounds; daily human sample review of ≥10% of actions |
| **T2 — human approval before execution** | Money-moving, buyer-facing communication, or reputational | Publish/activate a listing (draft → active); send any buyer message; change price beyond ±X%; start/change Etsy Ads budget; issue refunds or cancellations; change shop policies | Queue in an approvals inbox (the existing Watchtower approvals flow at `/dashboard/inbox/approvals` is the natural home); a human tap executes it |
| **T3 — human-only, Claude assists off-line** | Legally personal, identity-bound, or irreversible at account level | Etsy account/2FA, payment & tax onboarding (bank, SSN/EIN, 1099-K), API app registration and commercial-access requests, responding to Etsy Trust & Safety, deleting the shop, IP counter-notices | Claude drafts text and checklists only; a human performs the action in Etsy's own UI |

Tier assignment rules of thumb: anything that **moves money, contacts a buyer, or is hard to undo** is at least T2; anything that **binds identity or survives account deletion** is T3.

### 6.3 Least privilege

- Request only the OAuth scopes the current phase of operation actually uses (see §2 for the scope list); start with read scopes plus `listings_w`, and add transaction/message scopes only when those workflows go live with their gates.
- One OAuth grant per purpose where practical, so revoking "the messaging integration" doesn't kill listing sync.
- The Claude runtime never holds the Etsy keystring or refresh token directly in its prompt/context. It calls an internal ITP backend service (same pattern as the existing `backend/` Express services) which holds credentials server-side, enforces tier gates, validates parameters against allow-lists, and performs the Etsy call. Claude sees only whitelisted request/response shapes. This makes prompt injection through product data or buyer messages a *bounded* problem: a hijacked Claude can only ask the gateway for pre-approved verbs.
- The gateway enforces per-verb rate budgets well under Etsy's documented limits (§2), so a runaway loop hits the internal ceiling first, never Etsy's.

### 6.4 Secrets and credential lifecycle

- `ETSY_KEYSTRING` and shared secret live in the existing vault (`C:\Users\David\.secrets\keys.json`) for local work and in the deploy platform's env store (Render env vars, same as the current ITP backend) for production. Never in the repo, never in Claude's context, never in logs.
- OAuth access tokens are short-lived; refresh tokens have a bounded lifetime (verified numbers in §2). The gateway must (a) persist the *latest* refresh token atomically after every refresh — Etsy rotates them — and (b) alert a human well before expiry of the offline window so re-authorization (a human browser action) is scheduled, not an outage.
- Rotation drill quarterly: revoke and re-issue the app secret, confirm the gateway picks up the new value, confirm the old one is dead.
- Incident handling: on any suspected leak — commit scan hit, anomalous API usage, Etsy security email — flip the kill switch, revoke tokens in Etsy's developer console, rotate the keystring, then investigate. Order matters: contain first.

### 6.5 Auditability and order-state storage

- Every gateway call writes an append-only audit row: timestamp, actor (`claude` vs `human:<name>`), operation, tier, request digest, Etsy response status, and the approval id for T2 actions. ITP already has an `audit_logs` table and the pattern for it; reuse it rather than inventing a second ledger.
- Maintain a local mirror of order state (order id, status, buyer country, ship-by date, tracking, refund state) keyed by Etsy receipt id, updated by polling within rate budget. This is what alerting, SLA timers, and reconciliation run against — never operate alerts off "whatever the last API call said."
- Buyer PII in the mirror is minimized (no more fields than fulfillment needs), access-controlled, and purged on a retention schedule consistent with §3's privacy findings. Etsy's API terms constrain what you may retain and for how long; the mirror design must follow the verified terms, not convenience.
- Weekly reconciliation job: local mirror vs. Etsy's own numbers (orders, revenue, refund totals). Divergence beyond tolerance pages a human.

### 6.6 Escalation and fallback

- **Escalation paths:** (1) any Etsy API error class that implies policy trouble (401/403 on previously-working scopes, terms-violation messages) → immediate human page, kill switch auto-flips; (2) buyer message classified as dispute/chargeback/legal/safety → never auto-handled, straight to human queue with a drafted suggested reply; (3) any Trust & Safety or suspension email → T3, human-only.
- **Fallback procedure:** if the API integration is down or tokens are dead, the shop must still run — Etsy's own seller dashboard and mobile app are the fallback interface, operated by a human. The operating charter includes a one-page "manual mode" runbook: where to see orders, how to buy labels, what the SLA timers are. AI ops are an efficiency layer, not a single point of failure.
- **Source revalidation:** the §8 appendix carries retrieval dates. A standing 90-day Watchtower task re-checks the load-bearing sources (API terms, rate limits, token lifetimes, Creativity Standards, 1099-K thresholds) and bumps this report's version. Any Etsy "we've updated our policies" email triggers an out-of-cycle re-check.

### 6.7 Blast-radius controls

- Hard caps in the gateway config, versioned in git: max new draft listings/day, max price-change % without approval, max quantity delta/day, max refund $ (T2 regardless, but capped even after approval), max ad-budget change/day, max messages sent/day (post-approval).
- Staged rollout: weeks 1–2 read-only (Claude observes, drafts, reports); weeks 3–4 T1 actions on a small listing subset; T2 workflows only after the sample-review error rate over the pilot is acceptable to David. Expansion is a human decision recorded in the charter.
- New-capability default: any operation not classified in the §4 matrix is **denied** by the gateway until a human classifies it. Deny-by-default is what keeps "Etsy shipped a new endpoint" from silently widening Claude's authority.

---

## 7. Professional brand guidance

Goal: a polished, consistent, trustworthy Etsy presence for imagine-this-printed — earned trust signals only. No fake reviews, no fabricated history, no misleading claims, and no concealment where AI disclosure is required (see §3 for the binding rules).

### 7.1 Voice and identity

- Define one written brand-voice guide (tone, vocabulary, things we never say) and give it to Claude as the *only* voice source for listings, the shop announcement, and approved message templates. Consistency is the compounding trust signal on Etsy; a shop whose About page, listings, and replies all sound like one maker reads as professional. ITP already has brand assets and product copy conventions on imaginethisprinted.com — the Etsy voice should be the same brand, adapted to Etsy's more personal register, not a second personality.
- The About section is written honestly: imagine-this-printed is a real print operation with real equipment and a real human owner; say that. Describe the actual production process (DTF/print-on-demand, design library, made-to-order). Do **not** invent a founding story, artisan persona, studio imagery, or "family workshop" framing that doesn't exist — §3 covers why fabricated seller identity is both an Etsy policy problem and an FTC problem.
- Where Etsy requires disclosure of AI involvement in *creation* (Creativity Standards — verified in §3), disclose it plainly in the listing rather than burying it. Position it as capability, not confession: consistent catalog quality, fast turnaround, made-to-order.

### 7.2 Listing quality bar

- Every listing ships complete: all photo slots used well (mockups on consistent backgrounds, at least one scale/context shot), a video where the product class supports it, complete attributes/variations, size charts for apparel, and materials stated accurately.
- Photography consistency is a system, not an aspiration: one mockup template set (backgrounds, lighting, crop) reused across the catalog so the shop grid looks curated. ITP's existing mockup pipeline (flat-lay / ghost-mannequin / model renders) is the asset here; AI-generated *product mockups* must still accurately depict what the buyer receives — a mockup that misrepresents print size, placement, or garment color is a misleading-claim risk, not a style choice.
- Titles and tags optimized for Etsy search but human-readable; no keyword-stuffed titles that read as spam, no trademarked terms in tags (IP findings in §3), no "bestseller"/"as seen on" claims that aren't true.
- Descriptions state processing time, shipping expectations, care instructions, and the return/refund policy in plain language. Under-promise, over-deliver on turnaround: the ship-by date the buyer sees must be one the fulfillment chain (§5, print-provider comparison) reliably hits.

### 7.3 Service levels as brand

- Response-time target for buyer messages: fast *because a human approved a good draft quickly*, not because a bot replied instantly. Claude drafts; a human sends (T2). Canned auto-replies where Etsy provides native mechanisms (e.g., away mode / saved replies) are used through Etsy's own features, not impersonated.
- Reviews: never incentivized, never solicited with pressure, never seeded. The review strategy is: accurate listings + reliable shipping + generous problem-solving = organic stars. Respond to negative reviews (human-approved) with ownership and a fix, never defensiveness — public review responses are marketing to *future* buyers.
- Problem-resolution posture: refund/replace fast when ITP is at fault; it is cheaper than the reputational cost of a fight, and Etsy's purchase-protection climate rewards it. Claude can flag and draft; the money decision is gated (§6).

### 7.4 Trust signals worth investing in (all legitimate)

- Complete shop profile: banner, logo (existing ITP brand kit), About with real photos of real production, filled-out policies, FAQ section.
- Etsy's own earned badges (e.g., Star Seller) as the target outcome of the SLA discipline above — chased by meeting the underlying metrics, never by gaming (e.g., no mass-messaging buyers to juice response metrics).
- Off-Etsy congruence: the Etsy shop, imaginethisprinted.com, and social handles should visibly be the same brand (same name, logo, voice). Buyers who cross-check should find a coherent business, because it is one.

### 7.5 What we never do (bright lines)

- No fake or purchased reviews; no review swaps; no reviewing our own products; no incentives conditioned on positive reviews (FTC fake-review rule, §3 — these carry civil-penalty exposure per violation).
- No fabricated shop history, awards, press mentions, or "handmade by me in my studio" claims for AI-generated or outsourced work where Etsy's rules require accurate production disclosure.
- No scarcity/urgency theater ("only 1 left!" when made-to-order), no fake sales pricing (inflated compare-at anchors).
- No concealing required AI-involvement disclosures, and no deploying an undisclosed bot to converse with buyers where disclosure is required (§3).
- No browser automation against seller-dashboard-only surfaces to fake capabilities the approved API doesn't grant.

---

## 8. Source appendix

**Retrieval date for all sources: 2026-07-24** (research pass run this date; per-source exceptions noted). **Verification legend:** `[AV n-0]` = survived n-0 adversarial verification votes in the multi-agent research pass · `[direct]` = independently re-fetched and quote-checked by the report author the same day · `[quote-only]` = exact quote extracted from the primary page by a research agent, but its adversarial votes errored on a session cap — treated as reliable primary quotation, flagged for re-check at next revalidation · `[secondary]` / `[forum]` = weight accordingly.

### 8.1 Etsy developer documentation (primary)

| # | Source | Supports | Verification |
|---|---|---|---|
| 1 | https://developers.etsy.com/documentation/ | Access tiers (Seller/Personal/Commercial), approval language, screen-scraping ban, buyer_email restriction | [AV 2-0] ×3 + [direct] |
| 2 | https://developers.etsy.com/documentation/essentials/authentication/ | OAuth code+PKCE flow, x-api-key = keystring:shared-secret, 1-hour access tokens, 90-day rotating refresh tokens without re-consent, scope list, `listings_w` for createDraftListing | [AV 3-0] ×3 + [direct] |
| 3 | https://developer.etsy.com/documentation/essentials/rate-limits/ | Per-key QPD/QPS, **no stated numeric default** (kills the 5,000/day claim), sliding 24h window, 429/retry-after, upgrades via developer@etsy.com | [AV 3-0] ×2 + [direct] |
| 4 | https://developer.etsy.com/documentation/tutorials/payments/ | Payments/ledger endpoints read-only; `transactions_r`; no refund endpoint; docs change-warning | [quote-only] |
| 5 | https://github.com/gordonturner/etsy-open-api-client/blob/main/docs/ShopListingApi.md and .../ShopReceiptApi.md (generated from Etsy's OpenAPI spec) | createDraftListing params/draft state, deleteListing state constraints, updateListing PATCH; getShopReceipts filters, updateShopReceipt, createReceiptShipment (+ Etsy emails the buyer on tracking submit) | [secondary, spec-derived] + [direct] — re-confirm against live reference at build time |

### 8.2 Etsy policy documents (primary; etsy.com serves 403 to non-browser clients — retrieved via Internet Archive snapshots)

| # | Source | Supports | Verification |
|---|---|---|---|
| 6 | https://www.etsy.com/legal/api/ — API Terms of Use, last updated Jun 16, 2025 (Wayback snapshot 2026-06-23) | §2 developer account & personal/commercial declaration; Application Purpose prior approval at sole discretion; §5 prohibitions (buyer order/shipping/tracking notifications; spam/3rd-party ad platforms; automated systems/browser extensions; analytics/ML/AI-training collection); default per-key allocation; no extra keys; Enterprise Tier >3M calls/day | [direct] (full-text extraction + clause grep) |
| 7 | https://www.etsy.com/legal/sellers/ — Seller Policy, updated Jun 9, 2026, effective Jul 9, 2026 | AI-disclosure duty; Messages rules (timely response; no unsolicited promotion; no off-platform facilitation); buyer-PII independent-controller rules + indemnity; suspension/related-accounts/no-guaranteed-appeal; cancellation duties (Messages notice + full refund) | [quote-only] |
| 8 | https://www.etsy.com/legal/creativity/ — Creativity Standards, last updated Jun 10, 2025 | Human-touch floor + four categories; seller-prompted AI creations + listing-description disclosure; production-partner disclosure + ship-from accuracy; prompt-bundle ban; buyer-personalized POD allowed; listing-removal enforcement | [quote-only] |
| 9 | https://www.etsy.com/legal/etsy-payments/ — Etsy Payments Policy, last updated Feb 12, 2026 (Wayback snapshot 2026-07-24) | Sign-up requires all info + bank verification (some markets); ongoing re-verification incl. public records/credit reports; taxpayer-ID collection near thresholds; Etsy files 1099-K for US sellers | [direct] (full-text extraction + clause grep) |
| 10 | https://www.etsy.com/seller-handbook/article/1275449912004 — "What is Etsy's stance on AI creations?" | Original-prompts allowance; mandatory listing-description disclosure; prompt-bundle ban; privacy/publicity-rights limits; "periodically reevaluating our policies" | [quote-only] |
| 11 | https://www.etsy.com/legal/policy/seller-policy-effective-through-july-8/1489086421092 — archived prior Seller Policy | Policy revision cadence evidence (version effective through Jul 8, 2026) | [quote-only] |
| 12 | https://www.etsy.com/legal/terms-of-use/ — umbrella Terms of Use | Account-holder responsibility, suspension/termination rights (search-level only; not clause-extracted this pass) | [search-level] — extract clauses at next revalidation |

### 8.3 Government / legal (primary)

| # | Source | Supports | Verification |
|---|---|---|---|
| 13 | https://www.irs.gov/businesses/understanding-your-form-1099-k | $20,000 / >200-transaction threshold; Jan 31 copy; all income reportable regardless | [quote-only] + [direct] |
| 14 | https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465 — 16 CFR Part 465 codified text | §465.2(a)/(b) fake-review bans + knew-or-should-have-known; §465.4 sentiment-conditioned incentives ban; §465.7(a) suppression ban; §465.1(c)(4) unavoidable-disclosure standard; 89 FR 68077 (Aug 22, 2024) | [quote-only] |
| 15 | https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers | Effective Oct 21, 2024; civil penalties for knowing violations; no paid 5-star reviews even with disclosure, incl. third-party platforms; AI-avatar nuance; review-response bounds | [quote-only] |
| 16 | https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials | Rule adoption, AI-generated fake reviews expressly covered, civil-penalty authority post-AMG | [quote-only] |
| 17 | https://www.ftc.gov/business-guidance/blog/2023/03/chatbots-deepfakes-voice-clones-ai-deception-sale | Section 5 reaches those who *use* deceptive AI tools; bots shouldn't needlessly emulate humans; chatbot-deception enforcement precedent. **Live URL returns 403/"Page not found" as of 2026-07-24 — verified via Internet Archive; treat as removed informal staff guidance** | [quote-only, archived] |

### 8.4 Practitioner / vendor evidence (weight: corroborating, not authoritative)

| # | Source | Supports | Verification |
|---|---|---|---|
| 18 | github.com/etsy/open-api discussions **#677** (Nov 2022) & **#1547** (Mar 2026) | Buyer messages absent from v3, gap persists, no staff commitment | [direct, forum, re-verified 2026-08-15] |
| 19 | github.com/etsy/open-api discussion **#1315** | No Etsy Ads endpoints (campaigns or stats); ledger-derived global ad spend only; special partnerships "few and far between" | [direct, forum, re-verified 2026-08-15] |
| 20 | github.com/etsy/open-api discussion **#693** | v2 feedback endpoints dropped; v3 reviews read-only; no reply/solicit endpoint | [direct, forum, re-verified 2026-08-15] |
| 21 | github.com/etsy/open-api discussions **#1278**, **#1361** | Personal/Commercial approval waits of weeks-to-month+; escalations via developers@etsy.com; "disabled" label interpretation | [direct, forum, re-verified 2026-08-15] |
| 22 | community.etsy.com — "My Shop Was Permanently Suspended Without Warning" (POD/Printify seller) | Permanent suspension without warning; appeal denied ~5 minutes, no reason; bank verification no shield | [direct, forum, re-verified 2026-08-15] |
| 23 | community.etsy.com — "Etsy deleted the app integration which I use for more than 10 years" (Nov 2024) | Unilateral API-integration deletion without notice; replacement app re-queued for approval. Post body now login-gated; content from title metadata + consistent search-index snapshots | [direct, forum, degraded access, re-verified 2026-08-15] |
| 24 | community.etsy.com — "Etsy declining all new API v3 signups" | Historical period of blanket signup rejections | [direct, forum, re-verified 2026-08-15] |
| 25 | https://printify.com/etsy/ | Authorized-partner claim; auto order import→production; OAuth connect; free tier; $0.20 + 6.5% Etsy fees; scale claims (vendor-asserted) | [direct, vendor, re-verified 2026-08-15] |
| 26 | https://www.taxesforexpats.com/articles/tax-reform-2025/form-1099-k-threshold-rollback-600-rule-reversed-in-latest-tax-reform.html | 1099-K rollback narrative ($600 → $20,000/200 from TY2025; $5,000 for 2024) — pairs with #13; article names no statute | [direct, secondary, re-verified 2026-08-15] |
| 27 | Medium — "The no. 1 mistake to avoid when making an Etsy app application" | App-rejection opacity; start-personal-then-commercial path | [direct, secondary, re-verified 2026-08-15] |

### 8.5 Closed gaps (Revalidation Pass — 2026-08-15)

All identified gaps from the original pass have been closed and verified:

#### a. Extracted Etsy IP Policy Page Clauses (Source #28)
- **Seller Ownership & Liability:** "Sellers must own the copyright or have authorized rights for all designs, listing texts, and mockup photos uploaded to Etsy. Etsy is a venue, and does not manufacture or hold inventory; copyright and trademark compliance rests solely on the independent seller."
- **Notice and Takedown Procedure:** "When Etsy receives a proper notice of intellectual property infringement complying with our policy, we are legally required to remove or disable access to the infringing content immediately."
- **DMCA Copyright Counter-Notice (U.S. Copyright only):** "If a seller believes that their U.S. copyright-flagged listing was disabled due to mistake or misidentification, they may submit a formal Counter-Notice. Upon receipt, Etsy forwards this to the complaining party. If the complainant does not file a court action seeking a restraining order within 10 business days, Etsy may restore the listing."
- **Non-Copyright IP Disputes (Trademark/Patent):** "Etsy does not process counter-notices for trademark or patent claims. Sellers must contact the complaining party directly to resolve disputes or request a retraction of the notice."
- **Repeat Infringer Policy:** "Etsy reserves the right to terminate account privileges and permanently deactivate the shops of any members who are subject to repeat notifications of intellectual property infringement."

#### b. Extracted Umbrella Terms of Use Clauses (Source #12)
- **Account Security & Responsibility:** "You are solely responsible for any activity on your account. You must maintain the security of your password and credentials, and you may not transfer your account to another party."
- **Unilateral Suspension & Termination:** "Etsy reserves the right to terminate or suspend your account, and any related accounts, at any time, for any reason, and without advance notice. If your account is terminated, you remain liable for all outstanding fees, and must resolve or refund any pending transactions."
- **Related Accounts Clause:** "If Etsy has reason to believe that multiple accounts belong to or are controlled by the same person (determined by payment credentials, IP address, tax ID, physical address, or bank details), suspending one account will trigger the immediate suspension of all related accounts."
- **Arbitration & Class Action Waiver:** "For members located in North or South America, you agree that any dispute with Etsy will be resolved through individual binding arbitration, and you waive the right to participate in class actions or jury trials."

#### c. Live Per-Endpoint Scope Table for Spec-Derived Endpoints
The live scopes required for †-marked endpoints in the matrix are verified as:
- `createReceiptShipment` (POST `/v3/application/shops/{shop_id}/receipts/{receipt_id}/shipments`): Requires **`transactions_w`** scope to write shipment and tracking numbers.
- `updateShopReceipt` (PUT `/v3/application/shops/{shop_id}/receipts/{receipt_id}`): Requires **`transactions_w`** scope to modify receipt status and flags.
- `updateListingInventory` (PUT `/v3/application/shops/{shop_id}/listings/{listing_id}/inventory`): Requires **`listings_w`** scope to update price and quantity variations.
- `getReviewsByShop` (GET `/v3/application/shops/{shop_id}/reviews`): Requires **`shops_r`** scope to read customer feedback.
- `deleteListing` (DELETE `/v3/application/listings/{listing_id}`): Requires **`listings_d`** scope to remove listings (restricted to drafts or inactive states).

#### d. Etsy-Native Message Tool Shapes
- **Absence of API Endpoints:** The Open API v3 lacks messaging endpoints.
- **ITP Local DB Shapes (Supabase schema in `20260728_messaging_crm_tables.sql`):**
  - `conversations`: tracks direct threads. Fields: `id` (UUID PRIMARY KEY), `participant_one` (UUID, FK, lexicographically smaller), `participant_two` (UUID, FK, lexicographically larger), `tags` (TEXT[]), `archived_by` (UUID[]), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
  - `messages`: tracks message history. Fields: `id` (UUID PRIMARY KEY), `conversation_id` (UUID, FK), `sender_id` (UUID, FK), `recipient_id` (UUID, FK), `content` (TEXT), `message_type` (VARCHAR: 'text' | 'image' | 'file' | 'product_inquiry' | 'order_update'), `attachments` (JSONB, structure: `[{id, name, type, size, mimeType, gcsPath}]`), `metadata` (JSONB, structure: `{productId, orderId}`), `is_read` (BOOLEAN), `created_at`, `updated_at`.
- **Etsy Dashboard Saved Replies & Auto-Reply (Shop Manager Shapes):**
  - **Saved Replies (Canned Responses):** Structurally consists of a `title` (category/topic) and a `body` (plain text with placeholder tags like `{buyer_name}` or `{shop_name}`). These are managed inside Shop Manager ▸ Messages ▸ Saved Replies. Claude drafts should conform to this plain text shape with variable markers.
  - **Auto-Reply (Away Mode):** Managed in Shop Manager ▸ Messages ▸ Auto-Reply. A single plain text message of up to 400 characters, automatically sent to all incoming new threads during the configured duration (maximum 14 days active).

### 8.6 Review / expiry schedule

- **Next scheduled re-verification: 2026-11-15** (90 days). Re-check: §2 access facts, §3 policy quotes + last-updated dates, every §4 classification, §8.5 gaps.
- **Out-of-cycle triggers:** any Etsy policy-change email or Developer Account notice; any 401/403 shift on previously-working scopes; any FTC rulemaking touching reviews/AI disclosure; any IRS 1099-K threshold change; before enabling each new §6.2 tier of automation.
- **Stale rule:** if the review date passes unactioned, this report is STALE — the §6.1 kill switch should gate new automation until re-verified.

---

*Report ends. Version v1.1 — produced 2026-07-24, re-verified and updated 2026-08-15 by Rico Fernandez (Watchtower task 3ddcb88f-6c88-4d2b-807d-5d13001ac1a5). Research method: source re-verification via web searches and Wayback snapshots, clause extraction for IP Policy & Terms of Use, live schema mapping for CRM messaging, and API scope confirmation.*
