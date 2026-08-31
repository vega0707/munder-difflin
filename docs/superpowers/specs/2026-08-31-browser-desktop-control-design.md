# Browser plugin + desktop control — Design

**Date:** 2026-08-31  
**Status:** Approved (ship browser bridge + full desktop control together)  
**Related:** `mcpCatalog.ts`, `hive.ts` `buildDefaultMcpServers`, `McpDefaultsSettings`, seat allowlists, hire consent

## Goal

Give every hive agent **程小帮 / iClaw-style** ability to:

1. Drive the user's **real Chrome** via a browser extension (cookies, login state, open tabs).
2. Drive the **whole desktop** via screenshot + mouse/keyboard (Computer Use / Full Power).

Both surfaces are exposed as MCP tools, wired through the existing consent + per-seat allowlist path. Default **OFF**; user must opt in.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Scope | Browser plugin **and** desktop control in one feature (user chose B, then Desktop A) |
| Browser mode | Relay extension on real Chrome (not managed/headless Chromium first) |
| Desktop mode | **Full open** — click/type anywhere, any app (iClaw Full Power). No per-action confirmation |
| Transport | Extension ↔ localhost WebSocket bridge; Agent ↔ stdio MCP |
| Consent | Both catalog entries `tier: 'write'`, `defaultEnabled: false` |
| Network | Bridge binds `127.0.0.1` only; random token required |
| Managed browser | Deferred (OpenClaw-style isolated Chromium profile) |
| Chrome Web Store | Deferred; first ship = load unpacked + Settings install guide |

## Non-goals (this change)

- Replacing terminal agents or embedding a full in-app browser UI
- Cloud / remote browser relay
- Auto-enabling either MCP on hire import without consent
- Windows/Linux desktop polish beyond "best effort" in v1 (macOS-first, same as product)
- Replacing Claude Computer Use API; we expose tools; the CLI model decides when to call them

## Architecture

```
Agent CLI (claude / cursor / …)
    │ mcpServers: munder-browser-bridge, munder-desktop-control
    ▼
stdio MCP (spawned by hive hookSettings)
    │
    ├─► browserBridge (main) ──ws+token──► Chrome extension ──CDP──► real tabs
    └─► desktopControl (main) ──nut.js + desktopCapturer──► OS pointer/keyboard/screen
```

Electron **main** owns both bridges. Renderer only shows connection status, token copy, and the existing MCP toggle UI.

### Why extension + bridge (not Playwright-only)

程小帮 / iClaw Relay need **signed-in sessions**. A fresh Playwright profile forces re-login. Extension + `chrome.debugger` reuses the user's Chrome profile and shows the debugger banner so control is visible.

### Why full desktop (A)

User explicitly chose unrestricted Computer Use. Mitigations are **opt-in consent + localhost + token + OS Accessibility prompt**, not per-click dialogs.

## Components

### 1. Chrome extension — `extensions/munder-browser/`

MV3 extension:

| Piece | Role |
|-------|------|
| Service worker | Own WS client to `ws://127.0.0.1:<port>`; reconnect with backoff |
| Popup | Show connected/disconnected; paste/show bridge token |
| Debugger attach | `chrome.debugger` on target tab for CDP commands |

**MCP tool surface (namespaced under browser bridge):**

| Tool | Behavior |
|------|----------|
| `browser_tabs` | List / focus / open / close tabs |
| `browser_navigate` | Navigate focused or given tab |
| `browser_snapshot` | Accessibility / simplified interaction tree with stable `ref`s |
| `browser_click` | Click by `ref` (or coordinates as fallback) |
| `browser_type` | Type into focused field / by `ref` |
| `browser_press` | Key / hotkey |
| `browser_screenshot` | Page (and optional viewport) PNG |
| `browser_evaluate` | Run JS in page (high risk; same write tier) |

Extension never accepts connections from non-loopback hosts.

### 2. Browser bridge — `src/main/browserBridge.ts`

- Starts with app (or on first enable of `browser-bridge` MCP).
- Listens on `127.0.0.1` + ephemeral or fixed local port (stored in config).
- Generates / persists `browserBridgeToken` in harness config (never in hire manifests).
- Translates MCP tool calls ↔ extension JSON-RPC.
- If extension disconnected: MCP tools return a clear error ("install / connect extension").

stdio MCP entry: small Node script under `resources/mcp/browser-bridge/` (or inline launcher) that talks IPC/socket to main — same pattern as other bundled MCP if needed. Prefer **one process owned by main** that agents reach via stdio wrapper, so token never lands in agent cwd.

### 3. Desktop control — `src/main/desktopControl.ts`

