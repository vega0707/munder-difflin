# Browser extension + desktop control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Chrome-extension browser relay + full desktop Computer Use as write-tier MCP tools, wired through existing consent, seat allowlists, and agent spawn settings.

**Architecture:** Electron main owns a localhost WebSocket bridge (extension ↔ CDP) and a desktop control service (nut.js + desktopCapturer). Two bundled stdio MCP entrypoints talk to main over a Unix domain socket; hive merges them into per-session `settings.json` when consented. Renderer adds a Settings panel for token, connection status, and OS permissions.

**Tech Stack:** TypeScript, Electron main IPC, Chrome MV3 extension (`chrome.debugger`), `ws`, `@modelcontextprotocol/sdk`, `@nut-tree/nut-js`, node:test (`.cjs`), existing `MCP_CATALOG` / `buildDefaultMcpServers`.

## Global Constraints

- Both MCP ids: `browser-bridge`, `desktop-control`; `tier: 'write'`, `defaultEnabled: false`.
- Desktop mode: **full open** — no per-action confirmation dialogs.
- Bridge binds **`127.0.0.1` only**; token required for extension WebSocket auth.
- Token lives in harness config only — **never** in hire manifests.
- Hire import must surface consent for write-tier MCP; never auto-enable.
- macOS-first; Windows/Linux desktop = best effort in v1.
- Do not block CI on real Chrome E2E.
- Update `SECURITY.md` to document new localhost listeners and desktop risk.

---

## File map

| File | Responsibility |
|------|----------------|
| `extensions/munder-browser/manifest.json` | MV3 extension manifest |
| `extensions/munder-browser/background.js` | WS client, CDP attach, command dispatch |
| `extensions/munder-browser/popup.html` + `popup.js` | Connection status + token field |
| `src/shared/browserBridgeProtocol.ts` | Shared JSON message types (main ↔ extension ↔ tests) |
| `src/main/browserBridge.ts` | WS server, extension session, pending RPC |
| `src/main/desktopControl.ts` | Screenshot + pointer/keyboard via nut.js |
| `src/main/automationBridge.ts` | Unix socket IPC hub both MCP scripts call |
| `resources/mcp/browser-bridge/index.cjs` | stdio MCP → `browser_*` tools |
| `resources/mcp/desktop-control/index.cjs` | stdio MCP → `desktop_*` tools |
| `src/shared/mcpCatalog.ts` | Two new catalog entries |
| `src/shared/bundledSkills.ts` | Add `browser-automation`, `desktop-automation` |
| `resources/skills/browser-automation/SKILL.md` | Agent operating loop |
| `resources/skills/desktop-automation/SKILL.md` | Agent operating loop |
| `src/main/config.ts` | `browserBridgePort`, `browserBridgeToken` fields |
| `src/main/index.ts` | Start bridge on boot; IPC handlers |
| `src/preload/index.ts` | `window.cth.browserBridge.*`, `desktopControl.*` |
| `src/renderer/src/components/BrowserDesktopSettings.tsx` | Token, status, OS permission UX |
| `src/renderer/src/components/SettingsModal.tsx` | Mount new panel |
| `src/renderer/src/i18n/locales/{en,zh-CN,ar}.json` | Copy |
| `test/browser-bridge.test.cjs` | Protocol + auth unit tests |
| `test/automation-mcp-catalog.test.cjs` | Catalog merge + consent gating |
| `electron-builder.yml` | Copy `extensions/` + `resources/mcp/` |
| `tools/copy-main-assets.cjs` | Dev copy for MCP scripts |
| `SECURITY.md` | Document localhost WS + desktop scope |

---

### Task 1: Shared protocol + config fields

**Files:**
- Create: `src/shared/browserBridgeProtocol.ts`
- Modify: `src/main/config.ts`
- Test: `test/browser-bridge.test.cjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export type BridgeErrorCode =
    | 'BROWSER_BRIDGE_DISCONNECTED'
    | 'BROWSER_BRIDGE_AUTH_FAILED'
    | 'BROWSER_BRIDGE_TIMEOUT'
    | 'STALE_REF';

  export interface BridgeRequest {
    id: string;
    method: string;
    params?: Record<string, unknown>;
  }
  export interface BridgeResponse {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: { code: string; message: string };
  }
  export interface ExtensionHello {
    type: 'hello';
    token: string;
    extensionVersion: string;
  }
  ```

