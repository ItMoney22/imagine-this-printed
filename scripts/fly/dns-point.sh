#!/usr/bin/env bash
# Point api.imaginethisprinted.com at Fly or back at Render. ONE Cloudflare PATCH.
#   scripts/fly/dns-point.sh fly      # cutover
#   scripts/fly/dns-point.sh render   # ROLLBACK
#   scripts/fly/dns-point.sh show     # print the current record
# Token: CLOUDFLARE_API_TOKEN env var, else the vault (cloudflare.CLOUDFLARE_API_TOKEN).
# The record stays DNS-only (proxied:false). Orange-clouding it would add a proxy hop
# and make TRUST_PROXY_HOPS=2 wrong on Fly. See docs/migration/render-to-fly/STEP-5-CUTOVER-AND-ROLLBACK.md.
set -euo pipefail
ZONE=ac1022efbf31f1678ca335dd81a30577            # imaginethisprinted.com
RECORD=74b5eb9b47e763da941199bfcc7e0941          # CNAME api.imaginethisprinted.com
FLY_TARGET=w0wx028.imagine-this-printed-api.fly.dev
RENDER_TARGET=imagine-this-printed-backend.onrender.com
TOKEN="${CLOUDFLARE_API_TOKEN:-$(node -e "process.stdout.write(require('C:/Users/David/.secrets/keys.json').cloudflare.CLOUDFLARE_API_TOKEN)")}"
API="https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$RECORD"
show() { curl -fsS "$API" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).result;console.log(r.name,'CNAME',r.content,'proxied='+r.proxied,'ttl='+r.ttl)})"; }
case "${1:-show}" in
  fly)    TARGET=$FLY_TARGET;    NOTE="Fly (cutover 13e1c509). Rollback: scripts/fly/dns-point.sh render" ;;
  render) TARGET=$RENDER_TARGET; NOTE="Render (rolled back from Fly). Re-cutover: scripts/fly/dns-point.sh fly" ;;
  show)   show; exit 0 ;;
  *) echo "usage: $0 fly|render|show" >&2; exit 2 ;;
esac
echo "before: $(show)"
curl -fsS -X PATCH "$API" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data "{\"content\":\"$TARGET\",\"proxied\":false,\"ttl\":60,\"comment\":\"${NOTE:0:100}\"}" >/dev/null
echo "after:  $(show)"
# Authoritative answer straight from Cloudflare's nameservers, which resolver caches cannot hide.
NS=$(node -e "require('dns').promises.resolveNs('imaginethisprinted.com').then(a=>process.stdout.write(a[0]))")
for i in $(seq 1 12); do
  GOT=$(node -e "const r=new (require('dns').promises.Resolver)();require('dns').promises.resolve4('$NS').then(ip=>{r.setServers(ip);return r.resolveCname('api.imaginethisprinted.com')}).then(a=>process.stdout.write(a[0]))" 2>/dev/null || true)
  [ "$GOT" == "$TARGET" ] && { echo "authoritative ($NS) now answers $GOT"; exit 0; }
  sleep 5
done
echo "WARNING: authoritative answer still '$GOT' after 60s" >&2; exit 1
