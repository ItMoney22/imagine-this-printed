// ---------------------------------------------------------------------------
// Automatic signup-bot sweep: Jev looks at every new account and deletes the
// scripted ones as they arrive, so David stops clearing them by hand.
//
// THE HOLE THIS CLOSES
// Scripted signups have hit the store since August at 10-20 a day. The admin
// "Scan for bot signups" panel (routes/admin/users.ts) found them, but it only
// ran when David clicked it, and its name test only knew one shape of fake
// name: a run of 4+ consonants ("Lrfflx Beywpro"). The September wave moved
// to names with 3-consonant runs ("Aagkv Oqpwixto", "Ylquul Lkzuehn") and got
// straight past it. David deleted 29 on 9/21 and 35 more on 9/24 by hand.
//
// WHO DECIDES
// Jev (lib/jev.ts) reads each new account and picks bot / real_person /
// unsure. The fixed fingerprints (lib/bot-signals.ts) back it up:
//   - Jev says bot with confidence >= JEV_BOT_BAR          -> delete
//   - a hard fingerprint (generated name, dot-injected
//     Gmail), and Jev does NOT say real_person >= its bar  -> delete
//   - anything else                                        -> keep
// If Jev is down, only the fingerprints can delete, which is exactly what the
// admin scan already did. Jev being down never deletes anyone new.
//
// WHO IS NEVER TOUCHED (checked before Jev is asked)
//   - anyone who has ever signed in. Bots never do; a person who logged in
//     even once is a customer, whatever their name looks like
//   - accounts older than the window. Old accounts stay David's call
//   - any role except customer, and any account that owns an order
//   - addresses in BOT_SWEEP_PROTECT (comma-separated)
// Postgres adds a last guard: orders and the ITC/points ledger are ON DELETE
// NO ACTION, so an account with history refuses to delete at all.
//
// Every delete writes an audit_logs row (USER_BOT_SWEEP_DELETE) holding the
// full account snapshot and Jev's verdict, so a wrong call can be seen and the
// person re-invited.
//
// Modes: BOT_SWEEP=on (default) | shadow (decide + log, delete nothing) | off.
// Every I/O touch goes through BotSweepDeps so the tests run with no database.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase.js'
import { askJev as liveAskJev, readChoice, type AskJev, type JevChoiceQuestion } from '../lib/jev.js'
import { looksDotInjected, looksGenerated } from '../lib/bot-signals.js'

export type BotSweepMode = 'on' | 'shadow' | 'off'

export function botSweepMode(raw = process.env.BOT_SWEEP): BotSweepMode {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'off' || v === 'shadow' ? v : 'on'
}

/** Only accounts this new are judged. Older ones are left for a human. */
export const BOT_SWEEP_WINDOW_HOURS = Math.max(1, Number(process.env.BOT_SWEEP_WINDOW_HOURS) || 7 * 24)
export const BOT_SWEEP_MINUTES = Math.max(1, Number(process.env.BOT_SWEEP_MINUTES) || 10)
/**
 * Hard cap on deletes per tick. The biggest real wave was 35 in two days, so
 * a tick that wants more than this is doing something new, and a person should
 * look first. Anything over the cap waits for the next tick.
 */
export const BOT_SWEEP_MAX_DELETES = Math.max(1, Number(process.env.BOT_SWEEP_MAX_DELETES) || 25)

/** Jev alone deletes only at this confidence. */
export const JEV_BOT_BAR = 0.9
/** Jev calling an account a real person at this confidence overrules a fingerprint. */
export const JEV_REAL_BAR = 0.75

const FIRST_RUN_DELAY_MS = 90 * 1000

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'outlook.fr',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
  'gmx.com', 'gmx.de', 'mail.com', 'cs.com', 'comcast.net', 'att.net', 'verizon.net', 'suddenlink.net',
])

export interface SignupAccount {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  user_metadata: Record<string, any> | null
}

export const ACCOUNT_VERDICTS = ['bot', 'real_person', 'unsure'] as const
export type AccountVerdict = (typeof ACCOUNT_VERDICTS)[number]

