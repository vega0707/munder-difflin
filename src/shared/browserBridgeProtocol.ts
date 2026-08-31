/**
 * Browser bridge protocol — shared JSON message types (main ↔ Chrome extension).
 *
 * Pure helpers only; no I/O. The WebSocket server (browserBridge.ts) and the
 * extension both import this module so the contract stays in one place.
 */

import { timingSafeEqual } from 'node:crypto';

export type BridgeErrorCode =
  | 'BROWSER_BRIDGE_DISCONNECTED'
  | 'BROWSER_BRIDGE_AUTH_FAILED'
  | 'BROWSER_BRIDGE_TIMEOUT'
  | 'BROWSER_BRIDGE_BAD_REQUEST'
  | 'STALE_REF';

export interface BridgeRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface ExtensionHello {
  type: 'hello';
  token: string;
  extensionVersion: string;
}

export type BridgeMessage = ExtensionHello | BridgeRequest | BridgeResponse;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse a JSON string from the WebSocket wire into a typed bridge message. */
export function parseBridgeMessage(raw: string): BridgeMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid bridge message JSON');
  }
  if (!isRecord(parsed)) throw new Error('invalid bridge message shape');

  if (parsed.type === 'hello') {
    if (typeof parsed.token !== 'string') throw new Error('hello missing token');
    if (typeof parsed.extensionVersion !== 'string') {
      throw new Error('hello missing extensionVersion');
    }
    return {
      type: 'hello',
      token: parsed.token,
      extensionVersion: parsed.extensionVersion
    };
  }

  if (typeof parsed.id === 'string' && typeof parsed.method === 'string') {
    const req: BridgeRequest = { id: parsed.id, method: parsed.method };
    if (parsed.params !== undefined) {
      if (!isRecord(parsed.params)) throw new Error('request params must be object');
      req.params = parsed.params;
    }
    return req;
  }

  if (typeof parsed.id === 'string' && typeof parsed.ok === 'boolean') {
    const res: BridgeResponse = { id: parsed.id, ok: parsed.ok };
    if (parsed.result !== undefined) res.result = parsed.result;
    if (parsed.error !== undefined) {
      if (!isRecord(parsed.error)) throw new Error('response error must be object');
      if (typeof parsed.error.code !== 'string' || typeof parsed.error.message !== 'string') {
        throw new Error('response error missing code/message');
      }
      res.error = { code: parsed.error.code, message: parsed.error.message };
    }
    return res;
  }

  throw new Error('unrecognized bridge message');
}

/** Constant-time token comparison; empty provided token is always rejected. */
export function isValidToken(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
