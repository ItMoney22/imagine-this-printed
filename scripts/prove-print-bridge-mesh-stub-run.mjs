// Safe proof of the --watch fire path in prove-print-bridge-mesh.mjs (task 4ed45c6c). Touches nothing real: every run
// goes through prove-print-bridge-mesh-stub-preload.mjs, with a fake home, a fake queue and a scratch EVIDENCE_DIR.
//   node scripts/prove-print-bridge-mesh-stub-run.mjs [watcher.mjs]   exits 1 if any case fails
// Pass an older copy of the watcher to watch these cases catch it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const watcher = path.resolve(process.argv[2] || path.join(here, 'prove-print-bridge-mesh.mjs'))
const preload = pathToFileURL(path.join(here, 'prove-print-bridge-mesh-stub-preload.mjs')).href
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-watch-stub-'))
const CARD = 'stub-trigger-card'

// A fake home, so the vault's real keys never load.
const home = path.join(scratch, 'home')
fs.mkdirSync(path.join(home, '.secrets'), { recursive: true })
fs.writeFileSync(path.join(home, '.secrets', 'keys.json'), JSON.stringify({ itp: { PRINT_BRIDGE_TOKEN: 'stub-token' } }))

const queueFile = (name, lines) => {
  const file = path.join(scratch, name)
  fs.writeFileSync(file, JSON.stringify({ orders: [{ itpOrderId: 'stub-order', lines }] }))
  return file
}
const expires = Math.floor(Date.now() / 1000) + 720 * 60
const MESHED = queueFile('queue-meshed.json', [{ lineItemId: 'stub-line', glbUrl: `https://storage.googleapis.com/imagine-this-printed-products/stub.glb?Expires=${expires}` }])
const EMPTY = queueFile('queue-empty.json', [{ lineItemId: 'stub-line' }])

let runs = 0
function run({ dir, queue = MESHED, card = CARD, stubs = {}, script = watcher, args = ['--watch'] }) {
  const log = path.join(scratch, `calls-${++runs}.jsonl`)
  fs.writeFileSync(log, '')
  // A clean env, not process.env: a real WATCH_CARD_ID or QUEUE_FILE in this shell must not reach the watcher.
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, USERPROFILE: home, EVIDENCE_DIR: dir, QUEUE_FILE: queue, STUB_LOG: log, ...stubs }
  if (card) env.WATCH_CARD_ID = card
  const out = spawnSync(process.execPath, ['--import', preload, script, ...args], { env, encoding: 'utf8', timeout: 60000 })
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return {
    out: `${out.stdout}${out.stderr}`,
    calls,
    patches: calls.filter((c) => c.call === 'PATCH'),
    posts: calls.filter((c) => c.call === 'POST'),
    deletes: calls.filter((c) => c.call === 'exec' && c.cmd === 'schtasks' && c.args.includes('/Delete')),
    blocked: calls.filter((c) => c.call === 'BLOCKED'),
  }
}

// Fail closed: the stub must own the watcher's named import before any case can reach the /Delete line. The probe only
// asks for /Query, so if the stub had not taken, the worst it does is read a task.
const probe = path.join(scratch, 'probe.mjs')
fs.writeFileSync(probe, "import { execFileSync } from 'node:child_process'\nexecFileSync('schtasks', ['/Query', '/TN', 'stub-probe'], { stdio: 'ignore' })\n")
const probed = run({ dir: path.join(scratch, 'probe'), script: probe, args: [] })
if (!probed.calls.some((c) => c.call === 'exec' && c.args.includes('/Query'))) {
  console.error('REFUSED: the stub did not replace execFileSync, so no case was run.\n' + probed.out)
  process.exit(1)
}
console.log('stub owns execFileSync (probe recorded, nothing executed)')
console.log('watcher:', watcher)
console.log('scratch:', scratch, '\n')

