/**
 * Free Flow recorder — a single shared push-to-talk capture engine for the whole
 * renderer. Both entry points use it, so only ONE recording can run at a time:
 *   (A) the "Free Flow" button in MessageQueueComposer (click to start/stop), and
 *   (B) hold-Option-to-talk (see freeflow/holdOption.ts) — start on arm, stop on
 *       Option release.
 *
 * Flow (Groq/SiliconFlow): getUserMedia(audio) → MediaRecorder (webm/opus) → on
 * stop, the blob's bytes go to main over IPC (`freeflowTranscribe`).
 *
 * Flow (Ctrip): getUserMedia → AudioContext + ScriptProcessor → Float32 chunks +
 * level meter → resample/encode WAV via `@shared/wavEncode` → IPC with
 * `audio/wav` + `language: 'zh'`.
 *
 * The transcript is APPENDED to the target agent's composer draft (store.drafts) —
 * never auto-sent — faithful to freeflow: the user reviews, then presses Send/Enter.
 *
 * Hold-to-talk makes the start/stop race real: a user can release Option before
 * getUserMedia resolves. `wantActive` tracks the user's intent so a stop that
 * lands mid-open discards the about-to-start recording instead of stranding it.
 *
 * Exposed as a module singleton + a `useFreeflow()` hook (useSyncExternalStore).
 */
import { useSyncExternalStore } from 'react';
import { CTRIP_WAV_RATE, encodeWavPcm16Mono, resampleLinear } from '@shared/wavEncode';
import { useStore } from '@/store/store';

export type FreeflowStatus = 'idle' | 'recording' | 'transcribing';

export interface FreeflowState {
  status: FreeflowStatus;
  /** The agent whose draft a finished transcript will land in. */
  targetAgentId: string | null;
  /** Last error (mic denied, Groq failure…). Cleared when a new capture starts. */
  error: string | null;
  /** Normalized input level 0..1 (Ctrip ScriptProcessor path; idle → 0). */
  level: number;
}

/** Skip upload for clips shorter than this (matches 程小帮 UX). */
const MIN_MS = 300;
/** Auto-stop long dictation at two minutes. */
const MAX_MS = 120_000;

let state: FreeflowState = { status: 'idle', targetAgentId: null, error: null, level: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<FreeflowState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): FreeflowState {
  return state;
}

// ─── Recording internals ─────────────────────────────────────────────────────
type CaptureMode = 'webm' | 'ctrip-wav';

let captureMode: CaptureMode = 'webm';
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
/** True between start() and the next stop(): the user wants a recording. A stop
 *  that arrives while getUserMedia is still opening flips this so the open path
 *  discards instead of recording. */
let wantActive = false;
/** True while getUserMedia is in flight, to ignore re-entrant start() calls. */
let opening = false;

// Ctrip WAV capture (AudioContext + ScriptProcessor)
let audioContext: AudioContext | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let pcmChunks: Float32Array[] = [];
let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

/** Prefer webm/opus (Groq-supported, Chromium default); fall back to whatever the
 *  platform offers. Returns '' to let MediaRecorder pick its default. */
function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const supported = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
  if (supported) {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
  }
  return '';
}

/** RMS → 0..1 for the level meter (Ctrip path only). */
function computeLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 4);
}

function mergeFloat32Chunks(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of parts) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Release the mic stream so the OS recording indicator clears. */
function teardownStream(): void {
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
  stream = null;
}

function clearMaxDurationTimer(): void {
  if (maxDurationTimer) {
    clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }
}

function teardownCtripNodes(): void {
  clearMaxDurationTimer();
  try { scriptProcessor?.disconnect(); } catch { /* noop */ }
  scriptProcessor = null;
  try { void audioContext?.close(); } catch { /* noop */ }
  audioContext = null;
  pcmChunks = [];
}

/** Append `text` to the target agent's composer draft (with a separating space). */
function deliverTranscript(agentId: string, text: string): void {
  const st = useStore.getState();
  const cur = st.drafts[agentId] ?? '';
  const sep = cur && !/\s$/.test(cur) ? ' ' : '';
  st.setDraft(agentId, cur + sep + text);
}

async function transcribeAndDeliver(
  agentId: string,
  audio: ArrayBuffer | Uint8Array,
  mimeType: string,
  filename: string,
  language?: string
): Promise<void> {
  setState({ status: 'transcribing', error: null, level: 0 });
  try {
    const res = await window.cth.freeflowTranscribe({
      audio,
      mimeType,
      filename,
      ...(language ? { language } : {})
    });
    if (res.ok && res.text) {
      deliverTranscript(agentId, res.text);
      setState({ status: 'idle', error: null, level: 0 });
    } else {
      setState({ status: 'idle', error: res.error || 'transcription failed', level: 0 });
    }
  } catch (e) {
    setState({
      status: 'idle',
      error: e instanceof Error ? e.message : 'transcription failed',
      level: 0
    });
  }
}

/** Begin MediaRecorder (webm) capture on an already-open mic stream. */
function startWebm(agentId: string, opened: MediaStream): void {
  captureMode = 'webm';
  stream = opened;
  chunks = [];
  const mimeType = pickMimeType();
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    teardownStream();
    wantActive = false;
    setState({ status: 'idle', error: 'recording not supported', level: 0 });
    return;
  }
  recorder.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
  recorder.onstop = () => { void finishWebm(agentId); };
  recorder.start();
  setState({ status: 'recording', targetAgentId: agentId, error: null, level: 0 });
}

