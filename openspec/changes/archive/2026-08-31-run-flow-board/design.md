# 流程 Run 看板 — Design

**Change:** `run-flow-board` (`local-run-flow-board`)  
**Status:** Architecture approved 2026-08-31  
**PRD:** `docs/dcsspec/local-run-flow-board/prd.md`

## Goal

Command Center gains a **流程** tab: Run → steps (1:1 task) board + expand for dynamics/outputs. Fixes focus thrash, broken storyline, and scattered outputs. Does not replace 任务 / 动态.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Boundary | Run = request → success/fail; step = exactly one task |
| Multi in-flight | Floor overview shell; Run remains primary key |
| Step source | Plan skeleton; coarse auto from events; hybrid fills gaps with source tags |
| Focus | Never auto-select agent; optional「去看 Ta」 |
| Failure | Highlight + keep history; **retry from failed step onward** |
| History | Durable across sessions inside hive |
| Persistence | Hive Run projection files (not new SQLite / not Baiji) |
| Retry path | Reset failed+later tasks → Run in_progress → request god via existing hiveSend (UI never writes worker inbox) |

## Non-goals

Compare/export/share Runs; dual step tracks; fine-grained blocked/waiting-human states; empty-state dispatch composer; default focus-follow; replace 任务/动态.

## Architecture

Single Electron repo: **main** owns projection + retry orchestration; **preload** adds Run IPC; **renderer** Flow tab; **shared** Run/Step types.

```
Human request → god (existing)
       ↓
tasks.json / board.md / log.jsonl / messages
       ↓
Run projection (hive)  ←── authoritative storyline index
       ↓
IPC → Flow tab (overview | board | step detail | retry)
```

### Phases

1. **A** Run projection + hooks on tasks/log/send  
2. **B** Flow tab UI (single Run + detail + focus rules)  
3. **C** Floor overview + history switcher  
4. **D** Retry orchestration  

### IPC intents (new)

- List Runs / default view (overview vs single)  
- Get Run board + step detail  
- Retry from failed step onward  

Existing `hive:tasks` / `hive:log` / board / inbox stay for 任务/动态; Flow prefers projection APIs.

## Run lifecycle

- **New Run:** human sends a **new `conversation`** `request` to god via existing entry (Floor / webhook / voice — same router). Same conversation continuation does **not** open a new Run.
- **End Run:** all steps `done` → success; any step `failed` (or explicit Run fail) → failed; optional `skipped` steps do not block success if product rules say so (v1: failed step ⇒ Run failed).
- **Run id:** stable for the lifetime of that conversation’s execution arc; retry **reuses** the same Run id (history stays one storyline).

## Consistency (projection ↔ tasks)

- **Step authority:** `tasks.json` is source of truth for step membership and status; projection is an index + denormalized view.
- **Updates:** incremental on `writeTasks` / `addTask` / patch paths, `appendLog`, and human `request` (Run start).
- **Drift recovery:** on load or detected mismatch (missing taskId, orphan step), **rebuild projection from tasks** for that Run; UI may show a brief stale banner if rebuild mid-read.
- **Plan skeleton (v1):** use ordered task chain (`dependsOn` / creation order only); **`board.md` is title/summary text only** — do not parse unstructured board body into steps.

## Retry (idempotent)

- IPC `retryRun` validates: Run exists, status=failed, failed step index known, tasks still on disk.
- Set **`retryInFlight` latch** on Run; reject concurrent retries.
- Reset **failed step and later** tasks in ledger only after latch; completed steps untouched.
- Single **`hiveSend` to god** per successful retry; clear latch on send or rollback latch on failure.
- Renderer never writes worker inbox.

## Trade-offs

- **Overview vs Run:** overview is navigation only when ≥2 in-flight; one in-flight opens that Run directly.  
- **Projection vs log-only:** log tail alone cannot stably 1:1 steps across sessions.  
- **Retry:** ledger mutation + god re-dispatch; completed steps stay read-only.

## Testing note

This product has no AREX/Baiji surface. Acceptance automation = **node:test** contracts on projection/retry + source-structure checks for the Flow tab. Full table lives in the implementation plan §自动化用例.

## OpenSpec / plan

- Plan + acceptance table: `docs/superpowers/plans/2026-08-31-run-flow-board.md`  
- Thin tasks: `openspec/changes/run-flow-board/tasks.md`
