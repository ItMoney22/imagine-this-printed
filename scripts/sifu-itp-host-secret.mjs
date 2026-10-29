#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Move WATCHTOWER_INTERNAL_SECRET on ITP's live hosts to davidtrinidad.com's
// current CRON_SECRET (Sifu, task 5d50db79, follow-up of the CRON_SECRET
// rotation e5295c9c). Value-free: it prints env NAMES and sha-256 prefixes only.
//
//   node scripts/sifu-itp-host-secret.mjs names
//       env NAMES on Render api + worker and Fly api + worker; for the one name,
//       the sha-256 prefix of what each Render service holds.
//   node scripts/sifu-itp-host-secret.mjs set --expect <sha-256 prefix> [--apply]
//       dry run unless --apply. Only hosts that ALREADY hold the name move:
//       Render: PUT the one env var, then a deploy_only deploy (last good build,
//       no rebuild, no new code), api first and health-gated, then the worker.
//       Fly: staged only (`fly secrets import --stage`, value on stdin), and only
//       while every machine of the app is stopped; a running Fly app is refused.
//   node scripts/sifu-itp-host-secret.mjs prove --expect <sha-256 prefix>
//       davidtrinidad.com 200 with the value, Render read-back prefixes, deploy
//       status, ITP /api/health.
//
// The value is davidtrinidad.com's CRON_SECRET from its .env.local (the vault's
// current copy, written there by scripts/sifu-cron-rotate.ts). Render and Fly
// tokens come from ~/.secrets/keys.json.
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const NAME = 'WATCHTOWER_INTERNAL_SECRET'
const DTC_ENV = process.env.DTC_ENV_FILE || 'D:/Projects for MetaSphere/david-trinidad-com/.env.local'
const PROOF_URL = 'https://davidtrinidad.com/api/tasks/internal?limit=1'
const ITP_HEALTH = 'https://api.imaginethisprinted.com/api/health'
// api first: it has a public health check to gate the worker on.
const RENDER = [
  { label: 'render api', id: 'srv-d7jpgut7vvec739bsid0', health: ITP_HEALTH },
  { label: 'render worker', id: 'srv-d7jppnn7f7vs73bb4p80', health: null },
]
const FLY = ['imagine-this-printed-api', 'imagine-this-printed-worker']