/** Begin AudioContext WAV capture on an already-open mic stream (Ctrip ASR). */
function startCtrip(agentId: string, opened: MediaStream): void {
  captureMode = 'ctrip-wav';
  stream = opened;
  pcmChunks = [];
  try {
    const ctx = new AudioContext();
    audioContext = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    scriptProcessor = processor;
    processor.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (!wantActive) return;
      const input = ev.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(input));
      setState({ level: computeLevel(input) });
    };
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(processor);
    processor.connect(silent);
    silent.connect(ctx.destination);
    maxDurationTimer = setTimeout(() => stop(), MAX_MS);
    setState({ status: 'recording', targetAgentId: agentId, error: null, level: 0 });
  } catch {
    teardownCtripNodes();
    teardownStream();
    wantActive = false;
    captureMode = 'webm';
    setState({ status: 'idle', error: 'recording not supported', level: 0 });
  }
}

/** Begin capturing for `agentId`. Safe to call only from the idle state; surfaces
 *  a friendly error if the mic can't be opened. */
async function start(agentId: string): Promise<void> {
  if (state.status !== 'idle' || opening) return;
  if (!agentId) { setState({ error: 'no agent selected' }); return; }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    setState({ error: 'microphone not available' });
    return;
  }
  wantActive = true;
  opening = true;
  setState({ error: null });
  let opened: MediaStream;
  let provider: 'groq' | 'siliconflow' | 'ctrip' | undefined;
  try {
    const cfg = await window.cth.getConfig();
    provider = cfg.freeflowProvider;
    opened = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    opening = false;
    wantActive = false;
    const name = e instanceof DOMException ? e.name : '';
    setState({
      status: 'idle',
      error: name === 'NotAllowedError' ? 'microphone permission denied' : 'could not open microphone',
      level: 0
    });
    return;
  }
  opening = false;
  // Released before the mic finished opening (a quick tap) — discard cleanly.
  if (!wantActive) {
    try { opened.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    return;
  }
  if (provider === 'ctrip') startCtrip(agentId, opened);
  else startWebm(agentId, opened);
}

/** Stop the active recording (triggers transcription). If a start is still opening
 *  the mic, this cancels it (the open path discards). */
function stop(): void {
  wantActive = false;
  if (opening) return;
  if (state.status !== 'recording') return;
  if (captureMode === 'ctrip-wav') {
    void finishCtrip();
    return;
  }
  if (!recorder) return;
  try { recorder.stop(); } catch { /* already stopped */ }
}

/** Called when MediaRecorder finishes: assemble the clip, transcribe, deliver. */
async function finishWebm(agentId: string): Promise<void> {
  const type = recorder?.mimeType || 'audio/webm';
  teardownStream();
  recorder = null;
  captureMode = 'webm';
  const blob = new Blob(chunks, { type });
  chunks = [];
  if (blob.size === 0) {
    setState({ status: 'idle', error: 'nothing recorded', level: 0 });
    return;
  }
  const buf = await blob.arrayBuffer();
  const ext = type.includes('ogg') ? 'ogg' : 'webm';
  await transcribeAndDeliver(agentId, buf, type.split(';')[0], `dictation.${ext}`);
}

/** Called when Ctrip ScriptProcessor capture stops: resample, encode WAV, transcribe. */
async function finishCtrip(): Promise<void> {
  const agentId = state.targetAgentId;
  if (!agentId) {
    teardownCtripNodes();
    teardownStream();
    captureMode = 'webm';
    setState({ status: 'idle', level: 0 });
    return;
  }
  const ctx = audioContext;
  const sampleRate = ctx?.sampleRate ?? 48000;
  const parts = pcmChunks;
  teardownCtripNodes();
  teardownStream();
  captureMode = 'webm';

  const merged = mergeFloat32Chunks(parts);
  const durationMs = merged.length > 0 ? (merged.length / sampleRate) * 1000 : 0;
  if (durationMs < MIN_MS || merged.length === 0) {
    setState({ status: 'idle', error: null, level: 0 });
    return;
  }

  const resampled = resampleLinear(merged, sampleRate, CTRIP_WAV_RATE);
  const wav = encodeWavPcm16Mono(resampled, CTRIP_WAV_RATE);
  await transcribeAndDeliver(agentId, wav, 'audio/wav', 'dictation.wav', 'zh');
}

/** Toggle capture for `agentId` (used by the composer button): start if idle,
 *  stop if recording. During transcription it's a no-op (the upload is in flight). */
function toggle(agentId: string): void {
  if (state.status === 'recording') stop();
  else if (state.status === 'idle') void start(agentId);
}

/** True while a clip is recording or uploading — the hold gesture uses this to
 *  avoid starting a second capture. */
function isBusy(): boolean {
  return state.status !== 'idle' || opening;
}

export const freeflowRecorder = { start, stop, toggle, isBusy, subscribe, getSnapshot };

/** React hook: subscribe to the shared recorder state. */
export function useFreeflow(): FreeflowState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
