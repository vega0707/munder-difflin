#!/usr/bin/env bash
# Clone upstream references into refs/ (gitignored). Does not fork on GitHub.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$ROOT/refs"
mkdir -p "$REF"

clone_or_update() {
  local url="$1" dir="$2"
  if [[ -d "$REF/$dir/.git" ]]; then
    echo "Updating $dir ..."
    git -C "$REF/$dir" fetch --depth 1 origin
    git -C "$REF/$dir" pull --ff-only || true
  else
    echo "Cloning $dir ..."
    git clone --depth 1 "$url" "$REF/$dir"
  fi
  echo "$dir $(git -C "$REF/$dir" rev-parse --short HEAD) $(git -C "$REF/$dir" rev-parse HEAD)" 
}

{
  echo "# Pinned upstream HEADs (generated $(date -u +%Y-%m-%dT%H:%M:%SZ))"
  clone_or_update https://github.com/iOfficeAI/AionCore.git AionCore
  clone_or_update https://github.com/iOfficeAI/AionUi.git AionUi
  clone_or_update https://github.com/iOfficeAI/aionrs.git aionrs
  clone_or_update https://github.com/multica-ai/multica.git multica
  clone_or_update https://github.com/vega0707/munder-difflin.git munder-difflin
} | tee "$REF/VERSIONS.md"

echo "Done. See refs/VERSIONS.md"
echo "NOTE: Creating your org fork of AionCore on GitHub must be done with a write-capable account."