- [ ] **Step 1: Write failing protocol tests**

```js
// test/browser-bridge.test.cjs
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseBridgeMessage, isValidToken } = require('../out/main/browserBridgeProtocol.cjs');

describe('browserBridgeProtocol', () => {
  it('parses hello message', () => {
    const msg = parseBridgeMessage(JSON.stringify({ type: 'hello', token: 'abc', extensionVersion: '0.1.0' }));
    assert.equal(msg.type, 'hello');
  });
  it('rejects missing token', () => {
    assert.equal(isValidToken('', 'abc'), false);
    assert.equal(isValidToken('abc', 'abc'), true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run build && node --test test/browser-bridge.test.cjs`
Expected: module not found

- [ ] **Step 3: Implement protocol module**

Create `src/shared/browserBridgeProtocol.ts` with `parseBridgeMessage`, `isValidToken`, exported types above. Add compile/copy step: either import from shared in tests via ts directly, or re-export from a small `.cjs` shim — **prefer testing pure functions by importing compiled output**; add to `copy-main-assets.cjs`:

```js
['src/shared/browserBridgeProtocol.ts', ...] // OR compile via existing shared import in test:
```

Simpler: put pure helpers in `src/shared/browserBridgeProtocol.ts` and test via:

```js
// test/browser-bridge.test.cjs — import from shared bundle
const { isValidToken, parseBridgeMessage } = require('../src/shared/browserBridgeProtocol.ts');
```

If node can't load TS, duplicate minimal pure functions test target: create `src/shared/browserBridgeProtocol.cjs` twin for tests only — **instead**, follow repo pattern: test imports from `../src/shared/...` using dynamic import or add a `tools/test-shared.cjs` pattern. **Use:**

```js
const { isValidToken } = require('../out/main/../../'); 
```

**Lock in:** add `browserBridgeProtocol.cjs` copy in `copy-main-assets.cjs` from a tiny hand-written CJS file `src/shared/browserBridgeProtocol.cjs` OR test through `node --experimental-strip-types` if available.

**Pragmatic v1:** implement as `src/shared/browserBridgeProtocol.ts` + test file imports compiled output after `npm run build`:

```js
const { isValidToken, parseBridgeMessage } = require('../out/shared/browserBridgeProtocol.js');
```

Ensure `electron-vite` emits shared module to `out/shared/` (check existing shared imports in tests like `test/role-catalog.test.cjs`).

- [ ] **Step 4: Add config fields to `HarnessConfig`**

```ts
// src/main/config.ts
/** Localhost browser bridge (Chrome extension). Token never exported to hire JSON. */
browserBridgePort?: number;      // default 9777
browserBridgeToken?: string;     // random 32-byte hex; generated on first boot if missing
```

