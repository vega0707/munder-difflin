/**
 * Desktop control — screenshot (Electron) + pointer/keyboard (@nut-tree/nut-js).
 *
 * Full open desktop: no per-action confirmation. Permission failures surface as
 * `DESKTOP_PERMISSION_DENIED` to agents via automationBridge.
 */
import type { Key as NutKey } from '@nut-tree/nut-js';

export type DesktopErrorCode =
  | 'DESKTOP_PERMISSION_DENIED'
  | 'DESKTOP_UNAVAILABLE'
  | 'DESKTOP_BAD_REQUEST';

export class DesktopError extends Error {
  code: DesktopErrorCode;

  constructor(code: DesktopErrorCode, message: string) {
    super(message);
    this.name = 'DesktopError';
    this.code = code;
  }
}

type NutModule = typeof import('@nut-tree/nut-js');

let nutModule: NutModule | null | undefined;
let nutLoadError: string | null = null;

function loadNut(): NutModule {
  if (nutModule) return nutModule;
  if (nutLoadError) {
    throw new DesktopError('DESKTOP_UNAVAILABLE', nutLoadError);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nutModule = require('@nut-tree/nut-js') as NutModule;
    return nutModule;
  } catch (err) {
    nutLoadError = err instanceof Error ? err.message : String(err);
    throw new DesktopError(
      'DESKTOP_UNAVAILABLE',
      `@nut-tree/nut-js failed to load (${nutLoadError}). Run npx electron-rebuild if native rebuild failed.`
    );
  }
}

/** Test hook: reset lazy nut.js load state. */
export function _resetNutForTest(): void {
  nutModule = undefined;
  nutLoadError = null;
}

/** Test hook: inject a mock nut module or force load failure. */
export function _setNutForTest(mod: NutModule | null, loadError: string | null = null): void {
  nutModule = mod ?? undefined;
  nutLoadError = loadError;
}

function requireElectron(): typeof import('electron') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('electron') as typeof import('electron');
}

/** Map nut.js / OS errors to agent-visible desktop error codes. */
export function mapDesktopError(err: unknown): DesktopError {
  if (err instanceof DesktopError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/accessib|permission|not authorized|assistive|AXError|cannot control/i.test(msg)) {
    return new DesktopError(
      'DESKTOP_PERMISSION_DENIED',
      `Desktop accessibility permission required. Enable Accessibility for this app in System Settings. (${msg})`
    );
  }
  return new DesktopError('DESKTOP_UNAVAILABLE', msg || 'desktop control failed');
}

async function withNut<T>(fn: (nut: NutModule) => Promise<T>): Promise<T> {
  try {
    const nut = loadNut();
    return await fn(nut);
  } catch (err) {
    throw mapDesktopError(err);
  }
}

const KEY_ALIASES: Record<string, string> = {
  cmd: 'LeftSuper',
  command: 'LeftSuper',
  meta: 'LeftSuper',
  super: 'LeftSuper',
  win: 'LeftSuper',
  windows: 'LeftSuper',
  ctrl: 'LeftControl',
  control: 'LeftControl',
  alt: 'LeftAlt',
  option: 'LeftAlt',
  shift: 'LeftShift',
  enter: 'Enter',
  return: 'Return',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right'
};

function parseKeyName(raw: string, KeyEnum: typeof NutKey): NutKey {
  const token = raw.trim();
  if (!token) {
    throw new DesktopError('DESKTOP_BAD_REQUEST', 'empty key name in hotkey');
  }
  const lower = token.toLowerCase();
  const alias = KEY_ALIASES[lower];
  if (alias && alias in KeyEnum) return KeyEnum[alias as keyof typeof KeyEnum];
  if (/^f(\d{1,2})$/.test(lower)) {
    const name = `F${lower.slice(1)}`;
    if (name in KeyEnum) return KeyEnum[name as keyof typeof KeyEnum];
  }
  if (/^[a-z0-9]$/i.test(token)) {
    const letter = token.length === 1 && /[a-z]/i.test(token) ? token.toUpperCase() : token;
    if (letter in KeyEnum) return KeyEnum[letter as keyof typeof KeyEnum];
    const num = `Num${letter}`;
    if (num in KeyEnum) return KeyEnum[num as keyof typeof KeyEnum];
  }
  if (token in KeyEnum) return KeyEnum[token as keyof typeof KeyEnum];
  throw new DesktopError('DESKTOP_BAD_REQUEST', `unknown key: ${raw}`);
}

