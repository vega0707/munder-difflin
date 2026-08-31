---
name: browser-automation
version: 1.0.0
description: |
  Operate Chrome through the Munder browser extension — list tabs, navigate,
  snapshot the page for stable element refs, click/type/press by ref, and
  resnapshot after DOM changes. Stop and ask the human on 2FA, captcha, or
  login walls. Requires the browser-bridge MCP server (write tier, consent).
  Use when asked to "fill out this form", "click through the site",
  "automate the browser", or "use the browser extension". (munder-difflin)
allowed-tools:
  - browser_tabs
  - browser_navigate
  - browser_snapshot
  - browser_click
  - browser_type
  - browser_press
  - browser_screenshot
  - browser_evaluate
---

## Browser automation loop

Requires the **browser-bridge** MCP server (write tier, user consent). The Chrome
extension must be connected in Settings before tools succeed.

### Operating loop

1. **Tabs** — `browser_tabs` to list, focus, open, or close tabs.
2. **Navigate** — `browser_navigate` to load the target URL on the focused tab.
3. **Snapshot** — `browser_snapshot` to capture an accessibility tree with stable
   element refs for interaction.
4. **Act by ref** — use `browser_click`, `browser_type`, or `browser_press` with
   refs from the latest snapshot. Prefer refs over raw coordinates.
5. **Resnapshot** — after any action that may change the DOM (navigation, submit,
   modal open/close, SPA route change), call `browser_snapshot` again before the
   next interaction. Stale refs fail — never reuse refs across a resnapshot boundary.
6. **Verify** — use `browser_screenshot` when a visual check helps; use
   `browser_evaluate` only when snapshot/refs cannot express the check (high privilege).

### Stop conditions — ask the human

**Stop immediately** and ask the human to take over when you encounter:

- Two-factor authentication (2FA), OTP, or SMS codes
- CAPTCHA or bot-detection challenges
- Login walls, OAuth consent screens, or "verify it's you" prompts
- Payment confirmation or irreversible submit steps

Do not attempt to bypass these. Report what you see and wait for guidance.

### Safety

- Stay on task — do not browse unrelated sites.
- Do not exfiltrate credentials, tokens, or session cookies.
- Prefer snapshot refs over `browser_evaluate` when possible.
