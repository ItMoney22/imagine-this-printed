# Render auto-deploy is broken — root cause & 2-minute fix

**Incident:** Pushes/merges to `main` stopped auto-deploying to the Render backend
(`imagine-this-printed-backend`, `srv-d7jpgut7vvec739bsid0`) and worker
(`imagine-this-printed-worker`, `srv-d7jppnn7f7vs73bb4p80`). Last real auto-deploy
was **2026-06-11**; every deploy since has been a **manual** API trigger.
Diagnosed 2026-07-11 (Watchtower task `44448ccc-7523-4539-887e-0ce3b7fbecb9`).

## Root cause (confirmed)

**The "Render" GitHub App is no longer installed on the `ItMoney22` GitHub account.**

Render's auto-deploy is driven by its **GitHub App installation**, not by a
repo-level webhook. Evidence:

1. `github.com/ItMoney22/imagine-this-printed` → Settings → Webhooks has **only a
   Vercel** deploy hook. There is **no** Render webhook (expected — Render uses the App).
2. `github.com/settings/installations` (ItMoney22) lists: ChatGPT Codex, Claude,
   Cursor, Hostinger, lovable.dev, Railway App, Vercel — **"Render" is absent.**
3. Render service config is 100% correct on both services: `autoDeploy=yes`,
   `branch=main`, `buildFilter=null`, `suspended=not_suspended`.
4. Render deploy history: the last `trigger=deployed_by_render` (git-push auto-deploy)
   was 2026-06-11; everything after is `trigger=api` (manual `POST /v1/services/{id}/deploys`).

Because the App is gone, GitHub sends Render no push events, so nothing auto-deploys.
**Manual deploys still work** because they use Render's stored git credentials, which
are independent of the App webhook — that's why the symptom looked like "webhook dead"
rather than "repo disconnected."

## The fix (requires the Render account owner — ~2 minutes)

An agent cannot complete this: it needs a logged-in Render session (no stored
credentials) **and** a human consent on the GitHub App install screen.

**Preferred — from the Render dashboard (binds the install to the correct Render team):**
1. Log in to https://dashboard.render.com
2. Open **imagine-this-printed-backend** → **Settings** → **Build & Deploy**.
3. In the repository/GitHub section, click to **reconnect / configure the GitHub App**.
   GitHub opens → **Install Render** on the `ItMoney22` account → grant access to the
   **imagine-this-printed** repo (and any other repos Render should deploy) → **Save**.
4. Both services share the repo connection, so the worker resumes too. Verify the
   worker also shows connected.

**Alternative — from GitHub:** https://github.com/apps/render → Install/Configure on
`ItMoney22` → select `imagine-this-printed` → complete the redirect back to Render
(this step still needs a Render login to bind the install to the services' team).

## Verify it worked

- `github.com/settings/installations` now lists **Render**, with access to
  `imagine-this-printed`.
- The next merge to `main` produces a deploy whose trigger is `deployed_by_render`
  (not `api`). Check: Render dashboard → service → Events, or
  `GET https://api.render.com/v1/services/<id>/deploys?limit=5`
  (Bearer `RENDER_API_KEY`) → newest deploy's `trigger` field.

## Interim stopgap (until reconnected)

After every merge to `main`, manually trigger both services:

```
POST https://api.render.com/v1/services/srv-d7jpgut7vvec739bsid0/deploys   # backend
POST https://api.render.com/v1/services/srv-d7jppnn7f7vs73bb4p80/deploys   # worker
Authorization: Bearer <RENDER_API_KEY>   (vault: render.RENDER_API_KEY)
body: {}
```

## Why we did NOT auto-patch it with a repo-webhook → Render deploy-hook

That workaround would restore auto-deploy without the App, but GitHub webhooks can't
filter by branch — so every push to any feature/dispatch branch (frequent here) would
fire a **production** rebuild + cutover blip on the live API. That's worse than the
manual stopgap. Reinstalling the GitHub App is the correct, branch-aware fix.
