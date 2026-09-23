// Runs INSIDE a Fly machine: node fly-env-probe.mjs <expected-hashes.json> (from render-env-hashes.mjs).
// Runs INSIDE a Fly machine. Never prints a secret value: names, PASS/FAIL, refs, roles, HTTP codes only.
import fs from 'fs'; import crypto from 'crypto';
const expected = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MANIFEST = new Set(['PORT','NODE_ENV']); // declared in fly.*.toml [env], not secrets
// Still set on Render but read by nothing on main -- deliberately NOT ported (Watchtower c4cbd8d0).
const STALE = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'REPLICATE_REMBG_MODEL_ID'];
let failures = 0;
const pass = m => console.log(`  PASS  ${m}`), fail = m => { failures++; console.log(`  FAIL  ${m}`) }, warn = m => console.log(`  WARN  ${m}`);
const h = v => crypto.createHash('sha256').update(v ?? '').digest('hex');

console.log(`\n== ${process.env.FLY_APP_NAME} machine ${process.env.FLY_MACHINE_ID} region ${process.env.FLY_REGION}`);
console.log('\n1. Every Render variable present at runtime with a byte-identical value');
let same = 0; const diff = [], missing = [];
for (const [k, hash] of Object.entries(expected).filter(([k]) => !STALE.includes(k))) {
  if (!(k in process.env)) { missing.push(k); continue }
  if (h(process.env[k]) === hash) same++; else diff.push(k);
}
console.log(`        ${same}/${same + diff.length + missing.length} identical to Render`);
missing.length ? fail(`missing at runtime: ${missing.join(', ')}`) : pass('no Render variable missing');
for (const k of diff) (MANIFEST.has(k) ? warn : fail)(`${k} differs from Render${MANIFEST.has(k) ? ' (manifest [env], expected)' : ''}`);
if (!diff.filter(k => !MANIFEST.has(k)).length) pass('every secret value matches Render byte-for-byte');
{ const left = STALE.filter(k => k in process.env); left.length ? fail(`stale vars still present: ${left.join(', ')}`) : pass(`dead vars absent: ${STALE.join(', ')}`) }

console.log('\n2. Supabase boot guard (same logic as backend/lib/supabase-env-guard.ts @ e77aae9)');
const refOf = u => { try { const host = new URL(u).hostname; return host.endsWith('.supabase.co') ? host.split('.')[0] : null } catch { return null } };
const jwt = t => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()) } catch { return null } };
const urlRef = refOf(process.env.SUPABASE_URL);
const sr = jwt(process.env.SUPABASE_SERVICE_ROLE_KEY), an = jwt(process.env.SUPABASE_ANON_KEY);
console.log(`        SUPABASE_URL ref "${urlRef}"; service key ref "${sr?.ref}" role "${sr?.role}"; anon key ref "${an?.ref}" role "${an?.role}"`);
sr?.ref === urlRef && sr?.role === 'service_role' ? pass(`service_role key matches project "${urlRef}"`) : fail('service role key does not match SUPABASE_URL project / role');
an?.ref === urlRef && an?.role === 'anon' ? pass(`anon key matches project "${urlRef}"`) : fail('anon key does not match SUPABASE_URL project / role');
if (process.env.SUPABASE_JWT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const [a, b, sig] = process.env.SUPABASE_SERVICE_ROLE_KEY.split('.');
  const mine = crypto.createHmac('sha256', process.env.SUPABASE_JWT_SECRET).update(`${a}.${b}`).digest('base64url');
  mine === sig ? pass('SUPABASE_JWT_SECRET verifies the service-role key signature') : warn('SUPABASE_JWT_SECRET does not verify the service key (JWT secret may be rotated to asymmetric keys)');
}

console.log('\n3. Live, read-only calls with the runtime credentials');
const probe = async (label, url, headers, ok = r => r.ok) => {
  try { const r = await fetch(url, { headers }); ok(r) ? pass(`${label} -> HTTP ${r.status}`) : fail(`${label} -> HTTP ${r.status}`) } catch (e) { fail(`${label} -> ${e.message}`) }
};
const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
await probe('Supabase REST /rest/v1/products', `${process.env.SUPABASE_URL}/rest/v1/products?select=id&limit=1`, { apikey: sk, Authorization: `Bearer ${sk}` });
await probe('Supabase AUTH /auth/v1/admin/users', `${process.env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, { apikey: sk, Authorization: `Bearer ${sk}` });
await probe('Stripe  GET /v1/balance', 'https://api.stripe.com/v1/balance', { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` });
await probe('Resend  GET /domains', 'https://api.resend.com/domains', { Authorization: `Bearer ${process.env.RESEND_API_KEY}` });
await probe('Replicate GET /v1/account', 'https://api.replicate.com/v1/account', { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` });
await probe('OpenAI  GET /v1/models', 'https://api.openai.com/v1/models', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });
await probe('OpenRouter GET /api/v1/key', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` });
await probe('Shippo  GET /carrier_accounts', 'https://api.goshippo.com/carrier_accounts/?results=1', { Authorization: `ShippoToken ${process.env.SHIPPO_API_TOKEN}` });
await probe('Etsy    GET /v3/application/openapi-ping', 'https://api.etsy.com/v3/application/openapi-ping', { 'x-api-key': `${process.env.ETSY_KEYSTRING}:${process.env.ETSY_SHARED_SECRET}` });
try { const c = JSON.parse(process.env.GCS_CREDENTIALS); c.private_key?.includes('BEGIN PRIVATE KEY') && c.client_email ? pass(`GCS_CREDENTIALS parses as a service account (${c.client_email.split('@')[1]}), private key intact with ${(c.private_key.match(/\n/g) || []).length} newlines`) : fail('GCS_CREDENTIALS parsed but has no private key / client_email') } catch (e) { fail(`GCS_CREDENTIALS does not parse as JSON: ${e.message}`) }
try { const u = new URL(process.env.DATABASE_URL); pass(`DATABASE_URL host ${u.hostname}:${u.port}`) } catch { fail('DATABASE_URL unparseable') }

console.log(failures === 0 ? '\nOK - runtime env matches Render and every credential authenticates.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures ? 1 : 0);
