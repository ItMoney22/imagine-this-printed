// One-shot setup for the in-app email system (Resend + Cloudflare + DB).
//
// Run from backend/: npx tsx scripts/setup-email-system.ts [flags]
//   --migrate      apply supabase/migrations/20260612_email_system.sql to the DB (DATABASE_URL)
//   --dns          add Resend's sending DNS records to Cloudflare (additive, safe)
//   --mx-cutover   REPLACE the root MX records with Resend's receiving MX
//                  (moves ALL inbound @imaginethisprinted.com mail to Resend —
//                   old Hostinger mailboxes stop receiving!)
//   --webhook      create the Resend email.received webhook -> API and print the
//                  signing secret (put it in RESEND_WEBHOOK_SECRET)
//   --verify       ask Resend to (re)verify the domain
//   --all          everything above
//
// Required env (backend/.env): RESEND_API_KEY, DATABASE_URL (for --migrate)
// Plus: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID_ITP (for --dns/--mx-cutover)
//
// Rollback for --mx-cutover (previous records, from Cloudflare 2026-06-12):
//   MX imaginethisprinted.com -> mx1.hostinger.com  priority 5
//   MX imaginethisprinted.com -> mx2.hostinger.com  priority 10

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_ZONE = process.env.CLOUDFLARE_ZONE_ID_ITP || 'ac1022efbf31f1678ca335dd81a30577';
const DOMAIN = process.env.EMAIL_DOMAIN || 'imaginethisprinted.com';
const WEBHOOK_URL = process.env.EMAIL_WEBHOOK_URL || 'https://api.imaginethisprinted.com/api/email/webhooks/resend';

const args = new Set(process.argv.slice(2));
const all = args.has('--all');

async function resend(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.resend.com${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${pathname} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function cloudflare(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!body.success) throw new Error(`Cloudflare ${pathname} failed: ${JSON.stringify(body.errors || body)}`);
  return body;
}

async function findDomainId(): Promise<string> {
  const list: any = await resend('/domains');
  const domain = (list.data || []).find((d: any) => d.name === DOMAIN);
  if (!domain) throw new Error(`Domain ${DOMAIN} not found in Resend — add it in the dashboard first.`);
  return domain.id;
}

async function migrate() {
  const { Client } = await import('pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  // Run from backend/ — resolve the migration relative to the repo root
  const sqlPath = path.resolve(process.cwd(), '../supabase/migrations/20260612_email_system.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  // Supabase's pooler presents a self-signed chain; strip sslmode from the URL
  // (it overrides the ssl object) and relax verification for THIS connection
  // only — traffic is still TLS-encrypted.
  const cleanUrl = url.replace(/[?&]sslmode=[^&]+/, m => (m.startsWith('?') ? '?' : '')).replace(/\?&/, '?').replace(/[?&]$/, '');
  const client = new Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query('SELECT address FROM email_mailboxes');
  await client.end();
  console.log('✅ migration applied; mailboxes:', rows.map(r => r.address).join(', ') || '(none)');
}

async function existingRecords() {
  const res: any = await cloudflare('/dns_records?per_page=200');
  return res.result as any[];
}

async function dns() {
  const domainId = await findDomainId();
  const detail: any = await resend(`/domains/${domainId}`);
  const existing = await existingRecords();

  for (const rec of detail.records || []) {
    if (rec.record === 'Receiving') continue; // handled by --mx-cutover
    const name = rec.name ? `${rec.name}.${DOMAIN}` : DOMAIN;
    const already = existing.find(e =>
      e.type === rec.type && e.name === name &&
      (rec.type !== 'TXT' || String(e.content).replace(/"/g, '').startsWith(String(rec.value).slice(0, 30)))
    );
    if (already) { console.log(`= exists: ${rec.type} ${name}`); continue; }
    const payload: any = { type: rec.type, name, content: rec.value, ttl: 1, proxied: false };
    if (rec.type === 'MX') payload.priority = rec.priority ?? 10;
    await cloudflare('/dns_records', { method: 'POST', body: JSON.stringify(payload) });
    console.log(`+ created: ${rec.type} ${name} -> ${rec.value}`);
  }
}

async function mxCutover() {
  const domainId = await findDomainId();
  const detail: any = await resend(`/domains/${domainId}`);
  const receiving = (detail.records || []).find((r: any) => r.record === 'Receiving' && r.type === 'MX');
  if (!receiving) throw new Error('No Receiving MX record listed by Resend');

  const existing = await existingRecords();
  const rootMx = existing.filter(e => e.type === 'MX' && e.name === DOMAIN);

  for (const mx of rootMx) {
    if (mx.content === receiving.value) { console.log('= receiving MX already in place'); continue; }
    await cloudflare(`/dns_records/${mx.id}`, { method: 'DELETE' });
    console.log(`- removed old MX: ${mx.content} (prio ${mx.priority})`);
  }
  if (!rootMx.some(mx => mx.content === receiving.value)) {
    await cloudflare('/dns_records', {
      method: 'POST',
      body: JSON.stringify({ type: 'MX', name: DOMAIN, content: receiving.value, priority: receiving.priority ?? 10, ttl: 1, proxied: false }),
    });
    console.log(`+ created receiving MX: ${receiving.value}`);
  }
}

async function verify() {
  const domainId = await findDomainId();
  await resend(`/domains/${domainId}/verify`, { method: 'POST' });
  const detail: any = await resend(`/domains/${domainId}`);
  console.log(`✅ verify requested; domain status: ${detail.status}`);
  for (const rec of detail.records || []) {
    console.log(`   ${rec.record} ${rec.type} ${rec.name || '@'} -> ${rec.status}`);
  }
}

async function webhook() {
  const hooks: any = await resend('/webhooks');
  const existing = (hooks.data || []).find((w: any) => w.endpoint === WEBHOOK_URL);
  if (existing) {
    console.log(`= webhook already exists (${existing.id}, status ${existing.status}) — signing secret is in the Resend dashboard`);
    return;
  }
  const created: any = await resend('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ endpoint: WEBHOOK_URL, events: ['email.received'] }),
  });
  console.log('✅ webhook created:', created.id);
  if (created.signing_secret || created.secret) {
    console.log('   RESEND_WEBHOOK_SECRET=', created.signing_secret || created.secret);
    console.log('   → put this in backend/.env AND the production environment.');
  } else {
    console.log('   → copy the signing secret from the Resend dashboard into RESEND_WEBHOOK_SECRET.');
  }
}

(async () => {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
  if (all || args.has('--migrate')) await migrate();
  if (all || args.has('--dns')) await dns();
  if (all || args.has('--verify')) await verify();
  if (all || args.has('--webhook')) await webhook();
  if (all || args.has('--mx-cutover')) await mxCutover();
  if (!all && args.size === 0) {
    console.log('No flags given. Use --migrate --dns --verify --webhook [--mx-cutover] or --all');
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
