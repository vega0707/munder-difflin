#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$ROOT/refs"
mkdir -p "$REF"
for pair in \
  "https://github.com/vega0707/munder-difflin.git munder-difflin" \
  "https://github.com/iOfficeAI/AionCore.git AionCore" \
  "https://github.com/multica-ai/multica.git multica"
do
  set -- $pair
  url=$1; dir=$2
  if [[ ! -d "$REF/$dir/.git" ]]; then
    git clone --depth 1 "$url" "$REF/$dir"
  fi
done
echo "refs ready (read-only)."
