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
  clone_or_update https://github.com/multica-ai/multica.git multica
  clone_or_update https://github.com/iOfficeAI/AionCore.git AionCore
  clone_or_update https://github.com/iOfficeAI/AionUi.git AionUi
  clone_or_update https://github.com/vega0707/munder-difflin.git munder-difflin
} | tee "$REF/VERSIONS.md"

mkdir -p "$ROOT/shell" "$ROOT/adapters"
[[ -f "$ROOT/adapters/aion-gap.md" ]] || cat > "$ROOT/adapters/aion-gap.md" <<'EOF'
# Aion capability gap (vs Multica mainline)

| Capability | Multica today | Aion reference | Plan |
|------------|---------------|----------------|------|
| Team MCP tools / wake | skills + assign | Team MCP + scheduler | TBD |
| AskUser / permission UX | Inbox / review | ACP permission + questions | TBD |
| Cowork remote web | built-in | AionUi remote | Prefer Multica; shell brands later |
EOF

[[ -f "$ROOT/shell/README.md" ]] || cat > "$ROOT/shell/README.md" <<'EOF'
# Munder shell adapter (Strategy D)

P0: document how the Munder UI will read Multica projects/tasks/runtimes.
Options: REST read-only → then write actions → then office-floor visualization.
EOF

echo "Bootstrap done."