In `DEFAULTS`, set `browserBridgePort: 9777`. On `readConfig()`, if `!browserBridgeToken`, generate via `crypto.randomBytes(16).toString('hex')` and persist.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run typecheck && npm run build && node --test test/browser-bridge.test.cjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/browserBridgeProtocol.ts src/main/config.ts test/browser-bridge.test.cjs tools/copy-main-assets.cjs
git commit -m "feat: browser bridge protocol and config token"
```

---

### Task 2: Browser bridge WebSocket server (main)

**Files:**
- Create: `src/main/browserBridge.ts`
- Modify: `src/main/index.ts`
- Test: extend `test/browser-bridge.test.cjs`

**Interfaces:**
- Consumes: `readConfig().browserBridgePort`, `readConfig().browserBridgeToken`, protocol types
- Produces:
  ```ts
  export interface BrowserBridgeStatus {
    listening: boolean;
    extensionConnected: boolean;
    port: number;
  }
  export function startBrowserBridge(): void;
  export function stopBrowserBridge(): void;
  export function getBrowserBridgeStatus(): BrowserBridgeStatus;
  export function invokeBrowserTool(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<unknown>;
  ```

- [ ] **Step 1: Add dependency**

```bash
npm install ws
npm install -D @types/ws
```

- [ ] **Step 2: Write failing integration test (mock WS client)**

```js
it('invokeBrowserTool rejects when extension offline', async () => {
  const { invokeBrowserTool } = await loadBridge(); // test helper starts server
  await assert.rejects(
    () => invokeBrowserTool('browser_tabs', {}),
    (err) => err.code === 'BROWSER_BRIDGE_DISCONNECTED'
  );
});
```

- [ ] **Step 3: Implement `browserBridge.ts`**

Core behavior:
- `WebSocketServer` on `127.0.0.1:port`
- First message must be `ExtensionHello`; wrong token → close socket
- Keep single extension connection (last wins or reject duplicate — **reject duplicate**)
- `invokeBrowserTool(method, params)` assigns UUID, sends `BridgeRequest`, waits for matching `BridgeResponse` with 30s timeout
- Methods implemented by extension in Task 3; server just forwards

- [ ] **Step 4: Wire `startBrowserBridge()` in `src/main/index.ts` app ready**

Call after config load; call `stopBrowserBridge()` on quit.

- [ ] **Step 5: Run tests**

Expected: disconnected error test PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: localhost browser bridge WebSocket server"
```

---

### Task 3: Chrome extension (MV3)

**Files:**
- Create: `extensions/munder-browser/manifest.json`
- Create: `extensions/munder-browser/background.js`
- Create: `extensions/munder-browser/popup.html`
- Create: `extensions/munder-browser/popup.js`
- Create: `extensions/munder-browser/icons/icon128.png` (placeholder PNG)

**Interfaces:**
- Consumes: WS at `ws://127.0.0.1:${port}`, token from `chrome.storage.local`
- Produces: handles bridge methods:
  - `browser_tabs` `{ action: 'list'|'focus'|'open'|'close', tabId?, url? }`
  - `browser_navigate` `{ tabId?, url }`
  - `browser_snapshot` `{ tabId? }` → `{ refs: [{ ref, role, name, bounds? }] }`
  - `browser_click` `{ ref?, x?, y?, tabId? }`
  - `browser_type` `{ ref?, text, tabId? }`
  - `browser_press` `{ key, tabId? }`
  - `browser_screenshot` `{ tabId?, fullPage? }` → `{ base64 }`
  - `browser_evaluate` `{ expression, tabId? }`

- [ ] **Step 1: manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Munder Difflin Browser Bridge",
  "version": "0.1.0",
  "permissions": ["debugger", "tabs", "storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" }
}
```

- [ ] **Step 2: background.js — WS reconnect + CDP**

- Read port/token from `chrome.storage.local` (popup writes them)
- Connect WS; send hello
- On `BridgeRequest`: attach debugger to target tab if needed; dispatch method
- Snapshot: use CDP `Accessibility.getFullAXTree` or simplified DOM walk; assign stable refs `e1`, `e2`, …

- [ ] **Step 3: popup — port default 9777, token paste, status indicator**

- [ ] **Step 4: Manual smoke test doc in extension README**

Create `extensions/munder-browser/README.md` with load-unpacked steps.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: Chrome extension for Munder browser bridge"
```

---

### Task 4: stdio MCP — browser-bridge

**Files:**
- Create: `resources/mcp/browser-bridge/index.cjs`
- Create: `resources/mcp/browser-bridge/package.json` (depends on `@modelcontextprotocol/sdk`)
- Modify: `src/shared/mcpCatalog.ts`
- Modify: `electron-builder.yml`, `tools/copy-main-assets.cjs`
- Test: `test/automation-mcp-catalog.test.cjs`

**Interfaces:**
- Consumes: Unix socket at `{harnessHome}/sockets/automation.sock` OR env `MUNDER_AUTOMATION_SOCK` set by hive when spawning MCP
- Produces: MCP tools registered:
  `browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_screenshot`, `browser_evaluate`

- [ ] **Step 1: Write failing catalog test**

```js
const { MCP_CATALOG } = require('../out/shared/mcpCatalog.js'); // match repo test import style
const entry = MCP_CATALOG.find(e => e.id === 'browser-bridge');
assert.ok(entry);
assert.equal(entry.tier, 'write');
assert.equal(entry.defaultEnabled, false);
```

