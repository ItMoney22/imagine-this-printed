# Security Incident b28e2f31 — Production credential rotation

**Date:** 2026-08-16
**Handled by:** Zero Nine (Watchtower dispatch)
**Watchtower task:** `b28e2f31-2cee-484a-9b2d-8ab4769cfa52`

## Summary

Rotated the production Supabase database password for project `czzyrmizvjqlifcivrhn`
(Imagine This Printed) and re-pointed both Render services. All acceptance checks pass.
Two lower-severity items were triaged and handed off rather than forced inline (see
**Residual / handed off**).

## Key finding — the originally-leaked value was already dead

The credential the incident was opened for — the Supavisor pooler string
`postgresql://postgres.czzyrmizvjqlifcivrhn:GJa6jLpS4Iit3dQI@aws-0-us-east-1.pooler.supabase.com`
committed in `e771e59` (2026-04-28) — **no longer authenticated** when this rotation ran.
Live auth test against the pooler: the leaked `GJa***` password was **DENIED**, and so was
the region host `aws-0-us-east-1` (the project now lives on `aws-0-us-east-2`). So the
April leak had already been superseded by an unrecorded rotation at some point.

The password that WAS live at the start of this task (vault `DATABASE_PASSWORD_ITP`,
`E6g***`) was verified **not** present anywhere in git history (`git log --all -S`), so it
was never committed. This rotation replaced that live value regardless, because it was
sitting in plaintext across the local box (vault + several `.env` files) and the incident
warranted a clean, recorded rotation with a known-good baseline.

## What was done

1. **Rotated the DB password** via the Supabase Management API
   (`PATCH /v1/projects/czzyrmizvjqlifcivrhn/database/password`, PAT
   `SUPABASE_MANAGEMENT_PAT_ITP`). New password = 32-char URL-safe alphanumeric (no
   escaping hazards in any connection string).
2. **Vault updated** (`C:/Users/David/.secrets/keys.json`) —
   `DATABASE_PASSWORD_ITP` + `DATABASE_URL_ITP_POOLER`, plus a rotation note.
   Pre-rotation backup written to `keys.json.bak-prerotate-<ts>`.
3. **Render env updated** — `DATABASE_URL` on both services
   (`srv-d7jpgut7vvec739bsid0` backend, `srv-d7jppnn7f7vs73bb4p80` worker) via the Render API.
4. **Redeployed both services.** NOTE: a Render env-var change does **not** auto-deploy —
   a manual `POST /deploys` was required to pick up the new `DATABASE_URL`. Both reached `live`.
5. **Updated local `.env` copies** that hold the live password:
   `backend/.env` (shared tree) and `.claude/worktrees/mr-imagine-builder/backend/.env`.
   Each got a `.bak-prerotate` sibling.

## How it was verified

- **New password authenticates** on the pooler (5432 + 6543): `user_profiles = 153`
  (matches pre-rotation baseline).
- **Old + April-leaked passwords both DENIED** after rotation.
- **Production green** post-deploy: `imaginethisprinted.com` 200, `/api/health` `{ok:true}`,
  `/api/health/database` → `"Database connected successfully (153 users)"`.
- **Worker liveness:** inserted a throwaway `ai_jobs` row; the worker flipped it
  `queued → running` within ~5s, then the probe row was deleted (0 residue).
- **DB integrity audit** (during the exposure window): 9 login roles, all stock Supabase —
  no rogue role, no foreign server / dblink, no `pg_cron`, `vault.secrets` empty, no
  non-standard function owners. No evidence of a backdoor from the leak window.

## Residual / handed off

- **VPS root SSH password** (`IAmGod1622##` on `168.231.69.85`) — the reused
  `IAmGod1622#` pattern the incident flagged. VPS Postgres (5432/5433) and the old app
  (8080) are **closed** (decommissioned/localhost-only → nothing to rotate there), but
  **SSH :22 is OPEN** and the plaintext root password lives in
  `Imagine This City/vps_grab.py` + git history (`010fc57`). Filed as approval
  **`e180df11-125d-4264-bea2-6d8a2e670f5c`** (rotate / self-rotate / decommission).
