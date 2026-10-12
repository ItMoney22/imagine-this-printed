// After-live proof for the on-person model_id stamp (task 6055f034, Saturn df79da8).
// Read-only: one git check and three REST reads against production. Writes nothing.
//
//   node backend/scripts/prove-on-person-model-id.mjs --since 2026-10-13T14:00:00Z [--env backend/.env]
//
// --since = the moment the ship went live; only shots made after it count.
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from the shell, or the --env file).
//
// Prints PASS / FAIL per check and ends with RESULT: PASS | FAIL | WAITING.
// WAITING = the code is on main but no on-person shot has been made since --since yet:
// run one casting session or reshoot (or a Step Flow model shot) and run this again.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const STAMP_COMMIT = 'df79da8'
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }

const since = arg('since')
if (!since || Number.isNaN(Date.parse(since))) {
  console.error('usage: --since <ISO time the ship went live>')
  process.exit(2)
}

const envFile = arg('env') ?? 'backend/.env'
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(2)
}

let failed = 0
const report = (ok, label, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

// 1. The stamping code is on production's branch.
try { execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: 'ignore' }) } catch { /* offline: use the last fetch */ }
let onMain = false
try { execFileSync('git', ['merge-base', '--is-ancestor', STAMP_COMMIT, 'origin/main'], { stdio: 'ignore' }); onMain = true } catch { /* not an ancestor */ }
report(onMain, `${STAMP_COMMIT} is an ancestor of origin/main`)

const rest = async (path) => {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}
const sinceQ = encodeURIComponent(new Date(since).toISOString())

// 2. Every on-person row written since the ship carries metadata.model_id.
const shots = await rest(
  `product_assets?select=id,product_id,asset_role,created_at,metadata&asset_role=like.mockup_model_*&created_at=gte.${sinceQ}&order=created_at.desc&limit=200`
)
for (const s of shots) {
  const id = s.metadata?.model_id
  report(typeof id === 'string' && id.length > 0, `on-person row ${s.id} (${s.asset_role}, product ${s.product_id}, ${s.created_at})`, id ? `model_id ${id}` : 'model_id missing')
}

// 3. The Step Flow engine line for each product = the newest row in its slot's metadata.model_id
//    (resolveStepFlow, backend/services/step-flow/shots.ts). Read it the same way: newest per role.
const products = [...new Set(shots.map((s) => s.product_id))]
for (const pid of products) {
  const rows = await rest(
    `product_assets?select=asset_role,created_at,metadata&product_id=eq.${pid}&asset_role=like.mockup_model_*&order=created_at.desc`
  )
  const newestByRole = new Map()
  for (const r of rows) if (!newestByRole.has(r.asset_role)) newestByRole.set(r.asset_role, r)
  for (const [role, r] of newestByRole) {
    const engine = r.metadata?.model_id
    if (Date.parse(r.created_at) < Date.parse(since)) continue
    report(typeof engine === 'string' && engine.length > 0, `engine line ${pid} ${role}`, engine ? `shows ${engine}` : 'would show blank')
  }
}

// 4. Step Flow model-shot jobs since the ship record what drew them in ai_jobs.output.
const jobs = await rest(
  `ai_jobs?select=id,status,output,created_at&type=eq.step_flow_model_shot&created_at=gte.${sinceQ}&status=in.(succeeded,failed)&order=created_at.desc&limit=100`
)
for (const j of jobs) {
  if (!j.output?.url) continue // failed before a picture existed: nothing was drawn
  const id = j.output.model_id
  report(typeof id === 'string' && id.length > 0, `ai_jobs ${j.id} (${j.status}, ${j.created_at})`, id ? `model_id ${id}` : 'model_id missing')
}

const seen = shots.length + jobs.filter((j) => j.output?.url).length
console.log(`\non-person rows since ${since}: ${shots.length}; step-flow shot jobs with a picture: ${seen - shots.length}`)
const result = failed ? 'FAIL' : seen === 0 ? 'WAITING' : 'PASS'
console.log(`RESULT: ${result}${result === 'WAITING' ? ' (no on-person shot made since --since; run one casting/reshoot, then re-run)' : ''}`)
process.exit(failed ? 1 : 0)