const keys = JSON.parse(readFileSync(homedir() + '/.secrets/keys.json', 'utf8').replace(/^\uFEFF/, ''))
const RENDER_KEY = keys.render?.RENDER_API_KEY
const FLY_TOKEN = keys.fly?.FLY_API_TOKEN
const sha = (v) => (v ? createHash('sha256').update(v).digest('hex').slice(0, 10) : '(unset)')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function envFileValue(file, name) {
  const m = readFileSync(file, 'utf8').match(new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*(.*?)[ \\t]*\\r?$`, 'm'))
  return m ? m[1].replace(/^["']|["']$/g, '') : null
}

async function render(path, init = {}) {
  const r = await fetch('https://api.render.com/v1' + path, {
    ...init,
    headers: { authorization: 'Bearer ' + RENDER_KEY, accept: 'application/json', 'content-type': 'application/json' },
  })
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: r.status, body }
}

async function renderEnv(id) {
  const out = []
  let cursor = ''
  for (;;) {
    const { status, body } = await render(`/services/${id}/env-vars?limit=100${cursor ? '&cursor=' + cursor : ''}`)
    if (status !== 200) throw new Error(`Render env list ${id}: HTTP ${status}`)
    for (const row of body) out.push(row.envVar)
    if (body.length < 100) return out
    cursor = body[body.length - 1].cursor
  }
}

async function flyMachines(app) {
  const r = await fetch(`https://api.machines.dev/v1/apps/${app}/machines`, { headers: { authorization: 'Bearer ' + FLY_TOKEN } })
  if (r.status !== 200) throw new Error(`Fly machines ${app}: HTTP ${r.status}`)
  return r.json()
}

async function flySecrets(app) {
  const r = await fetch(`https://api.machines.dev/v1/apps/${app}/secrets`, { headers: { authorization: 'Bearer ' + FLY_TOKEN } })
  if (r.status !== 200) throw new Error(`Fly secrets ${app}: HTTP ${r.status}`)
  const body = await r.json()
  return Array.isArray(body) ? body : body.secrets
}

/** flyctl with the token in its env and NAME=VALUE lines on stdin, so no value is ever on a command line. */
function fly(args, stdin) {
  const r = spawnSync('fly', args, { input: stdin, encoding: 'utf8', env: { ...process.env, FLY_API_TOKEN: FLY_TOKEN }, shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`fly ${args.join(' ')}: exit ${r.status}`)
}

async function probe(url, secret) {
  const r = await fetch(url, { headers: secret ? { 'x-internal-secret': secret } : {} })
  return r.status
}

function target() {
  const expect = process.argv[process.argv.indexOf('--expect') + 1]
  if (!process.argv.includes('--expect') || !/^[0-9a-f]{6,}$/.test(expect || '')) throw new Error('pass --expect <sha-256 prefix of the new value>')
  const value = envFileValue(DTC_ENV, 'CRON_SECRET')
  if (!value || !createHash('sha256').update(value).digest('hex').startsWith(expect)) {
    throw new Error(`CRON_SECRET in ${DTC_ENV} is ${sha(value)}, not ${expect}: refusing`)
  }
  return value
}

async function names() {
  for (const s of RENDER) {
    const env = await renderEnv(s.id)
    const row = env.find((e) => e.key === NAME)
    console.log(`${s.label} ${s.id}: ${env.length} names; ${NAME} = ${row ? sha(row.value) : '(not set)'}`)
    console.log('  ' + env.map((e) => e.key).sort().join(', '))
  }
  for (const app of FLY) {
    const [ms, secrets] = await Promise.all([flyMachines(app), flySecrets(app)])
    const row = secrets.find((x) => x.name === NAME)
    console.log(`fly ${app}: machines ${ms.map((m) => m.state).join('/') || 'none'}; ${secrets.length} names; ${NAME} ${row ? `set ${row.updated_at ?? row.created_at}, digest ${String(row.digest).slice(0, 6)}…` : '(not set)'}`)
    console.log('  ' + secrets.map((x) => x.name).sort().join(', '))
  }
}

async function waitLive(id, deployId) {
  for (let i = 0; i < 90; i++) {
    const { body } = await render(`/services/${id}/deploys/${deployId}`)
    if (body.status === 'live') return body
    if (/failed|canceled|deactivated/.test(body.status)) throw new Error(`deploy ${deployId} ended ${body.status}`)
    await sleep(10_000)
  }
  throw new Error(`deploy ${deployId} not live after 15 min`)
}

async function set() {
  const value = target()
  const apply = process.argv.includes('--apply')
  const before = await probe(PROOF_URL, value)
  console.log(`davidtrinidad.com with the new value: ${before}`)
  if (before !== 200) throw new Error('davidtrinidad.com does not take the new value yet: refusing to push it to the hosts')

  for (const s of RENDER) {
    const row = (await renderEnv(s.id)).find((e) => e.key === NAME)
    if (!row) { console.log(`${s.label}: does not hold ${NAME}, left alone`); continue }
    if (row.value === value) { console.log(`${s.label}: already ${sha(value)}`); continue }
    console.log(`${s.label}: ${sha(row.value)} -> ${sha(value)}${apply ? '' : ' (dry run)'}`)
    if (!apply) continue
    const put = await render(`/services/${s.id}/env-vars/${NAME}`, { method: 'PUT', body: JSON.stringify({ value }) })
    if (put.status !== 200) throw new Error(`${s.label} PUT: HTTP ${put.status}`)
    const back = (await renderEnv(s.id)).find((e) => e.key === NAME)
    console.log(`  read-back ${sha(back?.value)}`)
    if (back?.value !== value) throw new Error(`${s.label}: read-back does not match`)
    const dep = await render(`/services/${s.id}/deploys`, { method: 'POST', body: JSON.stringify({ deployMode: 'deploy_only' }) })
    if (dep.status >= 300) throw new Error(`${s.label} deploy: HTTP ${dep.status}`)
    console.log(`  deploy_only ${dep.body.id} (commit ${dep.body.commit?.id?.slice(0, 8)}) started`)
    const live = await waitLive(s.id, dep.body.id)
    console.log(`  live ${live.finishedAt}`)
    if (s.health) {
      const h = await probe(s.health)
      console.log(`  health ${s.health}: ${h}`)
      if (h !== 200) throw new Error(`${s.label}: health ${h} after the deploy, stopping before the next service`)
    }
  }

  for (const app of FLY) {
    const secrets = await flySecrets(app)
    const row = secrets.find((x) => x.name === NAME)
    if (!row) { console.log(`fly ${app}: does not hold ${NAME}, left alone`); continue }
    const running = (await flyMachines(app)).filter((m) => m.state !== 'stopped' && m.state !== 'suspended')
    if (running.length) { console.log(`fly ${app}: ${running.length} machine(s) running, a staged secret would not reach them: refused`); continue }
    console.log(`fly ${app}: staged set of ${NAME}${apply ? '' : ' (dry run)'}`)
    if (!apply) continue
    fly(['secrets', 'import', '--stage', '-a', app], `${NAME}=${value}\n`)
    // Fly's digest is not a plain sha-256 (measured 2026-10-29), so prove the value by
    // staging the same value under a probe name and comparing digests, then dropping it.
    const probeName = 'SIFU_DIGEST_PROBE_5D50DB79'
    fly(['secrets', 'import', '--stage', '-a', app], `${probeName}=${value}\n`)
    const after = await flySecrets(app)
    const held = after.find((x) => x.name === NAME)
    const ref = after.find((x) => x.name === probeName)
    fly(['secrets', 'unset', '--stage', '-a', app, probeName])
    const gone = !(await flySecrets(app)).some((x) => x.name === probeName)
    console.log(`  digest changed: ${held?.digest !== row.digest}; equals the probe of the new value: ${!!held && held.digest === ref?.digest}; probe removed: ${gone}`)
    const still = (await flyMachines(app)).filter((m) => m.state !== 'stopped' && m.state !== 'suspended')
    console.log(`  machines still stopped: ${still.length === 0}`)
  }
}

async function prove() {
  const value = target()
  console.log(`davidtrinidad.com ${PROOF_URL.replace('https://davidtrinidad.com', '')} with the new value: ${await probe(PROOF_URL, value)}`)
  for (const s of RENDER) {
    const row = (await renderEnv(s.id)).find((e) => e.key === NAME)
    const { body } = await render(`/services/${s.id}/deploys?limit=1`)
    const d = body[0]?.deploy
    console.log(`${s.label}: ${NAME} = ${sha(row?.value)}; newest deploy ${d?.id} ${d?.status} ${d?.trigger} commit ${d?.commit?.id?.slice(0, 8)} finished ${d?.finishedAt}`)
  }
  console.log(`ITP health ${ITP_HEALTH}: ${await probe(ITP_HEALTH)}`)
}

const mode = process.argv[2]
const run = { names, set, prove }[mode]
if (!run) { console.error('usage: names | set --expect <prefix> [--apply] | prove --expect <prefix>'); process.exit(2) }
run().catch((e) => { console.error('refused: ' + e.message); process.exit(1) })
