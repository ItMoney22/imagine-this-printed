# Print-bridge mesh-link proof — STATUS: WATCHING (task e51d15e8)

The live proof needs a REAL paid order with a meshed toy (3d-print-<modelId> or a print3d catalog toy).
None exists. Every live check 10/12-10/13 (latest 2026-10-13 19:49Z) saw the same 2 candle-holder lines,
no glbUrl/stlUrl, no gs://. The database agrees (19:49Z): 6 paid orders ever, newest 2026-09-12, 0 order lines
ever with a 3d-print- id, 0 paid lines on a meshed toy. 3 meshed toys ARE buyable today (Shadow Raptor Toy Charm,
The Wizard Beast, Robo Rascal), so the trigger is reachable; it just has not been pulled. No fake order was created: Pluto prints whatever the queue holds.

## What runs now (2026-10-13)
- Earth scheduled task **ITP print-bridge mesh watch**, every 30 min, hidden (conhost --headless),
  launcher `E:\memory\watchtower\scripts\itp-print-bridge-mesh-watch.cmd`, runs
  `node scripts/prove-print-bridge-mesh.mjs --watch` (read-only GET, vault itp.PRINT_BRIDGE_TOKEN).
- WAITING runs append one line to `E:/memory/watchtower/projects/imagine-this-printed/print-bridge-mesh-watch/watch.log`.
- The first run that sees a meshed paid line fetches every glbUrl/stlUrl, writes `evidence-<stamp>.json` there
  (customer name/email redacted, signed URLs kept so a checker can re-fetch within 12 h), marks trigger card
  **aadb395f** ("UNBLOCK e51d15e8 ...") completed with the PASS/FAIL summary, and deletes its own task.
  Nine then re-sends e51d15e8 on this branch (prerequisite landed) to write the proof handoff.

## Re-check 2026-11-04 08:55Z (prerequisite landed on main):
- Branch merged into shared ITP main via engine POST /git/merge (mergedSha 36a00b4cf0cd62d751542f4dae309f9c0410cb1c).
- Earth scheduled task launcher `E:\memory\watchtower\scripts\itp-print-bridge-mesh-watch.cmd` now resolves `D:\Projects for MetaSphere\imagine-this-printed\scripts\prove-print-bridge-mesh.mjs` directly from the shared tree. Verified live: execution appends to `watch.log` without worktree dependency.
- Live check 2026-11-04 08:55Z: HTTP 200, 2 candle-holder lines, 0 mesh links. DB cross-check: 6 paid orders, 0 meshed. Pre-flight 6/6 buyable toy meshes HTTP 200, 12h link, MD5 match. RESULT: WAITING.

## Re-check 2026-10-13 19:49Z (send-back #4): `docs/evidence/print-bridge-mesh-recheck-2026-10-13.txt`
- The queue scans paid orders oldest first, max 100 per call. A bare call goes blind past 100 paid orders, so the
  script now follows the queue cursor (since=) to the end. Proven live with QUEUE_PAGE_LIMIT=1: 7 pages, same 2 lines.
- Every live run also counts paid meshed lines straight from the database (vault service key, read-only).
  DB says paid meshed > 0 while the queue serves 0 links = FAIL, so a bridge that drops a real order cannot
  sit on WAITING. The join's toy-line count (2) matches the queue's 2 lines on live data.
- Pre-flight `node scripts/preflight-print-bridge-toy-meshes.mjs`: all 6 mesh files of the 3 buyable toys,
  signed 12 h with the backend's GCS signer, fetch HTTP 200 with md5 = GCS. Not the live proof (no order).

## Checks per link (PASS needs all)
https; host storage.googleapis.com; path /imagine-this-printed-products/; link life within 120 s of
PRINT_FILE_LINK_TTL_MINUTES (720 min; the bridge signs V2 links on every queue read); full GET returns
exactly HTTP 200 (bytes + md5 recorded, md5 compared with GCS x-goog-hash).

## Checker proven on real bucket links
`docs/evidence/print-bridge-mesh-checker-selftest-2026-10-13.txt`: 12 h V2 links on a real private-bucket
mesh -> PASS (both 200, md5 = GCS); a 1 h link -> FAIL on expiry; live queue at the same moment -> WAITING.

## Re-run by hand
    node scripts/prove-print-bridge-mesh.mjs
    QUEUE_PAGE_LIMIT=1 node scripts/prove-print-bridge-mesh.mjs
    node scripts/preflight-print-bridge-toy-meshes.mjs
Stop the watch: `schtasks /Delete /TN "ITP print-bridge mesh watch" /F`
