# Local single-machine hardening — design

**Date:** 2026-08-31  
**Repo scope:** `munder-difflin` only (no distributed fleet)

## Already done

- **Ask Me tab** (`AskMeTab`) — humanQA pending list, answer → god mail
- ControlRegistry pause/gate/halt; native CLI permissions
- Kanban with assignee + humanQA display

## Build now

1. **Hard gate:** assignee of any `waitsOnHuman` task → `awaitingHuman` on ControlRegistry → PreToolUse deny + auto-delivery pause; clear when asks resolved
2. **Unify surface:** Ask Me shows count of hard-gated agents; BlockedBanner / strip link into Ask Me
3. **Kanban:** assignee/role filter; jump to Ask Me for waiting cards
4. **Autonomy observability:** Command Center strip — inbox backlog, awaiting-human agents, breaker peek
5. **Headless HTTP (local):** loopback server read-only tasks + health; optional bearer token; Electron unchanged
6. **Persistence:** durable agent layout positions + command history where hooks exist
7. **Hooks→avatars / Telegram:** incremental + thin spike only if time

## Non-goals

Multi-machine claim, Multica/Aion forks, dual mode switches.
