/**
 * Turn a free-text brief into a RoleDefinition draft for the role catalog.
 * Prefers a one-shot `claude -p` JSON response; falls back to a local heuristic
 * so the UI path never hard-blocks when the CLI is missing.
 */

import { spawn } from 'node:child_process';
import { resolveCommand } from './shellEnv';
import {
  OFFICE_CHARACTER_NAMES,
  type OfficeCharacterName
} from '../shared/projectTypes';
import { assertRoleDraft } from '../shared/roleCatalog';
import { BUNDLED_SKILL_IDS } from '../shared/bundledSkills';
import { safeReadonlyMcpIds } from '../shared/roleToolIds';

const PROPOSE_TIMEOUT_MS = 45_000;

const PROPOSE_PROMPT = (brief: string) => `You design ONE office seat role for Munder Difflin.
Return ONLY a JSON object (no markdown) with keys:
  "title" (short job title, <=40 chars),
  "description" (duty blurb, <=200 chars),
  "character" (one of: ${OFFICE_CHARACTER_NAMES.join(', ')})
Optional: "skills" / "mcp" as string arrays of catalog ids.
  skills allowlist: ${BUNDLED_SKILL_IDS.join(', ')}
  mcp allowlist (prefer safe-readonly): ${safeReadonlyMcpIds().join(', ')}
Brief from the human:
${brief.trim()}
`;

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

function heuristicDraft(brief: string): ReturnType<typeof assertRoleDraft> {
  const clean = brief.trim().replace(/\s+/g, ' ');
  const title = clean.slice(0, 40) || 'New role';
  let character: OfficeCharacterName = 'jim';
  const lower = clean.toLowerCase();
  if (/架构|architect/.test(lower)) character = 'oscar';
  else if (/产品|pm|product/.test(lower)) character = 'michael';
  else if (/前端|frontend|ui/.test(lower)) character = 'pam';
  else if (/后端|backend|api/.test(lower)) character = 'dwight';
  else if (/测试|qa|质检/.test(lower)) character = 'creed';
  else if (/运维|ops|devops/.test(lower)) character = 'stanley';
  else if (/合规|安全|legal|toby/.test(lower)) character = 'toby';
  return assertRoleDraft({
    title,
    description: clean.slice(0, 280) || title,
    character,
    source: 'ai-ui'
  });
}

function runClaudePrint(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = resolveCommand('claude') || 'claude';
    const child = spawn(bin, ['-p', prompt, '--output-format', 'json'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('propose timed out'));
    }, PROPOSE_TIMEOUT_MS);
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `claude exited ${code}`));
        return;
      }
      // --output-format json wraps result; also accept raw text
      try {
        const parsed = JSON.parse(stdout) as { result?: string; content?: string };
        if (typeof parsed.result === 'string') {
          resolve(parsed.result);
          return;
        }
      } catch { /* raw */ }
      resolve(stdout.trim() || stderr.trim());
    });
  });
}

export async function proposeRoleFromBrief(
  brief: string,
  cwd?: string
): Promise<
  | { ok: true; draft: ReturnType<typeof assertRoleDraft>; via: 'cli' | 'heuristic' | 'json' }
  | { ok: false; error: string }
> {
  const text = typeof brief === 'string' ? brief.trim() : '';
  if (!text) return { ok: false, error: 'brief required' };

  const asJson = extractJsonObject(text);
  if (asJson) {
    try {
      const draft = assertRoleDraft({ ...(asJson as object), source: 'ai-ui' });
      return { ok: true, draft, via: 'json' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const workCwd = cwd && cwd.trim() ? cwd.trim() : process.cwd();
  try {
    const raw = await runClaudePrint(PROPOSE_PROMPT(text), workCwd);
    const obj = extractJsonObject(raw);
    if (!obj) throw new Error('no JSON in model response');
    const draft = assertRoleDraft({ ...(obj as object), source: 'ai-ui' });
    return { ok: true, draft, via: 'cli' };
  } catch {
    try {
      return { ok: true, draft: heuristicDraft(text), via: 'heuristic' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