- [ ] **Step 2: Add catalog entry**

```ts
{
  id: 'browser-bridge',
  label: 'Browser (Chrome extension)',
  description: 'Drive your real Chrome via the Munder browser extension (login state preserved).',
  spec: {
    command: 'node',
    args: ['<mcp-browser-bridge>'],
    env: { MUNDER_AUTOMATION_SOCK: '<sock>' }
  },
  tier: 'write',
  defaultEnabled: false
}
```

- [ ] **Step 3: Implement `automationBridge.ts` Unix socket in main**

Single socket multiplexes `{ service: 'browser'|'desktop', method, params }` → routes to `invokeBrowserTool` or desktop handlers.

Update `buildDefaultMcpServers` in `hive.ts` to replace placeholders:
- `<mcp-browser-bridge>` → absolute path to packaged `resources/mcp/browser-bridge/index.cjs`
- `<sock>` → `{harnessHome}/sockets/automation.sock`

Follow existing `<cwd>` replacement pattern.

- [ ] **Step 4: Implement MCP script**

Use `@modelcontextprotocol/sdk` Server + StdioServerTransport; each tool call writes JSON line to Unix socket, reads response.

- [ ] **Step 5: Run catalog test + typecheck**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: browser-bridge MCP catalog and stdio server"
```

---

### Task 5: Desktop control service + MCP

**Files:**
- Create: `src/main/desktopControl.ts`
- Create: `resources/mcp/desktop-control/index.cjs`
- Modify: `src/shared/mcpCatalog.ts`, `src/main/automationBridge.ts`
- Modify: `package.json` (add `@nut-tree/nut-js`)
- Test: extend `test/automation-mcp-catalog.test.cjs`

**Interfaces:**
- Consumes: `automationBridge` socket routing
- Produces:
  ```ts
  export function desktopScreenshot(): Promise<{ base64: string; width: number; height: number }>;
  export function desktopClick(x: number, y: number): Promise<void>;
  export function desktopMove(x: number, y: number): Promise<void>;
  export function desktopType(text: string): Promise<void>;
  export function desktopHotkey(keys: string[]): Promise<void>;
  export function desktopScreenSize(): Promise<{ width: number; height: number }>;
  export function getDesktopPermissionStatus(): Promise<{ accessibility: boolean; screenCapture: boolean }>;
  ```

MCP tools: `desktop_screenshot`, `desktop_click`, `desktop_move`, `desktop_type`, `desktop_hotkey`, `desktop_screen_size`

- [ ] **Step 1: Add nut.js**

```bash
npm install @nut-tree/nut-js
```

Run `electron-rebuild` if needed (document in plan step).

- [ ] **Step 2: Implement screenshot via Electron `desktopCapturer` in main**

```ts
import { desktopCapturer, screen } from 'electron';
// primary display PNG base64
```

- [ ] **Step 3: Implement pointer/keyboard via nut.js**

Wrap errors as `{ code: 'DESKTOP_PERMISSION_DENIED', message: '...' }`.

- [ ] **Step 4: Add `desktop-control` catalog entry** (mirror browser-bridge pattern)

- [ ] **Step 5: Implement `resources/mcp/desktop-control/index.cjs`**

- [ ] **Step 6: Catalog tests for second entry**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: desktop control MCP with full pointer access"
```

---

### Task 6: Settings UI + IPC

**Files:**
- Create: `src/renderer/src/components/BrowserDesktopSettings.tsx`
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Modify: `src/renderer/src/i18n/locales/en.json`, `zh-CN.json`, `ar.json`

**Interfaces:**
- Consumes: `getBrowserBridgeStatus()`, config token/port
- Produces IPC:
  ```ts
  'browserBridge:status' → BrowserBridgeStatus
  'browserBridge:regenerateToken' → { token: string }
  'desktopControl:permissionStatus' → { accessibility, screenCapture }
  'desktopControl:openAccessibilitySettings' → void
  ```

- [ ] **Step 1: IPC handlers in main + preload typings**

- [ ] **Step 2: BrowserDesktopSettings panel**

Sections:
- Browser: connected/disconnected badge, port, copy token, regenerate, path to `extensions/munder-browser`
- Desktop: permission checklist + "Open System Settings"
- Warning copy: full desktop control is dangerous; write-tier consent required

