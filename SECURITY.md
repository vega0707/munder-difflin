# Security Policy

## Scope

Munder Difflin is a **local-first desktop app**. It spawns local processes in PTYs and
reads/writes files under directories you register. Network exposure is limited to
**localhost-only** services described below; there is no remote auth surface by design.

### Local listeners and IPC

| Surface | Bind / path | Purpose |
|---|---|---|
| Hook server | Unix domain socket under the harness home | In-app hook delivery |
| Browser bridge | **WebSocket on `127.0.0.1` only** (configurable port, default 9777) | Chrome extension ↔ CDP relay; token required |
| Automation bridge | **Unix domain socket** (or Windows named pipe) under the harness home | stdio MCP scripts (`browser-bridge`, `desktop-control`) talk to main |

The browser bridge **never** binds `0.0.0.0`. The bridge token lives in local harness
config only — it is **never** included in hire manifests or exported to agents.

### Automation MCP (consent-gated, dangerous when enabled)

Two write-tier MCP servers ship **off by default**:

- **`browser-bridge`** — agents can drive Chrome tabs attached via the extension
  (navigate, click, type, evaluate JS in page context).
- **`desktop-control`** — agents get **full desktop scope** when you consent: move the
  pointer, click anywhere on screen, type, capture screenshots, and press hotkeys
  **without per-action confirmation**. This is intentionally powerful and risky.

Both require explicit user consent in Settings (or at hire import) before they are
merged into an agent session. macOS may additionally require Screen Recording and
Accessibility permissions for desktop control.

## Supported versions

This is an early prototype. Security fixes target the `main` branch only.

| Version | Supported |
|---|---|
| `main` | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Use GitHub's **private vulnerability reporting**: the *Security → Report a
  vulnerability* tab on https://github.com/chaitanyagiri/munder-difflin, **or**
- Email **girichaitanya11@gmail.com** with a description, reproduction steps, and
  impact.

You can expect an acknowledgement within a few days. Once a fix is available we'll
credit you (unless you prefer to stay anonymous).

## Notes for reviewers

- Renderer ↔ main IPC goes through a typed `contextBridge` (`window.cth`); the renderer
  has no direct Node access (`nodeIntegration: false`, `contextIsolation: true`).
- All `fs:*` / `git:*` IPC calls are sandboxed and path-validated in the main process,
  rooted at an agent's working directory.
- The hive commits to a local git repo from a **single committer** (the main process);
  agents only write plain files.
