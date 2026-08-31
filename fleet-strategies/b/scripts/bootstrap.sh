#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$ROOT/refs"
mkdir -p "$REF"

clone_or_update() {
  local url="$1" dir="$2"
  if [[ -d "$REF/$dir/.git" ]]; then
    git -C "$REF/$dir" fetch --depth 1 origin || true
  else
    git clone --depth 1 "$url" "$REF/$dir"
  fi
  echo "$dir $(git -C "$REF/$dir" rev-parse --short HEAD)"
}

{
  echo "# refs $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  clone_or_update https://github.com/vega0707/munder-difflin.git munder-difflin
  clone_or_update https://github.com/iOfficeAI/AionCore.git AionCore
  clone_or_update https://github.com/multica-ai/multica.git multica
} | tee "$REF/VERSIONS.md"

mkdir -p "$ROOT/packages/fleet-protocol" "$ROOT/packages/fleet-daemon" "$ROOT/packages/fleet-gateway"
mkdir -p "$ROOT/apps/shell-web"
echo "Bootstrap done."