function parseHotkeys(keys: string[], KeyEnum: typeof NutKey): NutKey[] {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new DesktopError('DESKTOP_BAD_REQUEST', 'keys array required for desktop_hotkey');
  }
  return keys.map((k) => parseKeyName(String(k), KeyEnum));
}

export async function getDesktopPermissionStatus(): Promise<{
  accessibility: boolean;
  screenCapture: boolean;
}> {
  let accessibility = false;
  let screenCapture = false;

  try {
    const { systemPreferences } = requireElectron();
    if (process.platform === 'darwin') {
      accessibility = systemPreferences.isTrustedAccessibilityClient(false);
      screenCapture = systemPreferences.getMediaAccessStatus('screen') === 'granted';
    } else if (process.platform === 'win32') {
      screenCapture = true;
      try {
        await withNut(async ({ mouse }) => {
          await mouse.getPosition();
          accessibility = true;
        });
      } catch {
        accessibility = false;
      }
    } else {
      screenCapture = true;
      try {
        await withNut(async ({ mouse }) => {
          await mouse.getPosition();
          accessibility = true;
        });
      } catch {
        accessibility = false;
      }
    }
  } catch {
    /* plain-node tests or Electron unavailable */
  }

  return { accessibility, screenCapture };
}

export async function desktopScreenshot(): Promise<{ base64: string; width: number; height: number }> {
  try {
    const { desktopCapturer, screen } = requireElectron();
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.size;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });
    if (!sources.length) {
      throw new DesktopError(
        'DESKTOP_PERMISSION_DENIED',
        'Screen capture permission required. Enable Screen Recording for this app in System Settings.'
      );
    }
    const match =
      sources.find((s) => s.display_id === String(primary.id)) ??
      sources.find((s) => /primary|screen 1|display 1/i.test(s.name)) ??
      sources[0];
    const png = match.thumbnail.toPNG();
    return { base64: png.toString('base64'), width, height };
  } catch (err) {
    throw mapDesktopError(err);
  }
}

export async function desktopClick(x: number, y: number): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new DesktopError('DESKTOP_BAD_REQUEST', 'desktop_click requires numeric x and y');
  }
  await withNut(async ({ mouse, Button, Point }) => {
    await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
    await mouse.click(Button.LEFT);
  });
}

export async function desktopMove(x: number, y: number): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new DesktopError('DESKTOP_BAD_REQUEST', 'desktop_move requires numeric x and y');
  }
  await withNut(async ({ mouse, Point }) => {
    await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
  });
}

export async function desktopType(text: string): Promise<void> {
  if (typeof text !== 'string') {
    throw new DesktopError('DESKTOP_BAD_REQUEST', 'desktop_type requires text string');
  }
  await withNut(async ({ keyboard }) => {
    await keyboard.type(text);
  });
}

export async function desktopHotkey(keys: string[]): Promise<void> {
  await withNut(async (nut) => {
    const parsed = parseHotkeys(keys, nut.Key);
    await nut.keyboard.pressKey(...parsed);
    await nut.keyboard.releaseKey(...parsed);
  });
}

export async function desktopScreenSize(): Promise<{ width: number; height: number }> {
  try {
    const { screen } = requireElectron();
    const { width, height } = screen.getPrimaryDisplay().size;
    return { width, height };
  } catch (err) {
    throw mapDesktopError(err);
  }
}

export async function invokeDesktopTool(
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (method) {
    case 'desktop_screenshot':
      return desktopScreenshot();
    case 'desktop_click':
      return desktopClick(Number(params.x), Number(params.y));
    case 'desktop_move':
      return desktopMove(Number(params.x), Number(params.y));
    case 'desktop_type':
      return desktopType(String(params.text ?? ''));
    case 'desktop_hotkey':
      return desktopHotkey(Array.isArray(params.keys) ? params.keys.map(String) : []);
    case 'desktop_screen_size':
      return desktopScreenSize();
    default:
      throw new DesktopError('DESKTOP_BAD_REQUEST', `unknown desktop method: ${method}`);
  }
}
