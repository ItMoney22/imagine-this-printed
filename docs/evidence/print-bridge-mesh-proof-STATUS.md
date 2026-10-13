# Print-bridge mesh-link proof — STATUS: WATCHING (task e51d15e8)

The live proof needs a REAL paid order with a meshed toy (3d-print-<modelId> or a print3d catalog toy).
None exists. Every live check 10/12-10/13 (latest 2026-10-13 17:59Z) saw the same 2 candle-holder lines,
no glbUrl/stlUrl, no gs://. No fake order was created: Pluto prints whatever the queue holds.

## What runs now (2026-10-13)
- Earth scheduled task **ITP print-bridge mesh watch**, every 30 min, hidden (conhost --headless),
  launcher `E:\memory\watchtower\scripts\itp-print-bridge-mesh-watch.cmd`, runs
  `node scripts/prove-print-bridge-mesh.mjs --watch` (read-only GET, vault itp.PRINT_BRIDGE_TOKEN).
- WAITING runs append one line to `E:/memory/watchtower/projects/imagine-this-printed/print-bridge-mesh-watch/watch.log`.
- The first run that sees a meshed paid line fetches every glbUrl/stlUrl, writes `evidence-<stamp>.json` there
  (customer name/email redacted, signed URLs kept so a checker can re-fetch within 12 h), marks trigger card
  **aadb395f** ("UNBLOCK e51d15e8 ...") completed with the PASS/FAIL summary, and deletes its own task.
  Nine then re-sends e51d15e8 on this branch (prerequisite landed) to write the proof handoff.

## Checks per link (PASS needs all)
https; host storage.googleapis.com; path /imagine-this-printed-products/; link life within 120 s of
PRINT_FILE_LINK_TTL_MINUTES (720 min; the bridge signs V2 links on every queue read); full GET returns
exactly HTTP 200 (bytes + md5 recorded, md5 compared with GCS x-goog-hash).

## Checker proven on real bucket links
`docs/evidence/print-bridge-mesh-checker-selftest-2026-10-13.txt`: 12 h V2 links on a real private-bucket
mesh -> PASS (both 200, md5 = GCS); a 1 h link -> FAIL on expiry; live queue at the same moment -> WAITING.

## Re-run by hand
    node scripts/prove-print-bridge-mesh.mjs
Stop the watch: `schtasks /Delete /TN "ITP print-bridge mesh watch" /F`
