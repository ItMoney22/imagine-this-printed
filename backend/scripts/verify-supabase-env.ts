/**
 * verify:supabase-env - proves the ITP backend is pointed at the right Supabase
 * project, and that nothing in the repo can silently be pointed at a wrong one.
 *
 * Watchtower 547d0c0f (recurrence of f436cc1b). Run from backend/:
 *
 *   npm run verify:supabase-env          # offline checks only
 *   npm run verify:supabase-env -- --live  # + real REST/auth calls to Supabase
 *
 * Three checks:
 *   1. backend/.env - the key on disk must be a service_role key whose `ref`
 *      claim matches SUPABASE_URL.
 *   2. SHADOWING - if the ambient process environment carries a DIFFERENT
 *      SUPABASE_SERVICE_ROLE_KEY than the file, say so loudly. This is the
 *      actual failure mode that has twice been misdiagnosed as "something
 *      rewrote backend/.env": dotenv and `--env-file=` both refuse to overwrite
 *      an already-set variable, so the correct file loses.
 *   3. LOADER DISCIPLINE - every standalone script that reads SUPABASE_* must
 *      load env with `override: true` (or via backend/load-env.ts). A script
 *      that does not is one stray shell variable away from talking to the wrong
 *      database.
 *
 * Never prints key material - only project refs, roles, lengths and a 6-char tail.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  checkSupabaseServiceRoleEnv,
  maskSecret,
  projectRefFromSupabaseUrl,
  decodeJwtPayload
} from '../lib/supabase-env-guard.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(here, '..')
const REPO_ROOT = path.resolve(BACKEND_DIR, '..')

const LIVE = process.argv.includes('--live')
// --env=<path> so this can be run from a dispatch worktree (which has no .env of
// its own) against the shared checkout's real file.
const envArg = process.argv.find((a) => a.startsWith('--env='))
const ENV_PATH = envArg ? path.resolve(envArg.slice('--env='.length)) : path.join(BACKEND_DIR, '.env')

let failures = 0
const fail = (msg: string) => {
  failures++
  console.log(`  FAIL  ${msg}`)
}
const pass = (msg: string) => console.log(`  PASS  ${msg}`)
const warn = (msg: string) => console.log(`  WARN  ${msg}`)

/** Minimal .env reader - deliberately does NOT touch process.env. */
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  // Strip a BOM: a leading U+FEFF silently corrupts the first key name.
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

// ---------------------------------------------------------------- 1. the file
console.log(`\n1. ${ENV_PATH}`)
const fileEnv = readEnvFile(ENV_PATH)

if (!fs.existsSync(ENV_PATH)) {
  warn(`${ENV_PATH} does not exist - expected on Render, a problem locally.`)
} else {
  const verdict = checkSupabaseServiceRoleEnv(fileEnv)
  console.log(`        SUPABASE_URL              -> ${fileEnv.SUPABASE_URL ?? '(unset)'}`)
  console.log(
    `        SUPABASE_SERVICE_ROLE_KEY -> ref "${verdict.keyRef ?? '?'}" role "${verdict.keyRole ?? '?'}" (${maskSecret(fileEnv.SUPABASE_SERVICE_ROLE_KEY)})`
  )
  if (verdict.code === 'match') pass(`service_role key matches project "${verdict.urlRef}"`)
  else if (verdict.fatal) fail(verdict.detail)
  else warn(verdict.detail)

  // The anon key travels with it and is just as easy to cross-wire.
  const anonPayload = decodeJwtPayload(fileEnv.SUPABASE_ANON_KEY)
  const anonRef = typeof anonPayload?.ref === 'string' ? anonPayload.ref : null
  const urlRef = projectRefFromSupabaseUrl(fileEnv.SUPABASE_URL)
  if (anonRef && urlRef && anonRef !== urlRef) fail(`SUPABASE_ANON_KEY belongs to project "${anonRef}", not "${urlRef}"`)
  else if (anonRef) pass(`anon key matches project "${anonRef}"`)
}

// ------------------------------------------------------------- 2. shadowing
console.log('\n2. Ambient environment vs the file')
const shadowed: string[] = []
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) {
  const fromFile = fileEnv[key]
  const fromEnv = process.env[key]
  if (!fromFile || !fromEnv || fromFile === fromEnv) continue
  shadowed.push(key)
  const envRef = decodeJwtPayload(fromEnv)?.ref
  console.log(
    `        ${key}: process env holds a DIFFERENT value (${maskSecret(fromEnv)}${envRef ? `, project "${String(envRef)}"` : ''})`
  )
}
if (shadowed.length === 0) {
  pass('no ambient SUPABASE_* variable disagrees with backend/.env')
} else {
  warn(
    `${shadowed.join(', ')} shadowed by the process environment. The backend and worker survive this ` +
      '(backend/load-env.ts uses override:true) but any script that does not will hit 401 Invalid API key.'
  )
}

// ------------------------------------------------------ 3. loader discipline
console.log('\n3. Standalone scripts load env with override')
const SCAN_DIRS = [
  path.join(BACKEND_DIR, 'scripts'),
  path.join(REPO_ROOT, 'scripts'),
  path.join(REPO_ROOT, 'diagnostics')
]
const SCAN_FILE_GLOB = /\.(ts|js|mjs|cjs)$/
const READS_SUPABASE = /SUPABASE_(URL|SERVICE_ROLE_KEY|ANON_KEY)/
const HAS_LOADER = /dotenv\/config|dotenv\.config\(/
const IS_SAFE = /override:\s*true|load-env(\.js)?['"]/

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, out)
    } else if (SCAN_FILE_GLOB.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// Loose backend files (backend/check-*.mjs and friends) count too.
const looseBackend = fs.existsSync(BACKEND_DIR)
  ? fs
      .readdirSync(BACKEND_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && SCAN_FILE_GLOB.test(e.name) && !/^(index|load-env)\./.test(e.name))
      .map((e) => path.join(BACKEND_DIR, e.name))
  : []

const offenders: string[] = []
for (const file of [...SCAN_DIRS.flatMap((d) => walk(d)), ...looseBackend]) {
  const src = fs.readFileSync(file, 'utf8')
  if (!READS_SUPABASE.test(src)) continue
  if (!HAS_LOADER.test(src)) continue // relies on --env-file / an outer loader
  if (IS_SAFE.test(src)) continue
  offenders.push(path.relative(REPO_ROOT, file).replace(/\\/g, '/'))
}
if (offenders.length === 0) {
  pass('every standalone script reading SUPABASE_* loads env with override')
} else {
  for (const o of offenders) fail(`${o} loads env without override - a stray shell var will beat the file`)
}

// ------------------------------------------------------------- 4. live probe
if (LIVE) {
  console.log('\n4. Live calls with the key from backend/.env')
  const url = fileEnv.SUPABASE_URL
  const key = fileEnv.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    fail('cannot probe - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from backend/.env')
  } else {
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    for (const [label, endpoint] of [
      ['REST  /rest/v1/products', `${url}/rest/v1/products?select=id&limit=1`],
      ['AUTH  /auth/v1/admin/users', `${url}/auth/v1/admin/users?page=1&per_page=1`]
    ] as const) {
      try {
        const res = await fetch(endpoint, { headers })
        if (res.ok) pass(`${label} -> HTTP ${res.status}`)
        else fail(`${label} -> HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
      } catch (err) {
        fail(`${label} -> ${(err as Error).message}`)
      }
    }
  }
} else {
  console.log('\n4. Live calls  (skipped - pass --live to run them)')
}

console.log(failures === 0 ? '\nOK - Supabase env is consistent.\n' : `\n${failures} check(s) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
