# Slash skill menu — Design

**Date:** 2026-08-31  
**Status:** Approved  
**Reference:** 程小帮 `SlashCommandService` + composer `/` panel; Cursor skill token highlighting  
**Related:** `MessageQueueComposer.tsx`, `src/main/skills.ts`, `SkillsTab.tsx`

## Goal

In `MessageQueueComposer`, typing `/` opens a filtered menu of **installed Claude skills** (like 程小帮 / Cursor). Selecting one **inserts** `/skillName ` into the draft (does not send). The token is **highlighted** in coral while it matches a known local skill.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Menu contents | **Skills only** (no slash commands, MCP, modes) |
| On select | Insert `/name ` at cursor; user sends manually |
| Highlight | Yes — `var(--cth-coral)` token for valid `/skillName` |
| Data | `window.cth.skillsLocal(agent.cwd)`; `provider === 'claude'` only |
| Surface | `MessageQueueComposer` only (v1) |
| Send expansion | None — message goes to agent queue as typed; Claude Code resolves `/skill` |

## Non-goals

- Floor dispatch / AskMe composers
- Plugin prompt templates (`commands/*.md`)
- Built-in tools (`/compact`, `/goal`, plan mode)
- Server-side skill body injection on send
- contenteditable / rich-text editor

## Architecture

```
MessageQueueComposer
  ├─ SkillComposerInput (textarea + mirror overlay + SlashSkillMenu portal)
  ├─ useSlashSkillMenu (open state, filter, keyboard, insert)
  └─ slashSkillMenu.ts (pure: detect token, filter, highlight segments)
```

Skills load once per `agent.cwd` change (same IPC as Skills tab). Menu opens when caret is inside a `/word` token at line start or after whitespace.

## UI

- Popover anchored above textarea (`createPortal`, fixed position — same pattern as Free Flow hint)
- Row: **name** (mono) + **description** (truncate) + **scope** chip (`bundled` / `user` / `project`)
- Empty filter: “No matching skills”
- Max ~8 visible rows, scroll inside panel

## Keyboard

| Key | Menu open | Menu closed |
|-----|-----------|-------------|
| ↑ / ↓ | Move highlight | — |
| Enter | Select highlighted | Send (existing) |
| Tab | Select highlighted | — |
| Esc | Close menu | — |

Respect `isComposingKey` during IME composition.

## Token highlight

- Mirror div behind textarea: same font/size/padding/scroll; renders segments
- Valid skill token: coral foreground (`var(--cth-coral)`)
- Textarea text transparent; caret visible via `caret-color`
- Recompute on every draft change against loaded skill name set
- Manual typing `/today` highlights when name matches list

## i18n

Keys under `queueComposer.slashMenu.*` in `en.json`, `zh-CN.json`, `ar.json`.

## Testing

- Unit tests (`test/slash-skill-menu.test.cjs`) for pure helpers: token detection, filter, highlight segmentation, insert replacement

## Risks

- Mirror/textarea scroll sync — sync `scrollTop` on scroll events
- RTL — use existing `useRtl` / `dir="auto"` on textarea; mirror matches