let failed = 0
function report(name, r, checks) {
  const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([what]) => what)
  if (r.blocked.length) bad.push(`blocked calls: ${r.blocked.map((c) => c.url).join(', ')}`)
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${name}: PATCH ${r.patches.length}, POST ${r.posts.length}, schtasks /Delete ${r.deletes.length}`)
  if (bad.length) {
    failed++
    console.log(`      not true: ${bad.join('; ')}`)
    console.log(r.out.trim().split('\n').slice(-6).map((l) => `      | ${l}`).join('\n'))
  }
}
const dirFor = (name) => path.join(scratch, name)
const evidenceFiles = (dir) => fs.readdirSync(dir).filter((f) => /^evidence-.*\.json$/.test(f))
const closesWithNotes = (r) => r.patches.length === 1 && r.patches[0].body.id === CARD && r.patches[0].body.status === 'completed'
  && typeof r.patches[0].body.approval_notes === 'string' && !('result' in r.patches[0].body)

// 1. A good close deletes the task, and the fresh card goes out.
{
  const dir = dirFor('close-200')
  const r = run({ dir })
  const [file] = evidenceFiles(dir)
  const card = r.posts[0]?.body
  const earns = card?.metadata?.earns_or_saves
  report('close 200 -> task deleted, proof card filed', r, {
    'PATCH carries approval_notes and no result': closesWithNotes(r),
    'schtasks /Delete called once': r.deletes.length === 1,
    'proof card POST issued once': r.posts.length === 1,
    'title names the evidence file': card?.title === `ITP: write the print-bridge mesh proof from ${file}`,
    'description names the evidence path': !!card?.description.includes(path.join(dir, file)),
    'earns_or_saves is one line': typeof earns === 'string' && earns.length > 0 && earns.length <= 240 && !/[\r\n]/.test(earns),
    'no other card named by id': !/\b[0-9a-f]{8}\b/i.test(`${card?.title} ${card?.description}`),
  })
  if (r.patches[0]) console.log(`      PATCH body keys: ${Object.keys(r.patches[0].body).join(', ')}`)
  if (card) console.log(`      POST title: ${card.title}\n      POST earns_or_saves: ${earns}`)
}

// 2. A refused close keeps the task; the next run closes it without filing a second card.
{
  const dir = dirFor('close-400')
  const refused = run({ dir, stubs: { STUB_PATCH: '400' } })
  report('close 400 -> no delete, watch stays armed, proof card still filed', refused, {
    'PATCH tried once': refused.patches.length === 1,
    'no schtasks /Delete': refused.deletes.length === 0,
    'proof card POST issued once': refused.posts.length === 1,
    'says it stays armed': refused.out.includes('watch stays armed'),
    'the card tells the reader the close failed': !!refused.posts[0]?.body.description.includes('HTTP 400'),
  })
  const next = run({ dir })
  report('next run, close 200 -> task deleted, no second card', next, {
    'PATCH carries approval_notes and no result': closesWithNotes(next),
    'schtasks /Delete called once': next.deletes.length === 1,
    'no second POST': next.posts.length === 0,
  })
}

// 3. A card that never reached the board keeps the task too, or the proof lane dies as silently as the old close did.
{
  const r = run({ dir: dirFor('card-held'), stubs: { STUB_POST: 'held' } })
  report('close 200, card held by intake (202, no id) -> no delete', r, {
    'no schtasks /Delete': r.deletes.length === 0,
    'no marker, so the next run files again': !fs.existsSync(path.join(dirFor('card-held'), 'proof-card.json')),
  })
}
{
  const r = run({ dir: dirFor('card-refused'), stubs: { STUB_POST: 'refused' } })
  report('close 200, card refused (500) -> no delete', r, { 'no schtasks /Delete': r.deletes.length === 0 })
}

// 4. Without WATCH_CARD_ID nothing changes: no board calls, the task deletes itself as before.
{
  const r = run({ dir: dirFor('no-card'), card: '' })
  report('no WATCH_CARD_ID -> delete, no board calls', r, {
    'no PATCH': r.patches.length === 0,
    'no POST': r.posts.length === 0,
    'schtasks /Delete called once': r.deletes.length === 1,
  })
}

// 5. A bad link is a FAIL fire, and it closes out the same way.
{
  const r = run({ dir: dirFor('link-403'), stubs: { STUB_LINK: '403' } })
  report('link 403, RESULT FAIL -> closes, files, deletes', r, {
    'PATCH carries approval_notes and no result': closesWithNotes(r),
    'card says FAIL': !!r.posts[0]?.body.description.includes('RESULT FAIL'),
    'schtasks /Delete called once': r.deletes.length === 1,
  })
}

// 6. The run that happens every 30 minutes: WAITING touches nothing but watch.log.
{
  const dir = dirFor('waiting')
  const r = run({ dir, queue: EMPTY })
  report('no meshed line, WAITING -> log line only', r, {
    'no PATCH': r.patches.length === 0,
    'no POST': r.posts.length === 0,
    'no schtasks /Delete': r.deletes.length === 0,
    'no evidence file': evidenceFiles(dir).length === 0,
    'watch.log has a WAITING line': fs.readFileSync(path.join(dir, 'watch.log'), 'utf8').includes(' WAITING\n'),
  })
}

console.log(failed ? `\n${failed} case(s) failed` : '\nall cases passed')
process.exitCode = failed ? 1 : 0
