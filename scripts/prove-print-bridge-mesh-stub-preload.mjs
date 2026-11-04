// Preload for prove-print-bridge-mesh-stub-run.mjs (task 4ed45c6c). Loaded with node --import, before the watcher.
// Replaces everything the --watch fire path can reach outside this process, and records each call to STUB_LOG:
//   globalThis.fetch            mesh links and the board answer from here; any other URL throws, nothing reaches the network
//   child_process.execFileSync  recorded, never run, so schtasks /Delete cannot touch the real Earth task
//   fs.readFileSync             the dashboard env file reads as a fake CRON_SECRET, so the real one never loads
// Knobs: STUB_PATCH (close status, default 200), STUB_POST (ok | held | refused), STUB_LINK (mesh link status, default 200).
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const logFile = process.env.STUB_LOG
if (!logFile) throw new Error('STUB_LOG is required')
const record = (entry) => fs.appendFileSync(logFile, JSON.stringify(entry) + '\n')
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input)
  const method = init.method || 'GET'
  if (url.startsWith('https://storage.googleapis.com/')) {
    record({ call: 'link', url })
    return new Response('stub mesh bytes', { status: Number(process.env.STUB_LINK || 200) })
  }
  if (url === 'https://davidtrinidad.com/api/tasks/internal' && method === 'PATCH') {
    const body = JSON.parse(init.body)
    record({ call: 'PATCH', body, secret: init.headers['x-internal-secret'] })
    // The live board's own refusal (david-trinidad-com src/lib/task-patch.ts), so old code gets the answer it got live.
    if (body.result !== undefined) return json(400, { error: 'result is not a tasks column; put close-out proof in approval_notes' })
    const status = Number(process.env.STUB_PATCH || 200)
    return status < 300 ? json(status, { id: body.id, status: body.status }) : json(status, { error: 'stub refusal' })
  }
  if (url === 'https://davidtrinidad.com/api/tasks/internal' && method === 'POST') {
    const body = JSON.parse(init.body)
    record({ call: 'POST', body, secret: init.headers['x-internal-secret'] })
    const mode = process.env.STUB_POST || 'ok'
    if (mode === 'held') return json(202, { id: null, digested: true, reason: 'stub intake hold' })
    if (mode === 'refused') return json(500, { error: 'stub refusal' })
    return json(200, { id: 'stub-proof-card' })
  }
  record({ call: 'BLOCKED', url, method })
  throw new Error(`stub blocked ${method} ${url}`)
}

childProcess.execFileSync = (cmd, args = []) => {
  record({ call: 'exec', cmd, args })
  return Buffer.from('')
}
syncBuiltinESMExports()

const realRead = fs.readFileSync
fs.readFileSync = (file, ...rest) => {
  if (String(file).replace(/\\/g, '/').endsWith('david-trinidad-com/.env.local')) return 'CRON_SECRET=stub-secret\n'
  return realRead(file, ...rest)
}
