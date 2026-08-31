#!/usr/bin/env bash
# Seed an empty munder-fleet-* repo from this monorepo's fleet-strategies/<letter>/.
# Usage (from munder-difflin root, with push access to the target):
#   ./fleet-strategies/scripts/seed-strategy-repo.sh a
#   ./fleet-strategies/scripts/seed-strategy-repo.sh b vega0707
set -euo pipefail
LETTER="${1:?letter a|b|c|d required}"
OWNER="${2:-vega0707}"
case "$LETTER" in a|b|c|d) ;; *) echo "letter must be a|b|c|d"; exit 1 ;; esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/fleet-strategies/$LETTER"
NAME="munder-fleet-$LETTER"
WORKDIR="$(mktemp -d)/$NAME"

cp -a "$SRC" "$WORKDIR"
cd "$WORKDIR"
if [[ ! -d .git ]]; then
  git init -b main
  git add -A
  git -c user.email="fleet@local" -c user.name="Fleet" commit -m "chore: seed $NAME from munder-difflin fleet-strategies/$LETTER"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$OWNER/$NAME.git"
git push -u origin main
echo "Seeded https://github.com/$OWNER/$NAME"