export const ACCOUNT_CRITERIA: Record<AccountVerdict, string> = {
  bot:
    'A scripted signup, not a person. Tells: the first or last name is random letters that is not a real ' +
    'name in any language or culture (for example "Aagkv Oqpwixto", "Ylquul Lkzuehn", "Lrfflx Beywpro"); ' +
    'the name has nothing to do with the email address, which is often a real person\'s work, school or ' +
    'phone-carrier address taken from a harvested list; or a Gmail address with dots scattered through ' +
    'the name part (j.ds.m.i.th.4@gmail.com), which Gmail ignores, so one inbox can sign up again and again.',
  real_person:
    'A human who signed up for themselves. The first and last name are a real, pronounceable name from any ' +
    'language or culture (including short, unusual or non-English names), and the email is ordinary for ' +
    'that person: it contains their name, a nickname, or is a normal personal or work address.',
  unsure:
    'Not enough to tell either way: the name is blank, a single word, a handle or a nickname, or it is ' +
    'odd but could still be a real name.',
}

export function accountQuestion(): Record<string, JevChoiceQuestion> {
  return {
    account: {
      type: 'choice',
      instructions:
        'A new account just signed up on Imagine This Printed, a small custom T-shirt and print shop. ' +
        'Since August the shop has received scripted fake signups every day. Is this account a bot or a real person?',
      criteria: ACCOUNT_CRITERIA,
    },
  }
}

/** What Jev is shown. Facts only. The fingerprints go in as hints, not verdicts. */
export function accountState(u: SignupAccount, now: Date): Record<string, unknown> {
  const meta = u.user_metadata || {}
  const email = (u.email || '').toLowerCase()
  const [local = '', domain = ''] = email.split('@')
  const first = String(meta.first_name ?? '').trim()
  const last = String(meta.last_name ?? '').trim()
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const localSquashed = squash(local)
  const nameInEmail = [first, last].some(n => squash(n).length >= 3 && localSquashed.includes(squash(n)))
  return {
    first_name: first || null,
    last_name: last || null,
    display_name: meta.display_name ?? meta.full_name ?? null,
    email,
    email_domain: domain,
    email_kind: FREE_MAIL.has(domain) ? 'free personal webmail' : 'company, school or other own domain',
    name_appears_in_email: nameInEmail,
    dots_in_email_name_part: (local.match(/\./g) || []).length,
    email_confirmed: Boolean(u.email_confirmed_at),
    minutes_since_signup: Math.round((now.getTime() - new Date(u.created_at).getTime()) / 60000),
  }
}

export interface BotDecision {
  action: 'delete' | 'keep'
  reason: string
  fingerprints: string[]
  jev?: { choice: AccountVerdict; confidence: number }
}

/** Pure: combine the fingerprints with what Jev said. */
export function decideAccount(u: SignupAccount, jev?: { choice: AccountVerdict; confidence: number }): BotDecision {
  const meta = u.user_metadata || {}
  const fingerprints: string[] = []
  if (looksGenerated(meta.first_name) || looksGenerated(meta.last_name)) fingerprints.push('machine-generated name')
  if (looksDotInjected(u.email)) fingerprints.push('dot-injected email local part')

  const jevSaysReal = jev?.choice === 'real_person' && jev.confidence >= JEV_REAL_BAR
  if (jev?.choice === 'bot' && jev.confidence >= JEV_BOT_BAR) {
    return { action: 'delete', reason: `Jev: bot (${jev.confidence.toFixed(2)})`, fingerprints, jev }
  }
  if (fingerprints.length && !jevSaysReal) {
    const jevNote = jev ? `Jev ${jev.choice} ${jev.confidence.toFixed(2)}` : 'Jev unavailable'
    return { action: 'delete', reason: `${fingerprints.join(' + ')} (${jevNote})`, fingerprints, jev }
  }
  const why = jevSaysReal && fingerprints.length
    ? `fingerprint overruled — Jev: real person (${jev!.confidence.toFixed(2)})`
    : jev ? `Jev: ${jev.choice} (${jev.confidence.toFixed(2)})` : 'no fingerprint, Jev unavailable'
  return { action: 'keep', reason: why, fingerprints, jev }
}

