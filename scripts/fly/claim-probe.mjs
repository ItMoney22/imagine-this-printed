// Runs INSIDE a one-off machine of the Fly WORKER app. Uses the worker's own compiled
// claim function + Supabase client (dist/), i.e. the exact code path startJob() uses.
// Inserts ONE tagged no-op ai_jobs row, claims it, then deletes it. Never prints secrets.
const { supabase } = await import('/app/dist/lib/supabase.js');
const { claimQueuedJob } = await import('/app/dist/worker/ai-jobs-worker.js');
const tag = { probe: 'fly-migration-claim', task: 'c4cbd8d0-cfb9-4661-ad8c-3dae42f5b7d9', machine: process.env.FLY_MACHINE_ID };
let id;
try {
  const ins = await supabase.from('ai_jobs').insert({ type: 'fly_migration_probe', status: 'queued', input: tag }).select('id, status, created_at').single();
  if (ins.error) throw new Error('insert failed: ' + ins.error.message);
  id = ins.data.id;
  console.log(`[probe] inserted ai_jobs ${id} status=${ins.data.status}`);
  const claim = await claimQueuedJob(supabase, id);
  console.log(`[probe] claimQueuedJob -> claimed=${claim.claimed} error=${claim.error ? claim.error.message : 'none'}`);
  const again = await claimQueuedJob(supabase, id);
  console.log(`[probe] second claim (must be refused) -> claimed=${again.claimed}`);
  const row = await supabase.from('ai_jobs').select('id, status, updated_at').eq('id', id).single();
  console.log(`[probe] row now status=${row.data?.status}`);
  console.log(claim.claimed && !again.claimed && row.data?.status === 'running' ? '[probe] PASS - Fly worker runtime claimed a real ai_jobs row' : '[probe] FAIL');
} catch (e) { console.log('[probe] FAIL ' + e.message); process.exitCode = 1 }
finally {
  if (id) { const d = await supabase.from('ai_jobs').delete().eq('id', id); console.log(`[probe] cleanup delete -> ${d.error ? 'ERROR ' + d.error.message : 'ok'}`) }
}
