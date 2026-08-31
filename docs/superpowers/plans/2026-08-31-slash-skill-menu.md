# Slash skill menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` in `MessageQueueComposer` opens a skill picker; selection inserts `/name ` with coral token highlight (程小帮 / Cursor-style).

**Architecture:** Pure helpers in `slashSkillMenu.ts`; hook owns menu state + IPC skill load; `SkillComposerInput` wraps textarea + mirror overlay + portal menu; wire into existing composer only.

**Tech Stack:** React, TypeScript, `createPortal`, existing `skillsLocal` IPC, node:test (`.cjs`).

## Global Constraints

- Skills only; `provider === 'claude'`.
- Insert only; never auto-send on pick.
- Highlight color: `var(--cth-coral)`.
- v1 scope: `MessageQueueComposer` only.
- IME: guard with `isComposingKey`.
- i18n: `en`, `zh-CN`, `ar`.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/renderer/src/components/slashSkillMenu.ts` | Pure: detect `/` token, filter, segments for highlight, insert |
| `src/renderer/src/hooks/useSlashSkillMenu.ts` | Load skills, menu open/filter/index, keyboard, insert |
| `src/renderer/src/components/SlashSkillMenu.tsx` | Popover list UI |
| `src/renderer/src/components/SkillComposerInput.tsx` | Textarea + mirror + menu mount |
| `src/renderer/src/components/MessageQueueComposer.tsx` | Replace raw textarea with `SkillComposerInput` |
| `src/renderer/src/i18n/locales/{en,zh-CN,ar}.json` | Copy |
| `test/slash-skill-menu.test.cjs` | Pure helper tests |

---

### Task 1: Pure slash helpers + tests

**Files:** Create `slashSkillMenu.ts`, `test/slash-skill-menu.test.cjs`

- [ ] `detectSlashQuery(text, caret)` → `{ active, query, start, end } | null`
- [ ] `filterSkills(skills, query)` case-insensitive name/description
- [ ] `insertSkillToken(text, range, skillName)` → new text + caret
- [ ] `segmentForHighlight(text, skillNames)` → `{ plain, skill }[]`
- [ ] Tests green via `node --test test/slash-skill-menu.test.cjs`

---

### Task 2: Hook + menu UI

**Files:** `useSlashSkillMenu.ts`, `SlashSkillMenu.tsx`

- [ ] Load `skillsLocal(agent.cwd)` on mount/cwd change
- [ ] Menu state tied to `detectSlashQuery`
- [ ] Keyboard: ↑↓ Enter Tab Esc; Enter does not send when open
- [ ] Portal popover above anchor rect

---

### Task 3: SkillComposerInput + composer wire-up

**Files:** `SkillComposerInput.tsx`, `MessageQueueComposer.tsx`

- [ ] Mirror overlay sync scroll + font from composer props
- [ ] Coral highlight for valid tokens
- [ ] Preserve paste, drag-drop, rtl, font size behavior

---

### Task 4: i18n + manual verify

- [ ] Add locale strings
- [ ] Run unit tests + typecheck if available
