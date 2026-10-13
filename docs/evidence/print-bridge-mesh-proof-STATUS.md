# Print-bridge mesh-link proof — STATUS: WAITING (task e51d15e8)

Re-checked 2026-10-12 (third run, after Nine's send-back). Live GET /api/print-bridge/queue
(vault itp.PRINT_BRIDGE_TOKEN): HTTP 200, 2 lines, `gs:// anywhere: false`, 0 mesh links.
Both lines are the old custom-toy Gothic Ghost Face Candle Holder with no glbUrl/stlUrl.
Snapshot: docs/evidence/print-bridge-queue-2026-10-12.json (customer fields redacted, no token).

Trigger not fired: no paid order with a meshed toy (3d-print-<modelId> or print3d catalog toy) exists.
No fake order was created (Pluto would print it). The task cannot pass until a customer buys one.

Re-run (prints WAITING / PASS / FAIL, per-link scheme, host, bucket, expiry, HTTP status):
    node scripts/prove-print-bridge-mesh.mjs
PASS = every glbUrl/stlUrl is https storage.googleapis.com/imagine-this-printed-products,
expiry == PRINT_FILE_LINK_TTL_MINUTES (720 min), and fetch returns 200.

## Re-run 2026-10-13 (fourth run, after second send-back)
`node scripts/prove-print-bridge-mesh.mjs` -> queue HTTP 200, orders 2, lines 2, gs:// anywhere: false,
mesh links found: 0, RESULT: WAITING. Same two old candle-holder lines. No fake order created.
DECISION (open question): PARK. Task is a wait-for-customer trigger; criteria 1-3 cannot be met until a
real paid meshed toy order exists. Needs a re-run of the script above when one lands (watch card to be
dispatched only then, per fleet rule: watch cards wait for deploy). Ship 375a0177 is on origin/main.
