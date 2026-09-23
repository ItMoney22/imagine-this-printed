#!/usr/bin/env bash
# Compare what api.imaginethisprinted.com answers on RENDER vs FLY, on the real hostname
# and real TLS cert, without depending on public DNS. Read-only; every probe is a GET,
# an OPTIONS preflight, or an unsigned POST the server must refuse.
#   scripts/fly/cutover-parity.sh           -> Render vs Fly side by side
#   scripts/fly/cutover-parity.sh live      -> also check what PUBLIC DNS serves right now
# Exit 1 on any mismatch.
set -uo pipefail
HOST=api.imaginethisprinted.com
FLY_IP=66.241.124.149
RENDER_IP=$(node -e "require('dns').promises.resolve4('imagine-this-printed-backend.onrender.com').then(a=>process.stdout.write(a[0]))")
fail=0
q() { # q <ip> <curl args...> -> "code|interesting headers"
  local ip=$1; shift
  curl -s -o /dev/null --max-time 20 --resolve "$HOST:443:$ip" -D - "$@" \
    | tr -d '\r' | sort -f | awk -v IGNORECASE=1 '
      /^HTTP\//{code=$2}
      /^(access-control-allow-origin|access-control-allow-credentials|strict-transport-security|x-content-type-options|x-frame-options|content-security-policy|referrer-policy):/{h=h" "tolower($1)"="$2}
      END{print code"|"h}'
}
body() { curl -s --max-time 20 --resolve "$HOST:443:$1" "https://$HOST$2"; }
cmp() { # cmp <label> <render> <fly>
  if [ "$2" == "$3" ]; then echo "  SAME  $1  [$3]"; else echo "  DIFF  $1"; echo "        render: $2"; echo "        fly:    $3"; fail=1; fi
}
echo "Render edge $RENDER_IP   Fly edge $FLY_IP"
for p in /api/health /api/health/database /api/health/auth /api/health/email "/api/products?limit=1" /api/seo/sitemap.xml /api/does-not-exist; do
  cmp "GET $p" "$(q $RENDER_IP "https://$HOST$p")" "$(q $FLY_IP "https://$HOST$p")"
done
strip() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);for(const k of ['timestamp','uptime','responseTime','latency','latencyMs','time','ms'])delete j[k];process.stdout.write(JSON.stringify(j))}catch{process.stdout.write('non-json '+d.length+'b')}})"; }
cmp "body /api/health/database" "$(body $RENDER_IP /api/health/database | strip)" "$(body $FLY_IP /api/health/database | strip)"
for o in https://imaginethisprinted.com https://www.imaginethisprinted.com https://evil.example; do
  cmp "CORS preflight from $o" \
    "$(q $RENDER_IP -X OPTIONS -H "Origin: $o" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type' "https://$HOST/api/orders")" \
    "$(q $FLY_IP    -X OPTIONS -H "Origin: $o" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type' "https://$HOST/api/orders")"
done
cmp "unsigned POST /api/stripe/webhook (must refuse)" \
  "$(q $RENDER_IP -X POST -H 'Content-Type: application/json' -d '{}' "https://$HOST/api/stripe/webhook")" \
  "$(q $FLY_IP    -X POST -H 'Content-Type: application/json' -d '{}' "https://$HOST/api/stripe/webhook")"
cmp "authless GET /api/orders (must refuse)" "$(q $RENDER_IP "https://$HOST/api/orders")" "$(q $FLY_IP "https://$HOST/api/orders")"
echo "  TLS  fly cert: $(echo | openssl s_client -connect $FLY_IP:443 -servername $HOST 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null | tr '\n' ' ')"
if [ "${1:-}" == "live" ]; then
  echo "Public DNS now: $(node -e "require('dns').promises.resolveCname('$HOST').then(a=>process.stdout.write(a.join(',')))")"
  for i in 1 2 3 4 5; do
    curl -s -o /dev/null --max-time 15 -D - "https://$HOST/api/health" | tr -d '\r' | awk -v IGNORECASE=1 '/^HTTP\//{c=$2}/^(server|fly-request-id|rndr-id):/{s=s" "$1}END{print "  live /api/health "c" via"s}'
  done
fi
[ $fail -eq 0 ] && echo "PARITY OK" || { echo "PARITY MISMATCH"; exit 1; }
