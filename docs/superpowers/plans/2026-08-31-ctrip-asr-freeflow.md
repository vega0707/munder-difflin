# Ctrip ASR Free Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Free Flow STT provider `ctrip` that records 16 kHz WAV and transcribes via `http://xiaobang.ctripcorp.com/api/chengxiaobang/tools/asr` using env `CXB_ASR_TOKEN` (never persisted).

**Architecture:** Extend `sttProviders` + a dedicated `transcribeWithCtrip` JSON client in main; branch `freeflow:transcribe` so Ctrip does not require `groqApiKey`. Renderer uses AudioContext→WAV+level meter only when provider is `ctrip`; Groq/SiliconFlow keep MediaRecorder webm. One-shot autoselect writes `ctrip` when token is present and provider is still default groq.

**Tech Stack:** TypeScript, Electron IPC, node:test (.cjs) via `test/load-ts.cjs`, existing Free Flow recorder/settings.

**Spec:** `docs/superpowers/specs/2026-08-31-ctrip-asr-freeflow-design.md`

## Global Constraints

- Token only from `process.env.CXB_ASR_TOKEN`; never git, never config disk, never send full token to renderer (boolean presence OK).
- Base URL hardcoded `http://xiaobang.ctripcorp.com`; path `/api/chengxiaobang/tools/asr`.
- Language in broker body fixed `"zh"`.
- Ctrip recording: 16 kHz 16-bit mono WAV; min ~300 ms; max ~120 s; level meter; timeout 60 s.
- Do not touch Talk / Realtime Michael.
- Do not read 程小帮 Application Support for the token.

## File map

| File | Role |
|------|------|
| `src/shared/sttProviders.ts` | Add `ctrip` id + metadata (`kind: 'ctrip-broker'`, no OpenAI endpoint) |
| `src/shared/wavEncode.ts` | Pure resample + WAV bytes + base64 helpers (Node + browser) |
| `src/main/freeflow.ts` | Add `transcribeWithCtrip`; keep `transcribeWithGroq` |
| `src/main/config.ts` / renderer `store/config.ts` / preload types | `freeflowProvider` includes `ctrip`; optional `freeflowCtripAutoselected` |
| `src/main/index.ts` | Branch transcribe; token-present IPC; one-shot autoselect |
| `src/preload/index.ts` | Expose `freeflowCtripTokenPresent` (boolean) |
| `src/renderer/src/freeflow/recorder.ts` | Ctrip WAV path + levels + min/max |
| `src/renderer/src/components/MessageQueueComposer.tsx` | Show level while recording (ctrip) |
| `src/renderer/src/components/SettingsModal.tsx` | Provider option + configured/missing badge |
| i18n `en.json` / `zh-CN.json` / `ar.json` | Provider + status + errors |
| `README.md` / `CHANGELOG.md` | How-to + unreleased note |
| `test/stt-providers.test.cjs` | ctrip resolve |
| `test/wav-encode.test.cjs` | WAV helpers |
| `test/freeflow-ctrip-transcribe.test.cjs` | Ctrip client + empty token + 401 |
| `test/freeflow-ctrip-integration.test.cjs` | Optional live call if env set |

---

### Task 1: `ctrip` in `sttProviders`

**Files:**
- Modify: `src/shared/sttProviders.ts`
- Test: `test/stt-providers.test.cjs`

**Interfaces:**
- Produces: `SttProviderId` includes `'ctrip'`; `STT_PROVIDERS.ctrip`; `isSttProviderId`; `resolveSttProvider` (unknown still → groq)
- `SttProvider` gains `kind: 'openai-compat' | 'ctrip-broker'` (ctrip has empty `endpoint` / placeholder model list)

- [ ] **Step 1: Extend failing tests**

```js
test('ctrip is a first-class provider id', () => {
  assert.equal(isSttProviderId('ctrip'), true);
  const p = resolveSttProvider('ctrip');
  assert.equal(p.id, 'ctrip');
  assert.equal(p.kind, 'ctrip-broker');
});
```

(Import `isSttProviderId` from the module.)

- [ ] **Step 2: Run** `node --test test/stt-providers.test.cjs` — expect FAIL (no `ctrip` / no `kind`)

- [ ] **Step 3: Implement** in `sttProviders.ts`:

```ts
export type SttProviderId = 'groq' | 'siliconflow' | 'ctrip';

export interface SttProvider {
  id: SttProviderId;
  kind: 'openai-compat' | 'ctrip-broker';
  endpoint: string; // unused for ctrip-broker (keep '')
  defaultModel: string; // unused for ctrip (keep '')
  models: readonly { id: string; labelKey: 'fast' | 'accurate' | 'sensevoice' | 'ctripAsr' }[];
  signupUrl: string; // empty or docs anchor for ctrip
}

// groq + siliconflow: kind: 'openai-compat'
// ctrip:
ctrip: {
  id: 'ctrip',
  kind: 'ctrip-broker',
  endpoint: '',
  defaultModel: '',
  models: [{ id: 'ctrip-asr', labelKey: 'ctripAsr' }],
  signupUrl: ''
}
```