- [ ] **Step 3: Mount in SettingsModal below McpDefaultsSettings**

- [ ] **Step 4: i18n keys `browserDesktop.*` in en + zh-CN + ar**

- [ ] **Step 5: Manual verify in dev**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: browser and desktop control settings panel"
```

---

### Task 7: Bundled skills + hire consent

**Files:**
- Modify: `src/shared/bundledSkills.ts`
- Create: `resources/skills/browser-automation/SKILL.md`
- Create: `resources/skills/desktop-automation/SKILL.md`
- Modify: `SECURITY.md`
- Test: extend `test/role-catalog.test.cjs` or hire tests if MCP ids validated

**Interfaces:**
- Consumes: MCP tool names from Tasks 4–5
- Produces: skill ids `browser-automation`, `desktop-automation` in `BUNDLED_SKILL_IDS`

- [ ] **Step 1: Add skill ids to `bundledSkills.ts`**

- [ ] **Step 2: Write browser-automation SKILL.md**

Loop: `browser_tabs` → `browser_snapshot` → act by ref → resnapshot on DOM change; stop on 2FA/captcha.

- [ ] **Step 3: Write desktop-automation SKILL.md**

Prefer browser tools for web UIs; use screenshot → click coordinates for native apps.

- [ ] **Step 4: Update SECURITY.md**

Document:
- New WS listener on 127.0.0.1
- Unix automation socket
- Full desktop scope when consented

- [ ] **Step 5: Verify hire import surfaces consent for new MCP ids** (existing `hire.ts` logic should work; add test if missing)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: automation skills and security docs"
```

---

### Task 8: Packaging + floor hook mapping (best effort)

**Files:**
- Modify: `electron-builder.yml` — extraResources for `extensions/munder-browser`, `resources/mcp/**`
- Modify: `tools/copy-main-assets.cjs`
- Modify: `src/main/hooks.ts` or hook shim mapping (if tool_name available)

- [ ] **Step 1: electron-builder extraResources**

```yaml
  - from: extensions/munder-browser
    to: extensions/munder-browser
  - from: resources/mcp
    to: mcp
```

- [ ] **Step 2: Resolve MCP script paths in hive for dev + packaged**

Helper `mcpScriptPath('browser-bridge')` → dev repo path vs `process.resourcesPath/mcp/...`

- [ ] **Step 3: Map `browser_*` PreToolUse → web portal station**

In hook event handler, if `tool_name` matches `/^browser_/`, set station visit `web` (follow existing station naming in codebase).

- [ ] **Step 4: Full regression**

Run: `npm run typecheck && node --test test/*.test.cjs`
Expected: all PASS (except any pre-existing failures — fix none unrelated)

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: package browser extension and automation MCP assets"
```

---

## Manual test checklist (release gate)

- [ ] Load unpacked extension; popup shows Connected after app running
- [ ] Enable `browser-bridge` in Settings MCP toggles; spawn agent; `browser_tabs` lists tabs
- [ ] Navigate logged-in site; snapshot returns refs; click/type works
- [ ] Enable `desktop-control`; grant Accessibility; screenshot returns image
- [ ] Click/type in TextEdit or Notepad works
- [ ] Regenerate token disconnects old extension until updated
- [ ] Hire manifest requesting `browser-bridge` shows consent, does not auto-enable

---

## Spec self-review

| Spec requirement | Task |
|------------------|------|
| Chrome extension + real profile | Task 3 |
| Full desktop (A) | Task 5 |
| Write-tier consent, default off | Task 4, 5 |
| 127.0.0.1 + token | Task 1, 2 |
| MCP via hive merge | Task 4, 5, 8 |
| Settings panel | Task 6 |
| Bundled skills | Task 7 |
| Error codes | Task 2, 5 |
| SECURITY.md | Task 7 |
| No hire token leak | Task 1, 4 |
| Floor station (best effort) | Task 8 |

No placeholders remain; types consistent (`invokeBrowserTool`, `BridgeErrorCode`, catalog ids `browser-bridge` / `desktop-control`).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-31-browser-desktop-control.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement task-by-task in this session with checkpoints

Which approach do you want?
