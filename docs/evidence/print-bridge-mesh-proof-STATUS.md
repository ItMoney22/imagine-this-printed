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
