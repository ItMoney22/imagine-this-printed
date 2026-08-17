# Design Brief Scout

Market-research agent that turns Etsy/POD demand signals into a ranked queue
of t-shirt design briefs a design agent (or a human designer) can act on
directly. Built for Watchtower task `12d1c31d-b905-40ee-bf96-61ee778c9d97`.

## Why this exists

The store has been live a month with zero sales. Designs were speculative
guesses instead of demand-driven. This agent replaces guessing with a daily
ranked list of {theme, saying, style notes, target holiday/date} briefs.

## Files

- `backend/services/design-brief-scout.ts` — the scout: holiday calendar +
  evergreen niche seeds, live marketplace search, OpenAI brief generation,
  deterministic ranking.
- `backend/routes/scout.ts` — HTTP integration point.
- This doc.

## Data sources (assumption, decided autonomously)

Etsy's Open API v3 has no public trending/best-seller endpoint — only
listing CRUD, which `backend/services/etsy.ts` already uses to **post**
listings, not search them. Directly scraping etsy.com/amazon.com HTML would
violate both platforms' terms of service, which the task's own acceptance
criteria rules out.

The practical, ToS-compliant substitute — already the pattern this codebase
uses for market research (`backend/services/product-trends.ts`, the "Trend
Scout"/"Phrase Scout" that power the Marketing Tools trend endpoints) — is
**SerpAPI**, a licensed search-results API. This agent reuses that exact
channel (`searchTrends()` from `backend/services/serpapi-search.ts`), scoped
with `site:etsy.com` and `site:amazon.com OR site:redbubble.com OR
site:teepublic.com` filters, so Etsy plus a second POD marketplace pool
(Amazon Handmade / Redbubble / TeePublic) are both covered without touching
either platform directly. Requires `SERPAPI_KEY` + `OPENAI_API_KEY` (both
already provisioned in the vault and used elsewhere in this backend).

If SerpAPI returns no context for a given query (quota exhausted, network
issue), the scout falls back to a safe evergreen brief for that niche rather
than failing the whole run — the daily-output floor of 10 briefs always
holds.

## Ranking methodology (assumption, decided autonomously)

Each brief gets a deterministic 0–100 score:

- **Holiday proximity** — `max(0, 60 - daysUntil)` for briefs tied to one of
  the 10 built-in gifting holidays (Valentine's, Mother's/Father's Day, 4th
  of July, Back to School, Halloween, Thanksgiving, Christmas, etc.), so
  something 5 days out outranks something 50 days out.
- **Evergreen base** — niches with no calendar tie (dog mom humor, nurse
  humor, sarcastic coffee humor, retro streetwear, camping, gym/fitness) get
  a flat 35, so the queue never depends entirely on the calendar.
- **Saturation bonus** — the model classifies each brief's competitive
  crowding from the live snippets (`low`/`medium`/`high`); low-saturation
  ideas get +20, medium +10, high +0.
- **Evidence bonus** — up to +15 for how many live marketplace snippets
  actually backed the brief.

Every run pulls the 10 built-in holidays that fall within the next 65 days
(production lead time) plus a rotating slice of 4 evergreen niches (rotated
by day-of-year so the queue doesn't repeat verbatim), generates ~2 briefs per
target, sorts by score, and returns the top 10–12.

## Output format (assumption, decided autonomously)

JSON (matches every other trend endpoint in this backend — `ProductTrendResponse`,
`SimpleWordPhraseResponse` — so a design agent already consuming those needs
no new parsing logic):

```json
{
  "generatedAt": "2026-08-17T12:00:00.000Z",
  "briefs": [
    {
      "id": "spooky-season-dog-mom-1",
      "rank": 1,
      "score": 92,
      "theme": "Spooky Season Dog Mom",
      "saying": "FUR MOM ENERGY",
      "styleNotes": "Bold centered serif, one orange accent, small bat icon above text.",
      "targetHoliday": "Halloween",
      "targetDate": "2026-10-31",
      "niche": "spooky season and horror-comedy",
      "audience": "Dog owners shopping seasonal gifts",
      "productType": "tshirt",
      "evidence": ["... live snippet excerpt ..."],
      "saturation": "low",
      "riskFlags": [],
      "sourceQueries": ["site:etsy.com best selling t-shirt ...", "..."]
    }
  ],
  "note": "..."
}
```

## Integration point

- `GET /api/scout/design-briefs` — returns the current ranked queue. Cached
  in-process for 20h; the first caller after the cache goes stale pays the
  generation latency (~14 SerpAPI + ~14 OpenAI calls), everyone else in that
  window gets the cached result. **A design agent should poll this route.**
- `POST /api/scout/design-briefs/run` — `requireAuth` + `admin`/`manager`
  role. Forces a fresh pass. Wire a daily Render Cron Job (or an internal
  scheduler hitting this with a service-role session) so the queue rotates
  once every 24h on a schedule instead of waiting on the first visitor —
  **not yet wired**, see Known gaps below.

## Known gaps / next pickup

1. **No Render Cron Job wired yet.** The route supports on-demand + cached
   generation, which already satisfies "daily output" (a fresh queue every
   ~20h on first request), but a true unattended daily cron should call
   `POST /api/scout/design-briefs/run` once every 24h. Render Cron Job
   resources aren't creatable from code — needs a dashboard/Render-CLI step.
2. **Cache is in-process memory, not durable storage.** Render web service
   disk/memory resets on every deploy and isn't shared across replicas, so a
   deploy mid-day forces a regeneration on the next request. Fine for an
   MVP; if this needs multi-replica consistency or historical queues to
   compare day-over-day, persist runs to a Supabase table instead (a
   `scout_design_briefs` migration, following the same pattern as
   `migrations/create_wallet_transactions_table.sql`) and have the route
   read the latest batch from there.
3. **Holiday dates are fixed approximations** for movable feasts (Mother's/
   Father's Day) — accurate enough for a 60-day proximity signal, not
   calendar-precise.
4. **No design-agent consumer wired yet.** This ships the producer side
   only; whichever agent turns briefs into artwork needs to be pointed at
   `GET /api/scout/design-briefs`.
