#!/usr/bin/env bash
# Render vs Fly parity probe — Step 4/6 of the Render → Fly migration.
#
# Asks BOTH hosts the same questions and prints the answers side by side. The
# point is not "Fly returns 200", it is "Fly returns the SAME thing Render
# returns" — a migration is only done when the two are indistinguishable.
#
#   bash docs/migration/render-to-fly/verify-parity.sh
#
# Before the cutover, RENDER is reached through the live production hostname
# (api.imaginethisprinted.com, which still CNAMEs to Render) and FLY through
# its *.fly.dev hostname. AFTER the cutover those swap meaning, so the script
# takes both as overridable env vars:
#
#   RENDER_BASE=https://imagine-this-printed-backend.onrender.com \
#   FLY_BASE=https://api.imaginethisprinted.com \
#     bash docs/migration/render-to-fly/verify-parity.sh
#
# PRINT_BRIDGE_TOKEN (optional) enables the authenticated print-factory probe.
# Without it that check is skipped rather than silently passing — a bridge that
# is never actually called is exactly the thing that breaks unnoticed.

set -uo pipefail

RENDER_BASE="${RENDER_BASE:-https://api.imaginethisprinted.com}"
FLY_BASE="${FLY_BASE:-https://imagine-this-printed-api.fly.dev}"
ORIGIN="${ORIGIN:-https://imaginethisprinted.com}"

pass=0; fail=0

# ---------------------------------------------------------------------------
# hit <method> <path> <base> [extra curl args...] -> "<status>|<body first 200 chars>"
# ---------------------------------------------------------------------------
hit() {
  local method="$1" path="$2" base="$3"; shift 3
  local body status
  body=$(curl -sS -X "$method" -m 25 -w $'\n%{http_code}' "$base$path" "$@" 2>/dev/null) || { echo "000|curl failed"; return; }
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  echo "${status}|$(printf '%s' "$body" | tr -d '\n' | cut -c1-200)"
}

# Compare a single probe across both hosts. `mode`:
#   status  — only the HTTP status has to match (bodies legitimately differ,
#             e.g. timings or per-host identifiers)
#   exact   — status AND body must match byte for byte
compare() {
  local label="$1" method="$2" path="$3" mode="$4"; shift 4
  local r f rs fs rb fb
  r=$(hit "$method" "$path" "$RENDER_BASE" "$@")
  f=$(hit "$method" "$path" "$FLY_BASE" "$@")
  rs="${r%%|*}"; fs="${f%%|*}"
  rb="${r#*|}";  fb="${f#*|}"

  local ok=1
  [ "$rs" = "$fs" ] || ok=0
  if [ "$mode" = "exact" ] && [ "$rb" != "$fb" ]; then ok=0; fi

  if [ "$ok" = "1" ]; then
    pass=$((pass+1)); printf 'PASS  %-38s render=%s fly=%s\n' "$label" "$rs" "$fs"
  else
    fail=$((fail+1)); printf 'FAIL  %-38s render=%s fly=%s\n' "$label" "$rs" "$fs"
    printf '        render body: %s\n' "$rb"
    printf '        fly    body: %s\n' "$fb"
  fi
}

# A header probe: does the named response header match across hosts?
compare_header() {
  local label="$1" path="$2" header="$3"; shift 3
  local rv fv
  rv=$(curl -sS -m 25 -o /dev/null -D - "$RENDER_BASE$path" "$@" 2>/dev/null | tr -d '\r' | grep -i "^$header:" | head -1 | cut -d' ' -f2-)
  fv=$(curl -sS -m 25 -o /dev/null -D - "$FLY_BASE$path" "$@" 2>/dev/null | tr -d '\r' | grep -i "^$header:" | head -1 | cut -d' ' -f2-)
  if [ "$rv" = "$fv" ]; then
    pass=$((pass+1)); printf 'PASS  %-38s %s\n' "$label" "${rv:-<absent on both>}"
  else
    fail=$((fail+1)); printf 'FAIL  %-38s render=%q fly=%q\n' "$label" "$rv" "$fv"
  fi
}

echo "render = $RENDER_BASE"
echo "fly    = $FLY_BASE"
echo

echo "--- liveness -------------------------------------------------------"
compare 'GET /'                      GET /                        exact
compare 'GET /api/health'            GET /api/health              exact

echo
echo "--- dependency health (the real proof the secrets landed) ----------"
# These endpoints actually TOUCH the dependency — Postgres, Resend, Supabase
# auth config, GCS. If a secret failed to transfer, this is where it shows,
# not on /api/health.
compare 'GET /api/health/database'   GET /api/health/database     status
compare 'GET /api/health/email'      GET /api/health/email        status
compare 'GET /api/health/auth'       GET /api/health/auth         status
compare 'GET /api/health/gcs'        GET /api/health/gcs          status
# Both hosts read the same audit_logs heartbeat row, so this answers the same
# on either while ANY worker is running. It is the probe for Step 6: after the
# Render worker is stopped and the Fly worker started, it must still say alive.
compare 'GET /api/health/worker'     GET /api/health/worker       status

echo
echo "--- storefront surface ---------------------------------------------"
compare 'GET /api/products'          GET /api/products            status
compare 'GET unknown route -> 404'   GET /api/definitely-not-real status

echo
echo "--- CORS (a mismatch here is a dark storefront) --------------------"
compare_header 'allowed origin echoed' /api/health access-control-allow-origin \
  -H "Origin: $ORIGIN"
compare_header 'preflight allow-methods' /api/health access-control-allow-methods \
  -X OPTIONS -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST'
compare_header 'foreign origin refused' /api/health access-control-allow-origin \
  -H 'Origin: https://not-our-storefront.example'

echo
echo "--- security headers ------------------------------------------------"
compare_header 'HSTS'                /api/health strict-transport-security
compare_header 'X-Content-Type-Options' /api/health x-content-type-options
compare_header 'X-Frame-Options'     /api/health x-frame-options
compare_header 'Referrer-Policy'     /api/health referrer-policy
compare_header 'X-Powered-By stripped' /api/health x-powered-by

echo
echo "--- print bridge ----------------------------------------------------"
compare 'queue without auth -> 401'  GET /api/print-bridge/queue  status
if [ -n "${PRINT_BRIDGE_TOKEN:-}" ]; then
  compare 'queue with bearer token'  GET /api/print-bridge/queue  status \
    -H "Authorization: Bearer $PRINT_BRIDGE_TOKEN"
else
  echo 'SKIP  queue with bearer token           (set PRINT_BRIDGE_TOKEN to run it)'
fi

echo
echo "===================================================================="
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