- **Supabase anon + service_role keys** — both are `type=legacy` (shared JWT-secret), so
  rotating the anon key also kills service_role and logs out every user. That's a
  coordinated maintenance window, not "convenient" — filed as task
  **`3ac9973b-623b-4519-811a-0185f6c9e4ff`**.
- **`brute_pooler.py`** (in `david-trinidad-com/`) holds the now-dead ITP password plus
  other live-looking passwords for a **different** Supabase project
  (`yrjoblqqgrposgbvsbxm`). Out of ITP scope — flagged for the same VPS/creds cleanup owner.

## VPS root SSH rotation — attempted 2026-08-16, credential already neutralized (task `e180df11`)

The follow-up approval (`e180df11-125d-4264-bea2-6d8a2e670f5c`) to rotate the root SSH
password on `168.231.69.85` was ruled GO. On execution the premise dissolved: **the box
had already been reinstalled, which killed the leaked credential.** Evidence, all gathered
read-only:

- **Leaked root password is DEAD.** `IAmGod1622##` and every variant
  (`IAmGod1622#`, `IAmGod1622`, `Iamgod1622##`, …) were **DENIED** over SSH password auth.
- **All of David's local SSH keys are denied** — `~/.ssh/id_rsa`, `id_ed25519`,
  `id_fivem_codex` each `Permission denied (publickey)`. So key-based rotation is out too.
- **The box's SSH host identity changed.** `known_hosts` had this box's ed25519 key hashing
  to `SHA256:JYxs…`; the live box now presents `SHA256:QjRiB/OgWgM+A0SVRNb7kU0iijohp4vkiWFbaF7xWMs`,
  and the stored ECDSA entry is "offending" too. Fresh host keys + a default hostname
  (`srv1699887.hstgr.cloud`, reverse DNS) + the stock `OpenSSH_9.6p1 Ubuntu` banner ⇒ the
  VPS was **reprovisioned/reinstalled**, wiping the old root password and old authorized keys.
- **Not a fail2ban false-negative.** A no-auth transport probe after the attempts showed the
  server still responding and offering `publickey,password` — the denials are genuine.
- **Hostinger API** (vault `hostinger.HOSTINGER_API_TOKEN`) lists **0 VMs**, so this box is
  not manageable from David's current API token (different Hostinger account/scope, or the IP
  was recycled).

**Security outcome:** the exposure the incident named — *"anyone holding the leaked
`IAmGod1622##` value gets root SSH"* — is **CLOSED**. The reinstall already invalidated the
leaked credential (verified denied). The acceptance criterion *"the old password no longer
grants SSH access"* is therefore satisfied.

**What could NOT be done, and why:** `passwd` requires an authenticated session, and no
working credential (password or key) is held for the reinstalled box. A new
`vps.ROOT_SSH_PASSWORD` was deliberately **not fabricated** — a fake value would be worse
than none. The vault instead carries a `vps` status record documenting all of the above.

**Caveat worth flagging:** the reinstalled box still has **root password auth enabled** with
an unknown password set by whoever provisioned it. If that password is weak/default it is a
new (separate) exposure — but it cannot be assessed or hardened without access, which only
David can obtain from the Hostinger control panel.

**Open decision (filed as an approval):** reclaim the box via the Hostinger panel (reset root
password there, disable password auth / add a key, then store the new secret in
`vps.ROOT_SSH_PASSWORD`) **vs.** confirm it retired and scrub the stale references
(`CLAUDE.md`'s "running on VPS at 168.231.69.85:8080", `ecosystem.config.cjs` PM2 target,
and the dead plaintext password still in `Imagine This City/vps_grab.py` + git `010fc57`).

## Operational notes for next time

- Rotate via `PATCH /v1/projects/{ref}/database/password` (Management PAT), not the
  dashboard — it updates the pooler config in one call and is scriptable.
- **A Render env-var write is NOT a deploy.** Follow every `PUT .../env-vars/DATABASE_URL`
  with a `POST .../deploys` or the running instance keeps the old value.
- The worker claims jobs through the Supabase **service-role** client, not `DATABASE_URL` —
  but it still had to redeploy to be sure it was healthy; the probe-row test is the proof.
