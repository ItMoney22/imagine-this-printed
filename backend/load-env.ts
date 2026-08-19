// MUST be imported BEFORE any module that constructs an OpenAI/SDK client at module-load time.
// Forces backend/.env to win over OS-level env vars (Windows User-scope OPENAI_API_KEY otherwise sticks).
//
// Two things matter here and both have burned us:
//
// 1. `override: true`. dotenv (and Node's `--env-file=` flag) will NOT overwrite a
//    variable that is already set in the process environment. Dispatch shells on
//    David's box inherit SUPABASE_* / OPENAI_API_KEY from their parent process, so
//    without override the correct file silently loses and every service-role call
//    comes back 401 "Invalid API key" - see backend/lib/supabase-env-guard.ts and
//    docs/SECURITY-supabase-service-role-drift-547d0c0f.md (Watchtower 547d0c0f).
//
// 2. The path is resolved from THIS FILE, not from process.cwd(). A bare
//    dotenv.config() reads `<cwd>/.env`, so `npm --prefix backend run dev` loaded
//    backend/.env but `tsx backend/index.ts` from the repo root loaded the root
//    .env - which holds only VITE_* vars and therefore overrode nothing.
//
// On Render there is no .env file at all (real env vars are injected); a missing
// file is not an error, dotenv just reports it and we carry on.
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Under vitest the suite owns the environment (it injects placeholder keys on
// purpose). Loading the real backend/.env there would hand production
// credentials to a unit test - never do it.
const underTest = Boolean(process.env.VITEST)

const here = path.dirname(fileURLToPath(import.meta.url))

// src layout -> <backend>/.env ; compiled layout -> <backend>/dist/../.env
const candidates = [path.join(here, '.env'), path.join(here, '..', '.env')]
const envPath = candidates.find((p) => fs.existsSync(p))

// Snapshot the vars most likely to be shadowed so we can say so out loud.
const WATCHED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'DATABASE_URL']
const before = new Map(WATCHED.map((k) => [k, process.env[k]]))

if (!underTest) {
  dotenv.config(envPath ? { path: envPath, override: true } : { override: true })
}

const shadowed = WATCHED.filter((k) => {
  const prior = before.get(k)
  return prior !== undefined && prior !== process.env[k]
})

if (shadowed.length > 0) {
  console.warn(
    `[load-env] Overrode ${shadowed.join(', ')} - the process environment carried a different value than ${envPath ?? '.env'}. ` +
      'That stale value is what makes standalone scripts talk to the wrong Supabase project.'
  )
}