Update `isSttProviderId` to include `'ctrip'`.

- [ ] **Step 4: Run tests** — PASS

- [ ] **Step 5: Commit** `feat: add ctrip STT provider id`

---

### Task 2: WAV encode helpers

**Files:**
- Create: `src/shared/wavEncode.ts`
- Test: `test/wav-encode.test.cjs`

**Interfaces:**
- Produces:
  - `resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array`
  - `encodeWavPcm16Mono(samples: Float32Array, sampleRate: number): Uint8Array`
  - `uint8ToBase64(bytes: Uint8Array): string`
  - constants: `CTRIP_WAV_RATE = 16000`

- [ ] **Step 1: Failing tests** — silent Float32 tone → WAV has `RIFF`/`WAVE`, data size matches; resample 48k→16k length ≈ 1/3; base64 round-trips length

- [ ] **Step 2: Run** `node --test test/wav-encode.test.cjs` — FAIL

- [ ] **Step 3: Implement** pure PCM16 little-endian WAV (44-byte header), linear resample, base64 via `Buffer` in Node and `btoa` chunking in browser (`typeof Buffer !== 'undefined' ? … : …`)

- [ ] **Step 4: Tests PASS

- [ ] **Step 5: Commit** `feat: shared 16 kHz WAV encode helpers`

---

### Task 3: `transcribeWithCtrip` client

**Files:**
- Modify: `src/main/freeflow.ts`
- Test: `test/freeflow-ctrip-transcribe.test.cjs`

**Interfaces:**
- Produces:

```ts
export const CTRIP_ASR_URL = 'http://xiaobang.ctripcorp.com/api/chengxiaobang/tools/asr';
export const CTRIP_ASR_TIMEOUT_MS = 60_000;
export const CTRIP_MAX_AUDIO_BASE64_LENGTH = Math.ceil((10 * 1024 * 1024) / 3) * 4;

export function readCxbAsrToken(env?: NodeJS.ProcessEnv): string | undefined;

export async function transcribeWithCtrip(opts: {
  apiKey: string; // CXB_ASR_TOKEN value
  audio: ArrayBuffer | Uint8Array | Buffer;
  mimeType?: string; // default audio/wav
  language?: string; // default zh
}): Promise<TranscribeResult>;
```

- Consumes: WAV bytes from renderer (already encoded)

- [ ] **Step 1: Failing tests** (mock `fetch`):
  - empty key → `{ ok: false, error }` matching `/CXB_ASR_TOKEN/`
  - success body `{ success: true, text: '你好' }` → ok + text; URL === `CTRIP_ASR_URL`; method POST; `Authorization: Bearer …`; JSON body has `audio` base64, `mimeType`, `language: 'zh'`; error string must not contain the raw key
  - HTTP 401 → error matches `/CXB_ASR_TOKEN/`
  - `{ success: false, message: 'x' }` → ok false, includes message
  - oversized base64 → reject before fetch

- [ ] **Step 2: Run** — FAIL

- [ ] **Step 3: Implement** `transcribeWithCtrip` + `readCxbAsrToken` (`env.CXB_ASR_TOKEN?.trim() || undefined`). Cap using base64 length of payload. Never `console.log` the token.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** `feat: Ctrip ASR JSON transcription client`

---

### Task 4: Main IPC wiring + autoselect + token presence

**Files:**
- Modify: `src/main/index.ts` (`freeflow:setConfig`, `freeflow:transcribe`, startup)
- Modify: `src/main/config.ts` — `freeflowProvider?: 'groq' | 'siliconflow' | 'ctrip'`; `freeflowCtripAutoselected?: boolean`
- Modify: `src/preload/index.ts` — types + `freeflowCtripTokenPresent: () => ipcRenderer.invoke('freeflow:ctripTokenPresent')`
- Modify: `src/renderer/src/store/config.ts` — type union
- Test: extend `test/stt-providers.test.cjs` or small `test/freeflow-ctrip-bootstrap.test.cjs` for pure `shouldAutoselectCtrip(cfg, tokenPresent)` helper (extract tiny function in `src/shared/sttProviders.ts` or `src/main/freeflow.ts`)

**Interfaces:**
- Produces: `shouldAutoselectCtrip({ freeflowProvider, freeflowCtripAutoselected }, tokenPresent: boolean): boolean`
- Rule: `tokenPresent && !freeflowCtripAutoselected && (provider == null || provider === 'groq')`
- On app ready (near existing config load): if should autoselect → `writeConfig({ freeflowProvider: 'ctrip', freeflowCtripAutoselected: true })`
- `freeflow:transcribe`:
  - if provider `ctrip`: require `readCxbAsrToken()`; call `transcribeWithCtrip`; **do not** require `groqApiKey`
  - else: existing Groq/SiliconFlow path (still needs `groqApiKey`)
- `freeflow:ctripTokenPresent` → `{ present: boolean }`

