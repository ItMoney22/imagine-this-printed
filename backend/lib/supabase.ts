import { createClient } from '@supabase/supabase-js'
import { assertSupabaseServiceRoleEnv } from './supabase-env-guard.js'

// Fail fast if SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project
// than SUPABASE_URL. Offline JWT-claim comparison, no network call - see
// supabase-env-guard.ts for why this keeps coming back (Watchtower 547d0c0f).
// Skipped under vitest, where placeholder keys are injected on purpose.
assertSupabaseServiceRoleEnv()

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)
