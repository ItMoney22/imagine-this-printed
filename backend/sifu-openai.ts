// Where the store backend's OpenAI key comes from (Sifu, task bef81073).
//
// With SIFU_APP_TOKEN set, the backend asks Sifu (the vault keeper on davidtrinidad.com) for its OpenAI key ONCE at
// boot, before any module builds an OpenAI client, and puts the answer in process.env.OPENAI_API_KEY for this process
// only. Nothing is written to disk and the key is never logged.
//   - granted (200): the store runs on the key Sifu handed over (OPENAI_API_KEY_ITP in the vault).
//   - refused (403): Sifu cut the store off. The key is blanked, so AI features stay off and the store stays up.
//   - Sifu unreachable (network, timeout, 404, 5xx): the store keeps whatever OPENAI_API_KEY its host env still holds
//     (break-glass), so a davidtrinidad.com outage never takes the store down. With no break-glass copy, AI is off.
// Without SIFU_APP_TOKEN nothing changes: the backend reads OPENAI_API_KEY from its env as before.
//
// Why "blanked" and not "removed": about 30 modules build `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` at import
// time, and the SDK throws on an undefined key, which would crash the whole backend. An empty key builds, every
// `if (!process.env.OPENAI_API_KEY)` guard reads it as "no key", and a call that slips through gets a 401.
// The ask is synchronous (a short child process) for the same reason: those clients are built at import time.
import { execFileSync } from 'node:child_process'

export const SIFU_OPENAI_URL = 'https://davidtrinidad.com/api/sifu/openai-app'
const TIMEOUT_MS = 10_000

export type SifuAnswer =
  | { status: number; granted?: boolean; key?: string; reason?: string }
  | { status: 0; error: string }

// Runs in the child. It reads the URL and token from its env, never from argv, and prints one JSON line.
const ASK = `
fetch(process.env.SIFU_ASK_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sifu-app-token': process.env.SIFU_ASK_TOKEN },
  body: JSON.stringify({ app: 'imagine-this-printed', caller: 'backend' }),
  signal: AbortSignal.timeout(${TIMEOUT_MS}),
}).then(async (r) => {
  let b = {}
  try { b = await r.json() } catch {}
  process.stdout.write(JSON.stringify({ status: r.status, granted: b.granted, key: b.key, reason: b.reason }))
}).catch((e) => process.stdout.write(JSON.stringify({ status: 0, error: String((e && e.message) || e) })))
`

/** Ask Sifu for the store's key. Blocks for at most a few seconds. */
export function askSifu(url: string, token: string): SifuAnswer {
  try {
    const out = execFileSync(process.execPath, ['-e', ASK], {
      env: { ...process.env, SIFU_ASK_URL: url, SIFU_ASK_TOKEN: token },
      encoding: 'utf8',
      timeout: TIMEOUT_MS + 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(out) as SifuAnswer
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message.split('\n')[0] : String(err) }
  }
}

/** Apply Sifu's answer to the env. Returns the one line to log; it never contains the key. */
export function applySifuAnswer(env: NodeJS.ProcessEnv, answer: SifuAnswer): string {
  if (answer.status === 200 && 'granted' in answer && answer.granted && answer.key) {
    env.OPENAI_API_KEY = answer.key
    return "[sifu] OpenAI: running on the store's Sifu grant"
  }
  if (answer.status === 403) {
    env.OPENAI_API_KEY = ''
    return `[sifu] OpenAI refused by Sifu (${('reason' in answer && answer.reason) || 'no reason given'}). AI features are off until Sifu says yes.`
  }
  const why = 'error' in answer ? answer.error : `answered ${answer.status}`
  if (env.OPENAI_API_KEY) return `[sifu] could not reach Sifu (${why}); running on the break-glass OPENAI_API_KEY from the host env`
  env.OPENAI_API_KEY = ''
  return `[sifu] could not reach Sifu (${why}) and the host env holds no OPENAI_API_KEY: AI features are off`
}

/** Called once from load-env.ts, before any OpenAI client is built. */
export function loadOpenAIKeyFromSifu(env: NodeJS.ProcessEnv = process.env, ask: typeof askSifu = askSifu): void {
  const token = env.SIFU_APP_TOKEN?.trim()
  if (!token) return
  console.log(applySifuAnswer(env, ask(env.SIFU_OPENAI_URL?.trim() || SIFU_OPENAI_URL, token)))
}
