import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  projectRefFromSupabaseUrl,
  decodeJwtPayload,
  maskSecret,
  checkSupabaseServiceRoleEnv,
  assertSupabaseServiceRoleEnv,
  formatSupabaseEnvError
} from './supabase-env-guard.js'

// Real Supabase keys are `header.payload.signature` with a base64url payload.
// The signature is never checked here (that needs the project JWT secret), so a
// filler segment is faithful to what the guard actually reads.
function fakeSupabaseKey(payload: Record<string, unknown>): string {
  const seg = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(payload)}.c2lnbmF0dXJlLXBsYWNlaG9sZGVy`
}

const ITP_REF = 'czzyrmizvjqlifcivrhn'
const OTHER_REF = 'yrjoblqqgrposgbvsbxm'
const ITP_URL = `https://${ITP_REF}.supabase.co`

const serviceKey = (ref: string) => fakeSupabaseKey({ iss: 'supabase', ref, role: 'service_role', exp: 2079999999 })
const anonKey = (ref: string) => fakeSupabaseKey({ iss: 'supabase', ref, role: 'anon', exp: 2079999999 })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('projectRefFromSupabaseUrl', () => {
  it('pulls the ref out of a standard project URL', () => {
    expect(projectRefFromSupabaseUrl(ITP_URL)).toBe(ITP_REF)
  })

  it('tolerates a trailing slash, mixed case, and a missing scheme', () => {
    expect(projectRefFromSupabaseUrl(`${ITP_URL}/`)).toBe(ITP_REF)
    expect(projectRefFromSupabaseUrl(`HTTPS://${ITP_REF.toUpperCase()}.SUPABASE.CO`)).toBe(ITP_REF)
    expect(projectRefFromSupabaseUrl(`${ITP_REF}.supabase.co`)).toBe(ITP_REF)
  })

  it('reads the ref from a db.<ref>.supabase.co host', () => {
    expect(projectRefFromSupabaseUrl(`https://db.${ITP_REF}.supabase.co`)).toBe(ITP_REF)
  })

  it('returns null for a custom domain rather than guessing', () => {
    expect(projectRefFromSupabaseUrl('https://api.imaginethisprinted.com')).toBeNull()
  })

  it('returns null for empty or junk input', () => {
    expect(projectRefFromSupabaseUrl('')).toBeNull()
    expect(projectRefFromSupabaseUrl(undefined)).toBeNull()
    expect(projectRefFromSupabaseUrl('not a url at all')).toBeNull()
  })
})

describe('decodeJwtPayload', () => {
  it('decodes claims without verifying the signature', () => {
    expect(decodeJwtPayload(serviceKey(ITP_REF))).toMatchObject({ ref: ITP_REF, role: 'service_role' })
  })

  it('returns null for anything that is not a three-segment JWT', () => {
    expect(decodeJwtPayload('test-service-role-key')).toBeNull()
    expect(decodeJwtPayload('sb_secret_abcdefghijklmnop')).toBeNull()
    expect(decodeJwtPayload('a.b')).toBeNull()
    expect(decodeJwtPayload(undefined)).toBeNull()
  })

  it('returns null when the payload is not decodable JSON', () => {
    expect(decodeJwtPayload('aaa.!!!not-base64!!!.ccc')).toBeNull()
    expect(decodeJwtPayload(`aaa.${Buffer.from('[1,2,3]').toString('base64url')}.ccc`)).toBeNull()
  })

  it('makes no network call - it is pure string work', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    decodeJwtPayload(serviceKey(ITP_REF))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('maskSecret', () => {
  it('never returns the whole key', () => {
    const key = serviceKey(ITP_REF)
    const masked = maskSecret(key)
    expect(masked).not.toContain(key)
    expect(masked).toContain(`len ${key.length}`)
    expect(masked).toContain(key.slice(-6))
  })

  it('handles unset and very short values', () => {
    expect(maskSecret(undefined)).toBe('(unset)')
    expect(maskSecret('abc')).toBe('(len 3)')
  })
})

describe('checkSupabaseServiceRoleEnv', () => {
  it('passes when the key ref matches the URL ref', () => {
    const v = checkSupabaseServiceRoleEnv({ SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: serviceKey(ITP_REF) })
    expect(v).toMatchObject({ ok: true, fatal: false, code: 'match', urlRef: ITP_REF, keyRef: ITP_REF })
  })

  it('is FATAL when the key belongs to another project - the bug this exists for', () => {
    const v = checkSupabaseServiceRoleEnv({ SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: serviceKey(OTHER_REF) })
    expect(v.fatal).toBe(true)
    expect(v.code).toBe('ref-mismatch')
    expect(v.keyRef).toBe(OTHER_REF)
    expect(v.urlRef).toBe(ITP_REF)
  })

  it('is FATAL when an anon key is sitting in the service-role slot', () => {
    const v = checkSupabaseServiceRoleEnv({ SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: anonKey(ITP_REF) })
    expect(v.fatal).toBe(true)
    expect(v.code).toBe('wrong-role')
    expect(v.keyRole).toBe('anon')
  })

  it('does NOT fail an opaque sb_secret_* key or a test placeholder', () => {
    for (const key of ['sb_secret_x8Kd9', 'test-service-role-key']) {
      const v = checkSupabaseServiceRoleEnv({ SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: key })
      expect(v.fatal).toBe(false)
      expect(v.code).toBe('unverifiable-key')
    }
  })

  it('does NOT fail when SUPABASE_URL is a custom domain', () => {
    const v = checkSupabaseServiceRoleEnv({
      SUPABASE_URL: 'https://api.imaginethisprinted.com',
      SUPABASE_SERVICE_ROLE_KEY: serviceKey(OTHER_REF)
    })
    expect(v.fatal).toBe(false)
    expect(v.code).toBe('unverifiable-url')
  })

  it('reports missing variables without claiming a mismatch', () => {
    expect(checkSupabaseServiceRoleEnv({}).code).toBe('missing-url')
    expect(checkSupabaseServiceRoleEnv({ SUPABASE_URL: ITP_URL }).code).toBe('missing-key')
    expect(checkSupabaseServiceRoleEnv({}).fatal).toBe(false)
  })
})

describe('assertSupabaseServiceRoleEnv', () => {
  it('throws on a cross-project key', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      assertSupabaseServiceRoleEnv(
        { SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: serviceKey(OTHER_REF) },
        { skipInTest: false, quiet: true }
      )
    ).toThrow(/different|project/i)
  })

  it('does not throw when the pair agrees', () => {
    expect(() =>
      assertSupabaseServiceRoleEnv(
        { SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: serviceKey(ITP_REF) },
        { skipInTest: false, quiet: true }
      )
    ).not.toThrow()
  })

  it('stays out of the way under the test runner, where placeholder keys are normal', () => {
    const v = assertSupabaseServiceRoleEnv(
      { NODE_ENV: 'test', SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: serviceKey(OTHER_REF) },
      { quiet: true }
    )
    expect(v.code).toBe('skipped')
    expect(v.fatal).toBe(false)
  })
})

describe('formatSupabaseEnvError', () => {
  it('names both refs and the remediation, and leaks no key material', () => {
    const key = serviceKey(OTHER_REF)
    const env = { SUPABASE_URL: ITP_URL, SUPABASE_SERVICE_ROLE_KEY: key }
    const text = formatSupabaseEnvError(checkSupabaseServiceRoleEnv(env), env)
    expect(text).toContain(ITP_REF)
    expect(text).toContain(OTHER_REF)
    expect(text).toContain('override: true')
    expect(text).not.toContain(key)
  })
})
