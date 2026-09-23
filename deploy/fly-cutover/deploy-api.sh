#!/usr/bin/env bash
# Deploy imagine-this-printed-api on Fly from the EXACT commit Render's backend is
# serving, so the DNS cutover is hosting-only (approval 1b935741 option A).
#   usage: deploy/fly-cutover/deploy-api.sh [commit]   (default: Render's live commit)
# Needs: FLY_API_TOKEN (vault fly.FLY_API_TOKEN), RENDER_API_KEY (vault render.RENDER_API_KEY) if no commit given.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
COMMIT="${1:-}"
if [ -z "$COMMIT" ]; then
  COMMIT=$(curl -fsS "https://api.render.com/v1/services/srv-d7jpgut7vvec739bsid0/deploys?limit=5" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const x=JSON.parse(d).find(r=>r.deploy.status==='live');process.stdout.write(x.deploy.commit.id)})")
fi
git -C "$REPO" fetch -q origin
git -C "$REPO" cat-file -e "$COMMIT^{commit}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
git -C "$REPO" archive "$COMMIT" backend | tar -x -C "$STAGE"
cp "$HERE/Dockerfile.render-parity" "$HERE/.dockerignore" "$HERE/fly.api.toml" "$STAGE/backend/"
echo "deploying imagine-this-printed-api from $COMMIT"
cd "$STAGE/backend"
fly deploy -c fly.api.toml -a imagine-this-printed-api --remote-only \
  --image-label "render-parity-${COMMIT:0:8}" --env "GIT_COMMIT=$COMMIT" --yes