export interface BotSweepDeps {
  /** Auth users created at or after `sinceIso`. */
  listSignupsSince(sinceIso: string): Promise<SignupAccount[]>
  /** Of `ids`, the ones that own at least one order. */
  idsWithOrders(ids: string[]): Promise<Set<string>>
  /** user_profiles.role for each id that has a profile. */
  rolesFor(ids: string[]): Promise<Map<string, string>>
  deleteUser(id: string): Promise<{ ok: boolean; reason?: string }>
  audit(u: SignupAccount, decision: BotDecision): Promise<void>
  askJev: AskJev
  now(): Date
  protectedEmails: Set<string>
  /**
   * Accounts already judged keep, so a real signup isn't re-asked (and
   * re-logged) every tick for a week. In memory: a worker restart re-judges.
   */
  keptIds: Set<string>
}

export interface BotSweepSummary {
  mode: BotSweepMode
  scanned: number
  /** Skipped before Jev was asked: signed in, has orders, not a customer, protected. */
  exempt: number
  judged: number
  deleted: { email: string | null; reason: string }[]
  /** Decided delete but not done: shadow mode or over the per-tick cap. */
  wouldDelete: { email: string | null; reason: string }[]
  kept: { email: string | null; reason: string }[]
  failed: { email: string | null; reason: string }[]
}

export async function sweepSignupBots(deps: BotSweepDeps, mode: BotSweepMode = botSweepMode()): Promise<BotSweepSummary> {
  const summary: BotSweepSummary = { mode, scanned: 0, exempt: 0, judged: 0, deleted: [], wouldDelete: [], kept: [], failed: [] }
  if (mode === 'off') return summary

  const now = deps.now()
  const since = new Date(now.getTime() - BOT_SWEEP_WINDOW_HOURS * 3600 * 1000).toISOString()
  const recent = await deps.listSignupsSince(since)
  summary.scanned = recent.length

  // Never-signed-in is the gate everything else stands behind: a bot has
  // never once logged in, and a real person who has is never ours to judge.
  const dormant = recent.filter(u => !u.last_sign_in_at && !deps.protectedEmails.has((u.email || '').toLowerCase()))
  const ids = dormant.map(u => u.id)
  const [withOrders, roles] = ids.length
    ? await Promise.all([deps.idsWithOrders(ids), deps.rolesFor(ids)])
    : [new Set<string>(), new Map<string, string>()]
  const candidates = dormant.filter(u => !withOrders.has(u.id) && (roles.get(u.id) ?? 'customer') === 'customer')
  summary.exempt = recent.length - candidates.length

  for (const u of candidates) {
    if (deps.keptIds.has(u.id)) continue
    const result = await deps.askJev(accountState(u, now), accountQuestion())
    const jev = result ? readChoice(result.answers, 'account', ACCOUNT_VERDICTS) : undefined
    const decision = decideAccount(u, jev)
    summary.judged++
    const row = { email: u.email, reason: decision.reason }

    if (decision.action === 'keep') {
      deps.keptIds.add(u.id)
      summary.kept.push(row)
      continue
    }
    if (mode === 'shadow' || summary.deleted.length >= BOT_SWEEP_MAX_DELETES) {
      summary.wouldDelete.push(row)
      continue
    }
    try {
      const del = await deps.deleteUser(u.id)
      if (!del.ok) {
        summary.failed.push({ email: u.email, reason: del.reason || 'delete refused' })
        continue
      }
      summary.deleted.push(row)
      try {
        await deps.audit(u, decision)
      } catch (err: any) {
        // The account is already gone. Keep the snapshot in the log so the
        // record isn't lost with it.
        console.warn('[bot-sweep] audit write failed; snapshot:', JSON.stringify({ u, decision }), err?.message)
      }
    } catch (err: any) {
      summary.failed.push({ email: u.email, reason: err?.message || String(err) })
    }
  }
  return summary
}

const keptIds = new Set<string>()