- [ ] **Step 1: Test** `shouldAutoselectCtrip` cases (token+groq+!flag → true; siliconflow → false; flag true → false; no token → false)

- [ ] **Step 2: Implement helper + IPC branch + preload + types**

- [ ] **Step 3: Run unit tests PASS**

- [ ] **Step 4: Commit** `feat: wire Free Flow Ctrip ASR IPC and autoselect`

---

### Task 5: Renderer Ctrip WAV recorder + level meter + limits

**Files:**
- Modify: `src/renderer/src/freeflow/recorder.ts`
- Modify: `src/renderer/src/components/MessageQueueComposer.tsx` (FreeFlowButton meter)
- Optionally read provider from `useStore` / config snapshot already used for freeflow

**Interfaces:**
- Extend `FreeflowState` with `level: number` (0..1, idle → 0)
- Constants: `MIN_MS = 300`, `MAX_MS = 120_000`
- When `freeflowProvider === 'ctrip'`: AudioContext + ScriptProcessor (or AudioWorklet if already in repo — prefer ScriptProcessor to match 程小帮 / fewer deps), push Float32 chunks, update `level`, on stop resample+encode WAV via `wavEncode`, skip upload if `durationMs < 300`, auto `stop()` at 120 s
- Else: keep MediaRecorder webm path
- `finish` for ctrip: `mimeType: 'audio/wav'`, `filename: 'dictation.wav'`, `language: 'zh'` if IPC accepts language (main already forwards language)

- [ ] **Step 1: Implement WAV branch** (manual / smoke in app; unit-test encode via Task 2)

- [ ] **Step 2: FreeFlowButton** — while `ff.status === 'recording'` and levels useful, show a thin meter from `ff.level` (ctrip); harmless if level stays 0 on webm path

- [ ] **Step 3: Commit** `feat: Ctrip Free Flow WAV capture and level meter`

---

### Task 6: Settings + i18n

**Files:**
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/renderer/src/i18n/locales/en.json`, `zh-CN.json`, `ar.json`

**Behavior:**
- Provider `<select>` includes `ctrip` (use `Object.keys(STT_PROVIDERS)` or explicit options)
- When `ctrip`: hide Groq/SiliconFlow API key fields; show status from `window.cth.freeflowCtripTokenPresent()` → configured / missing (no input)
- Model dropdown: show single ctrip model label or hide model row for `ctrip-broker`
- Fix current ternary that only maps siliconflow|groq so `ctrip` survives load/save

i18n keys (add under `settings.voice`):
- `providerCtrip` / `providerCtripHint`
- `ctripTokenConfigured` / `ctripTokenMissing`
- `ctripAsr` (model label)
- errors can stay English from main for now OR map known strings in recorder — main should return stable English: `set CXB_ASR_TOKEN`, `check CXB_ASR_TOKEN`

- [ ] **Step 1: UI + three locales**

- [ ] **Step 2: Smoke** Settings → Voice shows third option + badge

- [ ] **Step 3: Commit** `feat: Voice settings for Ctrip ASR env token`

---

### Task 7: Docs + optional integration test

**Files:**
- Modify: `README.md` (short Free Flow / Ctrip subsection near voice if present; else Settings Voice)
- Modify: `CHANGELOG.md` under `[Unreleased]` → Added
- Create: `test/freeflow-ctrip-integration.test.cjs`

Integration test:

```js
test('live Ctrip ASR (optional)', { skip: !process.env.CXB_ASR_TOKEN }, async () => {
  // tiny valid WAV from wavEncode silent samples ~0.5s
  // transcribeWithCtrip → assert out.ok or document skip on network fail
});
```

- [ ] **Step 1: README** — `export CXB_ASR_TOKEN=…` (no sample secret); select 程小帮 / auto; hold Option / mic; corp network required

- [ ] **Step 2: CHANGELOG** — Ctrip Free Flow STT via env token

- [ ] **Step 3: Optional integration test** (skip without env)

- [ ] **Step 4: Run** `node --test test/stt-providers.test.cjs test/wav-encode.test.cjs test/freeflow-ctrip-transcribe.test.cjs test/freeflow-transcribe.test.cjs`

- [ ] **Step 5: Commit** `docs: document Ctrip Free Flow ASR setup`

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `CXB_ASR_TOKEN` env only | 3, 4, 6, 7 |
| Hardcoded URL/path | 3 |
| Third provider + autoselect once | 1, 4 |
| Settings status only | 6 |
| Missing token still listed | 6 + dictate error in 3/4 |
| WAV 16 kHz ctrip-only | 2, 5 |
| webm others unchanged | 5 |
| language `zh` | 3, 5 |
| min 300 ms / max 120 s | 5 |
| level meter | 5 |
| 60 s timeout / 401 copy | 3 |
| Unit + optional integration | 1–3, 7 |
| README + CHANGELOG | 7 |
| No Talk / no Application Support read | Global |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-31-ctrip-asr-freeflow.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans and checkpoints  

Which approach?
