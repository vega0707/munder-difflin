# Ctrip / 程小帮 ASR for Free Flow — Design

**Date:** 2026-08-31  
**Status:** Approved  
**Related:** Free Flow dictation, `sttProviders.ts`, `freeflow.ts`, 程小帮 ctrip `serverVoiceInput` path

## Goal

把 Free Flow 听写对齐程小帮**携程版**体验：本机录 16kHz WAV → 主进程带订阅 Bearer → 写死的 `xiaobang.ctripcorp.com` ASR。Token 仅来自环境变量 `CXB_ASR_TOKEN`，不上 git、不写入持久化 config。硅基流动 / Groq 仍可选。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| ASR target | Ctrip broker (程小帮 ctrip 同款) |
| Token | `CXB_ASR_TOKEN` env only; never git / never config disk |
| Token validation | Non-empty only (no `cxb_tok_` prefix check) |
| Base URL | Hardcoded `http://xiaobang.ctripcorp.com` |
| ASR path | Hardcoded `/api/chengxiaobang/tools/asr` |
| Provider model | Third STT id `ctrip` alongside `groq` / `siliconflow` |
| Default provider | If env token set and `freeflowProvider` unset or still default `groq` → prefer `ctrip`; do not override user-chosen siliconflow/groq |
| Settings token UI | Status only: configured / missing (no input box) |
| Missing token | Ctrip stays in dropdown; dictate returns clear error |
| Recording (ctrip only) | AudioContext → resample 16 kHz → 16-bit mono WAV |
| Other providers | Keep existing MediaRecorder webm + multipart |
| Language | Fixed `"zh"` in broker body |
| Min / max clip | ~300 ms min; ~120 s max (auto-stop + transcribe) |
| Level meter | Yes, on ctrip recording path |
| Timeout | 60 s |
| Errors | Neutral failure copy; 401 → check `CXB_ASR_TOKEN` |
| Proxy | Main-process `fetch` direct (corp net / VPN assumed) |
| Talk / Realtime | Unchanged |
| Docs | README how-to + CHANGELOG |
| Token provenance | Manual export / paste into env; do **not** read 程小帮 Application Support |

## Non-goals

- System-speech helpers (程小帮 oss 回退)
- Streaming partials into the composer
- Ctrip / Coding Plan SSO login inside munder-difflin
- Persisting or bundling the token
- Changing Talk / OpenAI Realtime
- Configurable ASR base URL (this revision)

## Architecture

```
[Renderer] freeflowProvider === 'ctrip'
  → getUserMedia → AudioContext capture
  → resample 16 kHz → encode WAV
  → level meter while recording
  → IPC freeflow:transcribe { audio, mimeType: 'audio/wav', … }

[Main] read process.env.CXB_ASR_TOKEN
  → if empty: { ok: false, error: … }
  → POST http://xiaobang.ctripcorp.com/api/chengxiaobang/tools/asr
       Authorization: Bearer <token>
       Content-Type: application/json
       body: { audio: <base64>, mimeType: 'audio/wav', language: 'zh' }
  → expect { success: true, text: string } (程小帮 broker 形状)
  → return text → Free Flow insert into queue composer
```

Groq / SiliconFlow: existing webm + OpenAI-compatible multipart path unchanged.

## Components

| Unit | Responsibility |
|------|----------------|
| `sttProviders` | Add `ctrip` metadata (label keys, no OpenAI-compat endpoint; flag or separate client) |
| Main `freeflow:transcribe` / new `transcribeWithCtrip` | Env token, JSON POST, map broker response / errors |
| Renderer recorder | Branch: ctrip → WAV pipeline + levels; else → existing MediaRecorder |
| Settings Voice tab | Provider option + env configured/missing; no secret field |
| Config bootstrap | One-shot default to `ctrip` when token present and provider still groq/unset |
| i18n | en / zh-CN / ar strings for provider + errors + status |

## Config / secrets

- **Persist:** `freeflowProvider: 'groq' \| 'siliconflow' \| 'ctrip'` (and existing freeflow fields).
- **Never persist:** `CXB_ASR_TOKEN`.
- **Read:** `process.env.CXB_ASR_TOKEN` in main only; never send to renderer.
- **IPC status (optional):** `freeflow:ctripTokenPresent: boolean` (boolean only) for settings badge.

## Error handling

| Case | Behavior |
|------|----------|
| Empty token | Dictate fails with message to set `CXB_ASR_TOKEN` |
| HTTP 401 | 「请检查 CXB_ASR_TOKEN」 (or i18n equiv.) |
| Broker `success !== true` / bad body | Neutral transcribe-failed + short server message if safe |
| Abort / timeout | 60 s → timeout error |
| Clip &lt; ~300 ms | Skip upload (same UX idea as 程小帮) |
| Clip hits ~120 s | Auto-stop and transcribe |

Do not log the token.

## Testing

1. **Unit:** provider id resolve; ctrip request URL/path/headers shape (token redacted in asserts); empty-token error; WAV/base64 helpers; default-provider bootstrap rules.
2. **Optional integration:** gated on `CXB_ASR_TOKEN` (skip if unset); real short fixture → non-empty text or documented skip.

## Docs

- README: enable Free Flow → set `CXB_ASR_TOKEN` → select 程小帮 provider (or auto-default) → hold Option / mic.
- CHANGELOG: new ctrip STT provider + env var note (no sample secrets).

## Implementation notes

- Mirror 程小帮 payload: raw base64 **without** `data:` URL prefix.
- Audio base64 size: keep a sane cap (程小帮 ~10 MB decoded-equivalent); reject before POST.
- Level meter: reuse or lightly extend Free Flow UI; only required when provider is ctrip (may show whenever WAV path is active).