export function makeSupabaseBotSweepDeps(): BotSweepDeps {
  return {
    async listSignupsSince(sinceIso) {
      const out: SignupAccount[] = []
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw new Error(error.message)
        for (const u of data.users) {
          if ((u.created_at || '') >= sinceIso) {
            out.push({
              id: u.id,
              email: u.email ?? null,
              created_at: u.created_at,
              last_sign_in_at: u.last_sign_in_at ?? null,
              email_confirmed_at: u.email_confirmed_at ?? null,
              user_metadata: u.user_metadata ?? null,
            })
          }
        }
        if (data.users.length < 1000) break
      }
      return out
    },
    async idsWithOrders(ids) {
      const { data, error } = await supabase.from('orders').select('user_id').in('user_id', ids)
      // Fail closed: if we can't prove an account has no orders, treat all as protected.
      if (error) throw new Error(`orders lookup failed: ${error.message}`)
      return new Set((data || []).map(r => r.user_id).filter(Boolean))
    },
    async rolesFor(ids) {
      const { data, error } = await supabase.from('user_profiles').select('id, role').in('id', ids)
      if (error) throw new Error(`role lookup failed: ${error.message}`)
      return new Map((data || []).map(r => [r.id, r.role]))
    },
    async deleteUser(id) {
      const { error } = await supabase.auth.admin.deleteUser(id)
      if (!error) return { ok: true }
      const isFk = /foreign key|violates|23503/i.test(error.message)
      return { ok: false, reason: isFk ? 'owns orders or ledger history' : error.message }
    },
    async audit(u, decision) {
      const { error } = await supabase.from('audit_logs').insert({
        user_id: 'jev-bot-sweep',
        action: 'USER_BOT_SWEEP_DELETE',
        entity: 'User',
        entity_id: u.id,
        changes: {
          email: u.email,
          created_at: u.created_at,
          email_confirmed_at: u.email_confirmed_at,
          user_metadata: u.user_metadata,
          reason: decision.reason,
          fingerprints: decision.fingerprints,
          jev: decision.jev ?? null,
        },
        created_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
    },
    askJev: (state, questions) => liveAskJev(state, questions),
    now: () => new Date(),
    keptIds,
    protectedEmails: new Set(
      String(process.env.BOT_SWEEP_PROTECT || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    ),
  }
}

let running = false

export async function runSignupBotSweep(): Promise<void> {
  if (running) return
  running = true
  try {
    const s = await sweepSignupBots(makeSupabaseBotSweepDeps())
    if (s.deleted.length || s.wouldDelete.length || s.failed.length) {
      console.log(
        `[bot-sweep] ${s.mode}: scanned ${s.scanned}, judged ${s.judged}, deleted ${s.deleted.length}, ` +
          `would-delete ${s.wouldDelete.length}, kept ${s.kept.length}, failed ${s.failed.length}`
      )
      for (const d of s.deleted) console.log(`[bot-sweep]   deleted ${d.email} — ${d.reason}`)
      for (const d of s.wouldDelete) console.log(`[bot-sweep]   would delete ${d.email} — ${d.reason}`)
      for (const d of s.failed) console.warn(`[bot-sweep]   FAILED ${d.email} — ${d.reason}`)
    }
    for (const k of s.kept) console.log(`[bot-sweep]   kept ${k.email} — ${k.reason}`)
  } catch (err: any) {
    console.error('[bot-sweep] sweep failed:', err?.message || err)
  } finally {
    running = false
  }
}

export function startSignupBotSweep(): void {
  const mode = botSweepMode()
  if (mode === 'off') {
    console.log('[bot-sweep] disabled (BOT_SWEEP=off)')
    return
  }
  console.log(
    `[bot-sweep] 🤖 Jev signup-bot sweep (${mode}) — accounts under ${BOT_SWEEP_WINDOW_HOURS}h old that never ` +
      `signed in, checked every ${BOT_SWEEP_MINUTES}m`
  )
  setInterval(() => { void runSignupBotSweep() }, BOT_SWEEP_MINUTES * 60 * 1000)
  setTimeout(() => { void runSignupBotSweep() }, FIRST_RUN_DELAY_MS)
}
