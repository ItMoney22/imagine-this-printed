/**
 * Offline sanity check that SUPABASE_SERVICE_ROLE_KEY actually belongs to the
 * Supabase project named by SUPABASE_URL.
 *
 * WHY THIS EXISTS (Watchtower 547d0c0f, recurrence of f436cc1b)
 * -------------------------------------------------------------
 * Twice now an agent has reported "backend/.env has the wrong service role key"
 * and gone looking for the script that rewrote the file. Nothing rewrites it.
 * The file has been byte-identical to both Render services the whole time.
 *
 * What actually happens: another project's SUPABASE_SERVICE_ROLE_KEY is already
 * present in the process environment (inherited from a parent process, or set at
 * OS User scope), and BOTH standard loaders refuse to overwrite a variable that
 * is already set - `dotenv.config()` without `override` and Node's `--env-file=`
 * flag alike. So the correct file loses to the stale environment, every
 * service-role call returns HTTP 401 "Invalid API key", and the file gets blamed
 * for it.
 *
 * This guard makes that failure state loud and self-diagnosing instead of a 401
 * five layers deep. It is pure string work - base64url-decode the JWT payload
 * and compare `payload.ref` with the sub-domain of SUPABASE_URL. No network
 * call, no signature verification (the signature would need the project JWT
 * secret, and a wrong-project key is not a forged key - it is a real key for the
 * wrong database, which is exactly what `ref` catches).
 *
 * See docs/SECURITY-supabase-service-role-drift-547d0c0f.md for the full
 * investigation and the live before/after evidence.
 */

export type SupabaseEnvCode =
  | 'match'
  | 'ref-mismatch'
  | 'wrong-role'
  | 'missing-url'
  | 'missing-key'
  | 'unverifiable-url'
  | 'unverifiable-key'
  | 'skipped'

export interface SupabaseEnvVerdict {
  /** true when nothing is known to be wrong (includes the unverifiable cases). */
  ok: boolean
  /** true only for states that guarantee a broken client - these stop the boot. */
  fatal: boolean
  code: SupabaseEnvCode
  /** project ref parsed out of SUPABASE_URL, e.g. "czzyrmizvjqlifcivrhn" */
  urlRef: string | null
  /** `ref` claim decoded from the service-role JWT */
  keyRef: string | null
  /** `role` claim decoded from the service-role JWT */
  keyRole: string | null
  detail: string
}

type EnvLike = Record<string, string | undefined>

/** Hosts whose first label is the Supabase project ref. A custom domain is not verifiable. */
const SUPABASE_HOST_SUFFIXES = ['.supabase.co', '.supabase.in', '.supabase.net']

/**
 * "https://czzyrmizvjqlifcivrhn.supabase.co" -> "czzyrmizvjqlifcivrhn".
 * Returns null for a custom domain or an unparseable value - unknown, not wrong.
 */
export function projectRefFromSupabaseUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null
  let host: string
  try {
    host = new URL(rawUrl.trim()).hostname.toLowerCase()
  } catch {
    // Tolerate a bare host with no scheme ("czzyrmizvjqlifcivrhn.supabase.co").
    host = (rawUrl.trim().toLowerCase().replace(/^\/+/, '').split('/')[0] ?? '')
    if (!host || host.includes(' ')) return null
  }
  const suffix = SUPABASE_HOST_SUFFIXES.find((s) => host.endsWith(s))
  if (!suffix) return null
  const ref = host.slice(0, -suffix.length)
  // A project ref is a single label; "db.<ref>.supabase.co" style hosts keep the ref last.
  const label = ref.split('.').filter(Boolean).pop() ?? ''
  return label || null
}

/**
 * base64url-decode the payload segment of a JWT. No signature verification and
 * no network access - this only reads the claims the issuer wrote.
 */
