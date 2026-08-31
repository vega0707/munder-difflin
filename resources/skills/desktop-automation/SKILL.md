---
name: desktop-automation
version: 1.0.0
description: |
  Control the native desktop — screenshot the display, click coordinates, move
  the pointer, type text, and press hotkeys. Prefer browser-bridge tools for
  web UIs; use desktop tools only for native apps or when the browser extension
  cannot reach the target. Requires the desktop-control MCP server (write tier,
  consent). Use when asked to "click on the app", "use the desktop",
  "automate the native UI", or "control the screen". (munder-difflin)
allowed-tools:
  - desktop_screenshot
  - desktop_click
  - desktop_move
  - desktop_type
  - desktop_hotkey
  - desktop_screen_size
---

## Desktop automation loop

Requires the **desktop-control** MCP server (write tier, user consent). macOS may
require Screen Recording and Accessibility permissions in System Settings.

### Prefer browser tools for web UIs

If the task is a website or web app, use **browser-automation** skills and
`browser_*` tools first. Only fall back to desktop tools when:

- The target is a native desktop application (not in Chrome)
- The browser extension cannot attach (no Chrome tab, internal WebView, etc.)
- The UI is outside the browser window (system dialogs, OS menus, etc.)

### Native app loop (screenshot → click)

1. **Screen size** — `desktop_screen_size` to learn coordinate bounds.
2. **Screenshot** — `desktop_screenshot` to see the current display state.
3. **Plan** — identify the target from the screenshot; estimate (x, y) coordinates.
4. **Act** — `desktop_move` then `desktop_click`, or `desktop_click` directly;
   use `desktop_type` / `desktop_hotkey` for keyboard input.
5. **Rescreenshot** — capture again after each action that may change the UI;
   never assume coordinates from a previous screenshot still apply.

### Stop conditions — ask the human

Stop and ask the human when you encounter:

- System permission prompts (Screen Recording, Accessibility, etc.)
- 2FA, CAPTCHA, or login walls (same as browser automation)
- Payment or irreversible confirmation dialogs
- Uncertainty about which window or element is active

### Safety

- Full desktop control has **no per-action confirmation** — act deliberately.
- Do not click/type into unrelated windows or background apps.
- Do not capture or transmit sensitive on-screen content beyond the task.
