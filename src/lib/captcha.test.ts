import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Guards the two ways signup captcha fails SILENTLY.
 *
 * Neither of these shows up as a red test, a type error or a console warning
 * when it breaks. The first one takes signup down in production only, on a page
 * that looks fine in review. The second one takes sign-in down for every real
 * customer the moment Bot & Abuse Protection is switched on in the Supabase
 * dashboard — with no way to switch it back from inside the app.
 *
 * Both are cheap to assert as text, so they are asserted as text.
 * Context: docs/SIGNUP_BOT_PROTECTION.md, Watchtower 4d915741.
 */

const repoRoot = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8')

describe('Turnstile is allowed by the production CSP', () => {
  // Cloudflare serves the challenge script, the challenge iframe and the
  // verification XHR from this one host. Miss any of the three directives and
  // the widget never renders — the form then holds its submit button forever
  // and signup is dead, with nothing in the build output to say why.
  const csp: string = (() => {
    const vercel = JSON.parse(read('vercel.json'))
    const headers = vercel.headers.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers)
    const found = headers.find((h: { key: string }) => h.key === 'Content-Security-Policy')
    if (!found) throw new Error('vercel.json no longer sets a Content-Security-Policy header')
    return found.value as string
  })()

  const directive = (name: string) => {
    const match = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `))
    if (!match) throw new Error(`CSP has no ${name} directive`)
    return match
  }

  it.each(['script-src', 'frame-src', 'connect-src'])(
    'allows challenges.cloudflare.com in %s',
    (name) => {
      expect(directive(name)).toContain('https://challenges.cloudflare.com')
    }
  )
})

describe('every captcha-protected GoTrue call carries the token', () => {
  // Supabase applies Bot & Abuse Protection to signup, password sign-in, magic
  // link and password reset TOGETHER — it is one dashboard switch, not four.
  // A call that forgets options.captchaToken is not a degraded experience, it
  // is a locked door: that flow returns a captcha error for everyone and the
  // only fix is turning protection back off for all four.
  const source = read('src/context/SupabaseAuthContext.tsx')

  const callsite = (method: string) => {
    const at = source.indexOf(method)
    if (at === -1) throw new Error(`${method} is no longer called in SupabaseAuthContext`)
    // The options object always lands within a few lines of the call.
    return source.slice(at, at + 400)
  }

  it.each([
    'supabase.auth.signUp(',
    'supabase.auth.signInWithPassword(',
    'supabase.auth.signInWithOtp(',
    'supabase.auth.resetPasswordForEmail(',
  ])('%s passes captchaOptions', (method) => {
    expect(callsite(method)).toContain('captchaOptions(captchaToken)')
  })

  it('does not send captchaToken: undefined, which GoTrue rejects outright', () => {
    // The helper must return {} rather than { captchaToken: undefined } — an
    // explicit undefined is serialised into the request body and refused once
    // protection is on, which would break every flow at once including the
    // ones that never had a widget.
    expect(source).toContain('captchaToken ? { captchaToken } : {}')
  })
})