export function decodeJwtPayload(token: string | undefined | null): Record<string, unknown> | null {
  if (!token) return null
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (!payload) return null
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** Never log a key. This is enough to compare two keys by eye and nothing more. */
export function maskSecret(token: string | undefined | null): string {
  if (!token) return '(unset)'
  const t = token.trim()
  if (t.length <= 8) return `(len ${t.length})`
  return `len ${t.length}, ends ...${t.slice(-6)}`
}

function claim(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * Compare SUPABASE_SERVICE_ROLE_KEY against SUPABASE_URL. Never throws.
 *
 * Only two states are fatal, and both guarantee that every service-role call
 * fails:
 *   - `ref-mismatch` - the key is a valid Supabase JWT for a DIFFERENT project.
 *   - `wrong-role`   - an anon/authenticated key is sitting in the service-role
 *                      slot, so every privileged write silently hits RLS.
 *
 * A key that is not a decodable JWT is reported as `unverifiable-key`, NOT as a
 * failure: Supabase's newer `sb_secret_...` API keys are opaque by design, and
 * test suites inject placeholder strings.
 */
export function checkSupabaseServiceRoleEnv(env: EnvLike = process.env): SupabaseEnvVerdict {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY

  const empty = { urlRef: null as string | null, keyRef: null as string | null, keyRole: null as string | null }

  if (!url) {
    return { ...empty, ok: false, fatal: false, code: 'missing-url', detail: 'SUPABASE_URL is not set.' }
  }
  if (!key) {
    return { ...empty, ok: false, fatal: false, code: 'missing-key', detail: 'SUPABASE_SERVICE_ROLE_KEY is not set.' }
  }

  const urlRef = projectRefFromSupabaseUrl(url)
  const payload = decodeJwtPayload(key)
  const keyRef = payload ? claim(payload.ref) : null
  const keyRole = payload ? claim(payload.role) : null
  const ctx = { urlRef, keyRef, keyRole }

  if (!urlRef) {
    return {
      ...ctx,
      ok: true,
      fatal: false,
      code: 'unverifiable-url',
      detail: `SUPABASE_URL "${url}" is not a *.supabase.co project URL, so its project ref cannot be derived.`
    }
  }
  if (!keyRef) {
    return {
      ...ctx,
      ok: true,
      fatal: false,
      code: 'unverifiable-key',
      detail: `SUPABASE_SERVICE_ROLE_KEY carries no decodable "ref" claim (${maskSecret(key)}) - opaque sb_secret_* keys and test placeholders land here.`
    }
  }
  if (keyRef !== urlRef) {
    return {
      ...ctx,
      ok: false,
      fatal: true,
      code: 'ref-mismatch',
      detail: `SUPABASE_SERVICE_ROLE_KEY is a key for project "${keyRef}" but SUPABASE_URL points at project "${urlRef}".`
    }
  }
  if (keyRole && keyRole !== 'service_role') {
    return {
      ...ctx,
      ok: false,
      fatal: true,
      code: 'wrong-role',
      detail: `SUPABASE_SERVICE_ROLE_KEY carries role "${keyRole}", not "service_role" - every privileged query would be evaluated under RLS.`
    }
  }

  return {
    ...ctx,
    ok: true,
    fatal: false,
    code: 'match',
    detail: `service_role key matches project "${urlRef}".`
  }
}

/** The boot-time error text. Long on purpose - it is the only thing the operator sees. */
export function formatSupabaseEnvError(verdict: SupabaseEnvVerdict, env: EnvLike = process.env): string {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  return [
    '',
    '========================================================================',
    ' [supabase-env] REFUSING TO START - Supabase credentials disagree',
    '========================================================================',
    ` ${verdict.detail}`,
    '',
    `   SUPABASE_URL              -> ${env.SUPABASE_URL ?? '(unset)'}  (project ref "${verdict.urlRef ?? '?'}")`,
    `   SUPABASE_SERVICE_ROLE_KEY -> project ref "${verdict.keyRef ?? '?'}", role "${verdict.keyRole ?? '?'}"  (${maskSecret(key)})`,
    '',
    ' Every service-role request would come back HTTP 401 "Invalid API key", so',
    ' this process is stopping here instead of failing one query at a time.',
    '',
    ' MOST LIKELY CAUSE - a stale environment variable is shadowing backend/.env.',
    ' dotenv.config() without `override` and node/tsx --env-file= BOTH refuse to',
    ' overwrite a variable that is already set, so a perfectly correct file loses',
    ' to whatever the parent process or the OS already exported.',
    '',
    ' CHECK: node -e "console.log(process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-6))"',
    '        ...then compare that with the tail of the key in backend/.env.',
    ' FIX:   import backend/load-env.js first (dotenv.config({ override: true })),',
    '        or unset the stray variable in the shell that launched this process.',
    '',
    ' Ground truth for this project is the Render env of imagine-this-printed-backend',
    ' and the key vault. Full write-up:',
    ' docs/SECURITY-supabase-service-role-drift-547d0c0f.md',
    '========================================================================',
    ''
  ].join('\n')
}

export interface AssertOptions {
  /** Vitest injects placeholder keys; a mismatch there is noise, not an outage. */
  skipInTest?: boolean
  /** Suppress the one-line confirmation on success. */
  quiet?: boolean
}

/**
 * Fail fast on a credential mismatch. Call once, at module load, before any
 * Supabase client is constructed.
 */
export function assertSupabaseServiceRoleEnv(
  env: EnvLike = process.env,
  { skipInTest = true, quiet = false }: AssertOptions = {}
): SupabaseEnvVerdict {
  if (skipInTest && (env.NODE_ENV === 'test' || env.VITEST)) {
    return {
      ok: true,
      fatal: false,
      code: 'skipped',
      urlRef: null,
      keyRef: null,
      keyRole: null,
      detail: 'Skipped under the test runner.'
    }
  }

  const verdict = checkSupabaseServiceRoleEnv(env)

  if (verdict.fatal) {
    console.error(formatSupabaseEnvError(verdict, env))
    throw new Error(`[supabase-env] ${verdict.detail} Refusing to start.`)
  }

  if (!quiet && verdict.code === 'match') {
    console.log(`[supabase-env] OK - service_role key matches project "${verdict.urlRef}"`)
  } else if (!quiet && verdict.code !== 'skipped') {
    console.warn(`[supabase-env] WARN - ${verdict.detail}`)
  }

  return verdict
}
