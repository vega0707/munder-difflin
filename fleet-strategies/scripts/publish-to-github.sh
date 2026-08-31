#!/usr/bin/env bash
# Publish strategy repos A–D to GitHub.
# Usage: ./publish-to-github.sh [owner] [--public]
set -euo pipefail
OWNER="${1:-vega0707}"
VISIBILITY="--private"
[[ "${2:-}" == "--public" ]] && VISIBILITY="--public"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_ROOT="${FLEET_REPOS_ROOT:-/home/ubuntu/repos}"

publish_one() {
  local key="$1" name="$2"
  local from=""
  if [[ -d "$SRC_ROOT/$name/.git" ]]; then
    from="$SRC_ROOT/$name"
  else
    from="$ROOT/$key"
    if [[ ! -d "$from/.git" ]]; then
      git -C "$from" init -b main
      git -C "$from" add -A
      git -C "$from" -c user.email="fleet@local" -c user.name="Fleet" \
        commit -m "chore: init $name" || true
    fi
  fi
  echo "Publishing $name from $from ..."
  (
    cd "$from"
    if git remote get-url origin >/dev/null 2>&1; then
      git remote remove origin || true
    fi
    gh repo create "$OWNER/$name" $VISIBILITY --source=. --remote=origin --push
  )
}

publish_one a munder-fleet-a
publish_one b munder-fleet-b
publish_one c munder-fleet-c
publish_one d munder-fleet-d
echo "Done. Remotes: https://github.com/$OWNER/munder-fleet-{a,b,c,d}"
