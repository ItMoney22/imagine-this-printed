#!/usr/bin/env bash
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "Error: codex CLI not found on PATH. Install it, then re-run: ./scout.sh \"your request here\"" >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: ./scout.sh \"your request here\"" >&2
  exit 1
fi

codex exec "$*"

