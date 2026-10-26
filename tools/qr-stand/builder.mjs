#!/usr/bin/env node
/**
 * The QR counter stand builder, on Earth next to the A1s (task deebfdca).
 *
 * The shop's backend never builds a stand: a paid order or an admin's rebuild
 * writes a qr_stand_builds row, and this claims it, runs gen.py (which refuses a
 * long link and scan-checks its own face), and posts back the 3mf, the face
 * picture and the scan result. An admin's "Send to print" is claimed here too
 * and handed to the print queue on the dashboard, whose runner slices and
 * sends it to a printer.
 *
 *   node tools/qr-stand/builder.mjs --once           drain both queues, then exit
 *   node tools/qr-stand/builder.mjs --watch 10       poll every 5 s for 10 minutes
 *
 * Task Scheduler runs --watch every 10 minutes with "do not start a new
 * instance", so a stand is picked up within seconds and a crash costs at most
 * one cycle. See README.md.
 *
 * Env (each falls back to the dashboard repo's .env.local, where Earth's copies live):
 *   ITP_API_BASE          default https://api.imaginethisprinted.com
 *   PRINT_BRIDGE_TOKEN    the shop's print-bridge token
 *   DTC_BASE              default https://davidtrinidad.com (the print queue)
 *   DTC_INTERNAL_SECRET   that queue's x-internal-secret (CRON_SECRET)
 *   QR_STAND_PYTHON       default C:/Users/David/.itp-qr-stand/venv/Scripts/python.exe
 *   QR_STAND_SEND_TO_PRINTERS=1   hand print requests to the queue (off until the
 *                         runner slices project files as they stand; see README)
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DTC_ENV = 'D:/Projects for MetaSphere/david-trinidad-com/.env.local'

function fromDtcEnv(name) {
  try {
    const line = readFileSync(DTC_ENV, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
    return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, '') : ''
  } catch {
    return ''
  }
}

const cfg = {
  itp: (process.env.ITP_API_BASE || fromDtcEnv('ITP_API_BASE') || 'https://api.imaginethisprinted.com').replace(/\/$/, ''),
  bridge: process.env.PRINT_BRIDGE_TOKEN || fromDtcEnv('PRINT_BRIDGE_TOKEN'),
  dtc: (process.env.DTC_BASE || 'https://davidtrinidad.com').replace(/\/$/, ''),
  dtcSecret: process.env.DTC_INTERNAL_SECRET || fromDtcEnv('CRON_SECRET'),
  python: process.env.QR_STAND_PYTHON || 'C:/Users/David/.itp-qr-stand/venv/Scripts/python.exe',
  print: process.env.QR_STAND_SEND_TO_PRINTERS === '1',
}

const log = (...a) => console.log(new Date().toISOString(), ...a)

async function itp(pathname, init = {}) {
  const res = await fetch(`${cfg.itp}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.bridge}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(60000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(`${pathname}: HTTP ${res.status} ${body.error || ''}`.trim()), { status: res.status })
  return body
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => child.kill(), 180000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, out, err: String(e) })
    })
  })
}

/** One build: claim, generate + scan-check, report. Returns false when the queue is empty. */
export async function buildOne() {
  const { build, logoUrl } = await itp('/api/qr-stand/builder/claim', { method: 'POST' })
  if (!build) return false
  const dir = await mkdtemp(path.join(tmpdir(), 'qr-stand-'))
  try {
    const out = path.join(dir, 'stand.3mf')
    const args = [path.join(HERE, 'gen.py'), '--url', build.link, '--text', build.caption,
      '--title', `QR Stand ${build.caption}`.slice(0, 60), '--out', out]
    if (logoUrl) {
      const res = await fetch(logoUrl, { signal: AbortSignal.timeout(60000) })
      if (!res.ok) throw new Error(`logo download failed (${res.status})`)
      const logo = path.join(dir, 'logo.png')
      await writeFile(logo, Buffer.from(await res.arrayBuffer()))
      args.push('--logo', logo)
    }
    const { code, out: stdout, err } = await run(cfg.python, args)
    let result = {}
    try {
      result = JSON.parse(stdout.trim().split(/\r?\n/).pop() || '{}')
    } catch {
      result = { error: (err || stdout || 'generator crashed').slice(-400) }
    }
    result.ok = code === 0 && result.scan_ok === true
    const form = new FormData()
    form.set('result', JSON.stringify(result))
    const face = path.join(dir, 'stand-face.png')
    if (await exists(face)) form.set('face', new Blob([await readFile(face)], { type: 'image/png' }), 'face.png')
    if (result.ok) form.set('threemf', new Blob([await readFile(out)], { type: 'model/3mf' }), 'stand.3mf')
    const done = await itp(`/api/qr-stand/builder/${build.id}/result`, { method: 'POST', body: form })
    log(`build ${build.id} -> ${done.status}${result.ok ? ` (v${result.qr_version}, logo ${result.logo}, scans)` : `: ${result.error}`}`)
  } catch (e) {
    // Report the failure so the admin sees it rather than a build stuck at "building".
    log(`build ${build.id} failed: ${e.message}`)
    const form = new FormData()
    form.set('result', JSON.stringify({ ok: false, error: e.message }))
    await itp(`/api/qr-stand/builder/${build.id}/result`, { method: 'POST', body: form }).catch(() => {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  return true
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function dtc(pathname, init = {}) {
  const res = await fetch(`${cfg.dtc}${pathname}`, {
    ...init,
    headers: { 'x-internal-secret': cfg.dtcSecret, ...(init.headers || {}) },
    signal: AbortSignal.timeout(120000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${body.error || ''}`.trim())
  return body
}

/** An enabled printer with an access code, idle ones first. */
export function pickPrinter(printers) {
  const usable = (printers || []).filter((p) => p.enabled && p.hasCode)
  const idle = usable.find((p) => /IDLE|FINISH/i.test(String(p.state?.gcode_state ?? p.state?.print?.gcode_state ?? '')))
  return idle || usable[0] || null
}

/** One print request: claim, park the 3mf in the print queue, report. */
export async function printOne() {
  const { build, threemfUrl } = await itp('/api/qr-stand/builder/print/claim', { method: 'POST' })
  if (!build) return false
  try {
    const file = await fetch(threemfUrl, { signal: AbortSignal.timeout(60000) })
    if (!file.ok) throw new Error(`print file download failed (${file.status})`)
    const bytes = Buffer.from(await file.arrayBuffer())
    const { printers } = await dtc('/api/print/jobs')
    const printer = pickPrinter(printers)
    if (!printer) throw new Error('no printer is enabled with its access code set')
    const name = `qr-stand-${(build.orderNumber || build.orderId).replace(/[^A-Za-z0-9-]/g, '')}-${build.lineIndex}`
    const { key } = await dtc(`/api/print/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'model/3mf' },
      body: bytes,
    })
    const job = await dtc('/api/print/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        printerId: printer.id,
        stlKey: key,
        title: `QR stand: ${build.caption} (${build.orderNumber || 'ITP order'})`,
        filename: name,
        quantity: 1,
        material: 'PLA Basic',
        // White plate, black face. The change itself is inside the 3mf at 6.2 mm;
        // these two tell the runner which AMS slots to map.
        filament: [
          { name: 'White', hex: '#FFFFFF' },
          { name: 'Black', hex: '#161616', part: 'code, words and logo' },
        ],
        requestedBy: 'itp-qr-stand',
        notes: `ITP order ${build.orderNumber || build.orderId}, stand line ${build.lineIndex + 1}. Print file is a ready project (gen.py): slice as it stands.`,
      }),
    })
    await itp(`/api/qr-stand/builder/print/${build.id}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, jobId: job.jobId, printer: job.printerLabel || printer.label }),
    })
    log(`print ${build.id} -> job ${job.jobId} on ${job.printerLabel || printer.label}`)
  } catch (e) {
    log(`print ${build.id} failed: ${e.message}`)
    await itp(`/api/qr-stand/builder/print/${build.id}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: e.message }),
    }).catch(() => {})
  }
  return true
}

async function drain() {
  while (await buildOne()) {}
  if (cfg.print) while (await printOne()) {}
}

async function main() {
  if (!cfg.bridge) throw new Error('PRINT_BRIDGE_TOKEN is not set and was not found in the dashboard .env.local')
  const args = process.argv.slice(2)
  if (args.includes('--watch')) {
    const minutes = Number(args[args.indexOf('--watch') + 1]) || 10
    const until = Date.now() + minutes * 60000
    log(`watching ${cfg.itp} for ${minutes} min (printing ${cfg.print ? 'on' : 'off'})`)
    while (Date.now() < until) {
      const stop = await drain().then(
        () => false,
        (e) => {
          // A shop without the builder lane (not shipped there yet) answers 404:
          // say so once and wait for the next scheduled run, not every 5 s.
          if (e.status === 404) {
            log(`${cfg.itp} has no QR stand builder lane yet; trying again next run`)
            return true
          }
          log(`cycle failed: ${e.message}`)
          return false
        }
      )
      if (stop) return
      await new Promise((r) => setTimeout(r, 5000))
    }
    return
  }
  await drain()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    log(e.message)
    process.exit(1)
  })
}
