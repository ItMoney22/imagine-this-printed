/**
 * Close the dispatch with a walkie call. Prints length and HTTP status only.
 */
import fs from 'node:fs'

const envPath = 'D:/Projects for MetaSphere/david-trinidad-com/.env.local'
const raw = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')
const secret = raw.match(/^CRON_SECRET=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')

const message = [
  'The email audit log is locked.',
  'Any signed-in customer could forge a row, because the policy was named for the service but allowed every authenticated user, and the backend never used it since the service role skips row security.',
  'The drop is live in production, the migration ledger has the row, and the checker fails if the policy comes back.',
  'I proved it both ways. Before, a real signed-in session could insert. After, that call is rejected. Anonymous was already rejected.',
  'The service role can still write, which is how mail gets logged.',
  'The health check is up and a test message to the store inbox was delivered.',
  'The health route itself cannot send that test, because its probe token was never set on the server, so it refuses and I sent through the mail provider.',
  'Nothing needed from you. A merge is on the board so a new database does not recreate the hole.',
].join(' ')

console.log('chars', message.length)
if (message.length < 350 || message.length > 600) {
  console.log('LENGTH_REJECTED')
  process.exit(1)
}

const res = await fetch('https://davidtrinidad.com/api/walkie', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-internal-secret': secret,
  },
  body: JSON.stringify({
    agentId: 'sifu',
    agentName: 'Sifu',
    message,
    mood: 'happy',
    status: 'completed',
    context: { taskId: '0c9f693c-c0ee-4f20-8b12-b1bbc94cce0c' },
  }),
})
const text = await res.text()
console.log('WALKIE', res.status, text.slice(0, 240))
