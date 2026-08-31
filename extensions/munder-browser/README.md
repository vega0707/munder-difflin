# Munder Difflin Browser Bridge (Chrome Extension)

MV3 extension that connects your Chrome browser to the Munder Difflin localhost WebSocket bridge for agent-driven automation.

## Load unpacked

1. Build or run Munder Difflin so the browser bridge is listening (default `127.0.0.1:9777`).
2. Copy the **browser bridge token** from Munder harness config / Settings.
3. Open Chrome → **Extensions** → enable **Developer mode**.
4. Click **Load unpacked** and select this directory:
   ```
   extensions/munder-browser
   ```
5. Click the extension icon → paste the token → set port (default `9777`) → **Save & Connect**.
6. Confirm the popup shows **Connected** (green dot).

## Manual smoke test

Use these steps after loading the extension and starting Munder:

- [ ] Popup shows **Connected** when Munder bridge is running and token matches.
- [ ] Popup shows **Disconnected** when Munder is stopped or token is wrong.
- [ ] From Munder (or a test script calling `invokeBrowserTool`), `browser_tabs` with `{ action: 'list' }` returns open tabs.
- [ ] `browser_navigate` opens a URL in the active tab.
- [ ] `browser_snapshot` returns `{ refs: [{ ref, role, name }] }` with stable refs like `e1`, `e2`.
- [ ] `browser_click` with a ref from the latest snapshot clicks the element.
- [ ] `browser_type` inserts text into a focused or referenced field.
- [ ] `browser_press` sends a key (e.g. `Enter`).
- [ ] `browser_screenshot` returns `{ base64 }` PNG data.
- [ ] `browser_evaluate` runs JS and returns `{ value }`.
- [ ] Chrome shows the debugger banner on tabs under automation (expected with `chrome.debugger`).

## Protocol

- WebSocket: `ws://127.0.0.1:<port>`
- First message: `{ type: 'hello', token, extensionVersion }`
- Requests: `{ id, method, params }`
- Responses: `{ id, ok, result? }` or `{ id, ok: false, error: { code, message } }`

## Permissions

- **debugger** — CDP attach for snapshot, click, type, screenshot, evaluate
- **tabs** — list/focus/open/close tabs
- **storage** — persist port, token, connection status
- **host_permissions `<all_urls>`** — navigate and interact with any tab

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Stays disconnected | Ensure Munder is running, port matches, token is correct |
| Auth failure (immediate disconnect) | Regenerate token in Munder and update extension popup |
| `STALE_REF` on click/type | Call `browser_snapshot` again after DOM changes |
| Debugger banner stuck | Close tab or disable/re-enable extension |