| Tool | Implementation |
|------|----------------|
| `desktop_screenshot` | Electron `desktopCapturer` (or nut.js capture) |
| `desktop_click` | `@nut-tree/nut-js` (or equivalent) mouse down/up |
| `desktop_move` | Move pointer |
| `desktop_type` | Keyboard type |
| `desktop_hotkey` | Modifier chords |
| `desktop_screen_size` | Display bounds for coordinate planning |

**Permission:** macOS Accessibility (+ Screen Recording for capture). First enable shows OS Settings deep-link / checklist in Settings UI. Denied permission → tools fail with actionable error, do not crash the hive.

**Full open means:** no renderer confirm dialog before click/type. Floor consent toggle is the gate.

### 4. Catalog + skills integration

`src/shared/mcpCatalog.ts` adds:

```ts
{ id: 'browser-bridge',  label: 'Browser (Chrome extension)', tier: 'write', defaultEnabled: false }
{ id: 'desktop-control', label: 'Desktop control',            tier: 'write', defaultEnabled: false }
```

`buildDefaultMcpServers` continues to:

- namespace as `munder-<id>`
- require explicit `mcpDefaults[id].enabled === true` for write tier
- honor per-seat `seatMcp` allowlists

`bundledSkills.ts` adds:

- `browser-automation` — snapshot → act → resnapshot loop; treat login/2FA/captcha as human blockers
- `desktop-automation` — screenshot → plan → act; prefer browser tools when the target is a web UI

### 5. Settings / UX

Extend Settings (near `McpDefaultsSettings`):

- Toggle states for the two MCP ids (existing catalog UI is enough if entries exist)
- **Browser bridge panel:** port, token (copy/regenerate), extension connected yes/no, "Load unpacked" path hint
- **Desktop panel:** Accessibility / Screen Recording status, "Open System Settings" buttons
- Optional: Skills tab blurb when either capability is on for a seat

Floor: existing PreToolUse → web portal station for browser tools; desktop tools can map to a terminal or new "desk" station if hooks expose tool names (best-effort, non-blocking).

## Data flow

1. User enables `browser-bridge` and/or `desktop-control` in floor MCP defaults (and optionally seat allowlist).
2. Next agent spawn / settings refresh writes `mcpServers['munder-browser-bridge']` / `munder-desktop-control`.
3. Agent calls MCP tool → stdio server → main bridge → extension or nut.js.
4. Result (snapshot text, base64 screenshot, error) returns to the agent turn.

## Error handling

| Failure | Agent-visible result |
|---------|----------------------|
| Extension offline | `BROWSER_BRIDGE_DISCONNECTED` + install steps |
| Wrong / missing token | Auth failure; no CDP attach |
| Tab closed mid-act | `STALE_REF` / tab-gone; skill says resnapshot once |
| Accessibility denied | `DESKTOP_PERMISSION_DENIED` + Settings deep link |
| Captcha / 2FA | Skill instructs agent to stop and ask human — do not guess |

Audit: optional append-only log of desktop tool names + timestamps (no screenshots by default) under hive root when desktop MCP is enabled — for later forensics; v1 can ship a simple event on the existing hive event log if cheap.

## Security model

| Control | Rule |
|---------|------|
| Bind | `127.0.0.1` only |
| Auth | Shared secret token; regenerate invalidates old extension session |
| Consent | Write-tier MCP, default off; hire import surfaces consent |
| Visibility | Chrome debugger banner while attached; OS permission prompts |
| Scope | Browser: user's Chrome; Desktop: entire machine once consented |
| Secrets | Token in harness config / keychain path used by other secrets — never in hire JSON |

Full desktop is **dangerous by design**. Document prominently in Settings and SECURITY.md / release notes.

## Testing

| Layer | Coverage |
|-------|----------|
| Unit | Token auth, MCP catalog merge, seat allowlist gating, disconnected error mapping |
| Integration | Mock WS client ↔ bridge tool dispatch without real Chrome |
| Manual | Load extension → enable MCP → agent navigates logged-in site; desktop screenshot + click notepad |
| Regression | Existing MCP catalog / hire consent tests still pass |

Automated E2E against real Chrome/debugger is optional and flaky — do not block CI on it in v1.

## Implementation phases (same release train)

| Phase | Deliverable |
|-------|-------------|
| P0 | Extension + bridge + `browser_*` MCP + catalog entry |
| P1 | Desktop MCP + OS permission UX |
| P2 | Settings connection panel (token, status) |
| P3 | Bundled skills + floor station mapping |

Ship when P0–P2 are usable; P3 can land same PR if small.

## Open follow-ups (explicitly out of v1)

- Managed isolated Chromium profile
- Chrome Web Store packaging
- Per-action desktop confirm mode (user rejected for v1)
- Remote / multi-machine bridge
