// Pulls the live env of both Render services and writes ONLY sha256 hashes of each
// value to <outDir>/expected-{api,worker}.json. Raw values never touch disk or stdout.
// Feed a file to scripts/fly/fly-env-probe.mjs inside a Fly machine to prove parity.
//   node scripts/fly/render-env-hashes.mjs <outDir>
// Render key: RENDER_API_KEY env var, else the vault (render.RENDER_API_KEY).
import fs from 'fs'; import crypto from 'crypto'; import path from 'path';
const outDir = process.argv[2] ?? '.';
const key = process.env.RENDER_API_KEY
  ?? JSON.parse(fs.readFileSync('C:/Users/David/.secrets/keys.json', 'utf8')).render.RENDER_API_KEY;
const services = { api: 'srv-d7jpgut7vvec739bsid0', worker: 'srv-d7jppnn7f7vs73bb4p80' };
const h = (v) => crypto.createHash('sha256').update(v ?? '').digest('hex');
for (const [name, id] of Object.entries(services)) {
  const all = []; let cursor = '';
  for (;;) {
    const r = await fetch(`https://api.render.com/v1/services/${id}/env-vars?limit=100${cursor ? `&cursor=${cursor}` : ''}`, { headers: { Authorization: `Bearer ${key}` } });
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error(`Render ${name}: HTTP ${r.status}`);
    all.push(...page);
    if (page.length < 100) break;
    cursor = page[page.length - 1].cursor;
  }
  const hashes = Object.fromEntries(all.map((e) => [e.envVar.key, h(e.envVar.value)]));
  fs.writeFileSync(path.join(outDir, `expected-${name}.json`), JSON.stringify(hashes));
  console.log(`${name}: ${all.length} vars -> ${Object.keys(hashes).sort().join(' ')}`);
}
