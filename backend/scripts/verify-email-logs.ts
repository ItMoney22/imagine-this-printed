/**
 * Live proof that BOTH email paths persist to public.email_logs and the admin
 * history query reads them back. Sends two real mails to Resend's own sink
 * (delivered@resend.dev — reaches no customer), then deletes the rows it made.
 *
 * Run: cd backend && AI_EMAIL_ENABLED=false npx tsx --env-file=.env scripts/verify-email-logs.ts
 * Exit 0 = every check passed.
 */
import { supabase } from '../lib/supabase.js'
import { sendEmailWithTracking, sendOrderConfirmationEmail } from '../utils/email.js'
import { logEmail } from '../services/emailAI.js'

const SINK = 'delivered@resend.dev'
const RUN = `verify-${Date.now()}`
let failed = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed++
}

async function main() {
  const before = await supabase.from('email_logs').select('id', { count: 'exact', head: true })

  // Path 1 — tracked send as the AI path makes it (templateKey + aiUsed:true).
  const ai = await sendEmailWithTracking({
    to: SINK, subject: `[${RUN}] ai path`, htmlContent: '<p>email_logs verification</p>',
    templateKey: 'verify_ai_path', aiUsed: true, logMetadata: { verify_run: RUN }
  })
  check('AI-path send succeeded', ai.success, ai.messageId)

  // Path 2 — the static-fallback sender (AI_EMAIL_ENABLED=false forces it).
  const stat = await sendOrderConfirmationEmail(SINK, RUN, [{ name: 'Verify Tee', quantity: 1, price: 1 }], 1, 'Verify', {})
  check('static-fallback send succeeded', stat === true)

  // Path 3 — emailAI.logEmail (the old silent insert) now reports its result.
  const logged = await logEmail('verify_logemail', SINK, `[${RUN}] logEmail`, true, { templateKey: 'verify_logemail', customerEmail: SINK }, 'rs_verify_' + RUN)
  check('emailAI.logEmail insert landed', logged === true)

  // Same query the admin route runs (routes/admin/email-templates.ts GET /logs/recent).
  const { data: logs, error } = await supabase
    .from('email_logs').select('*', { count: 'exact' })
    .order('sent_at', { ascending: false }).range(0, 49)
  check('admin history query returns no error', !error, error?.message)
  const mine = (logs || []).filter(l => l.recipient_email === SINK && String(l.subject_sent || '').includes(RUN) || l.metadata?.verify_run === RUN || l.message_id === 'rs_verify_' + RUN)
  const aiRow = mine.find(l => l.template_key === 'verify_ai_path')
  const staticRow = mine.find(l => l.template_key === 'order_confirmation')
  const logRow = mine.find(l => l.template_key === 'verify_logemail')
  check('AI-path row visible in admin history', !!aiRow && aiRow.status === 'sent' && aiRow.ai_personalization_used === true && !!aiRow.message_id, aiRow?.message_id)
  check('static-fallback row visible in admin history', !!staticRow && staticRow.status === 'sent' && staticRow.ai_personalization_used === false && !!staticRow.message_id, staticRow?.message_id)
  check('logEmail row visible in admin history', !!logRow)

  // Failure surfacing: a row Postgres must reject (NOT NULL template_key bypassed via bad uuid user_id).
  const bad = await supabase.from('email_logs').insert({ template_key: 'verify_bad', recipient_email: SINK, user_id: '00000000-0000-0000-0000-00000000dead' })
  check('a rejected insert comes back as { error } (what the recorder now reports)', !!bad.error, bad.error?.message)

  // Cleanup
  const ids = mine.map(l => l.id)
  if (ids.length) await supabase.from('email_logs').delete().in('id', ids)
  const after = await supabase.from('email_logs').select('id', { count: 'exact', head: true })
  check('verification rows cleaned up', after.count === before.count, `${before.count} -> ${after.count}`)

  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
