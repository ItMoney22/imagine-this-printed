import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import http, { type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import express from 'express'
import pino from 'pino'
import pinoHttp from 'pino-http'
import { LOG_REDACT, SECRET_REQUEST_HEADERS } from './log-redaction.js'

const BACKEND = join(process.cwd(), 'backend')
const CENSOR = '[redacted]'

// One value per header, so a line that leaks any of them names the header that leaked.
const secrets = Object.fromEntries(SECRET_REQUEST_HEADERS.map((name, i) => [name, `raw-${i}-${name}-value`]))
const SET_COOKIE = 'sb-session=raw-set-cookie-value; HttpOnly'

/** Sends one real request through the same logger shape backend/index.ts builds, and returns what was written. */
async function logOneRequest(headers: Record<string, string>) {
  let written = ''
  const sink = new Writable({
    write(chunk, _enc, done) {
      written += chunk.toString()
      done()
    }
  })

  let seen: IncomingMessage | undefined
  let seenAtHandler: string | undefined
  const app = express()
  app.use(pinoHttp({ logger: pino({ redact: LOG_REDACT }, sink) }))
  app.get('/api/print-bridge/queue', (req, res) => {
    seen = req
    seenAtHandler = req.headers.authorization
    res.setHeader('set-cookie', SET_COOKIE)
    res.json({ ok: true })
  })

  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve, reject) => {
    http
      .get({ port, path: '/api/print-bridge/queue', headers }, res => {
        res.resume()
        res.on('end', () => resolve())
      })
      .on('error', reject)
  })
  await new Promise(resolve => server.close(resolve))
  await new Promise(resolve => setImmediate(resolve))

  return { written, line: JSON.parse(written.trim().split('\n').pop() as string), seen, seenAtHandler }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('request log redaction', () => {
  it('writes [redacted] for every secret header and never the raw value', async () => {
    const { written, line } = await logOneRequest({ ...secrets, 'user-agent': 'redaction-test' })

    expect(written).not.toBe('')
    for (const name of SECRET_REQUEST_HEADERS) {
      expect(line.req.headers[name]).toBe(CENSOR)
      expect(written).not.toContain(secrets[name])
    }
  })

  it('covers the headers the card names, and a signed-in Bearer token', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.raw-shopper-session.signature'
    const { written, line } = await logOneRequest({
      authorization: `Bearer ${jwt}`,
      cookie: 'sb-auth=raw-cookie-value',
      'x-internal-secret': 'raw-internal-secret',
      'x-api-key': 'raw-api-key'
    })

    expect(line.req.headers.authorization).toBe(CENSOR)
    expect(line.req.headers.cookie).toBe(CENSOR)
    expect(line.req.headers['x-internal-secret']).toBe(CENSOR)
    expect(line.req.headers['x-api-key']).toBe(CENSOR)
    for (const raw of [jwt, 'raw-cookie-value', 'raw-internal-secret', 'raw-api-key']) {
      expect(written).not.toContain(raw)
    }
  })

  it('redacts a cookie the response sets', async () => {
    const { written, line } = await logOneRequest({})

    expect(line.res.headers['set-cookie']).toBe(CENSOR)
    expect(written).not.toContain('raw-set-cookie-value')
  })

  it('keeps the rest of the line, so the logs stay useful', async () => {
    const { line } = await logOneRequest({ authorization: 'Bearer x', 'user-agent': 'redaction-test' })

    expect(line.req.method).toBe('GET')
    expect(line.req.url).toBe('/api/print-bridge/queue')
    expect(line.req.headers['user-agent']).toBe('redaction-test')
    expect(line.res.statusCode).toBe(200)
  })

  it('never touches the live request, so auth after the logger still reads the real header', async () => {
    const { seen, seenAtHandler } = await logOneRequest({ authorization: 'Bearer still-real' })

    expect(seenAtHandler).toBe('Bearer still-real')
    expect(seen?.headers.authorization).toBe('Bearer still-real')
  })
})

describe('request log redaction wiring', () => {
  it('backend/index.ts builds its logger with the redaction', () => {
    const index = readFileSync(join(BACKEND, 'index.ts'), 'utf8')

    expect(index).toMatch(/const logger = pino\(\{[^}]*redact: LOG_REDACT/)
    expect(index).toMatch(/pinoHttp\(\{\s*logger,/)
  })

  it('names every secret-shaped header the API reads, so a new one cannot leak unnoticed', () => {
    const read = /req\.headers\[['"]([^'"]+)['"]\]|req\.headers\.([a-z]+)\b|req\.(?:get|header)\(['"]([^'"]+)['"]\)/gi
    const secretShaped = /auth|cookie|secret|token|signature|key/i

    const names = new Set<string>()
    for (const file of sourceFiles(BACKEND)) {
      for (const match of readFileSync(file, 'utf8').matchAll(read)) {
        names.add((match[1] ?? match[2] ?? match[3]).toLowerCase())
      }
    }

    expect(names.size).toBeGreaterThan(5)
    expect([...names].filter(name => secretShaped.test(name) && !SECRET_REQUEST_HEADERS.includes(name))).toEqual([])
  })
})
