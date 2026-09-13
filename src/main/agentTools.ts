/**
 * Tools a built-in (in-process) seat can call.
 *
 * These are the same actions a CLI seat already performs on this machine — read
 * the repo, change a file, run a command, answer hive mail — which is the point:
 * a floor must not lose capability just because a seat has no CLI behind it.
 *
 * Two different guards apply, and they are deliberate:
 *   - `fs_*` go through src/main/fs.ts, so they inherit the workspace fence the
 *     app's own file browser uses. That stops a hallucinated absolute path from
 *     writing outside the project the seat was hired into.
 *   - `shell_run` is deliberately unconstrained in what the command may do, the
 *     same as a CLI seat spawned with the operator's chosen permission mode. A
 *     half-fenced shell would be worse than none: it would read as safe without
 *     being safe. Its cwd is the seat's own workspace.
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { listDir, readFileText, safeResolve, writeFileText } from './fs';
import { createAgentTaskTools, type AgentTaskContext } from './agentTaskTools';
import type { AgentToolDef, AgentToolResult } from './agentRuntime';
import type { HiveMessage } from './hive';

/** Output past this is cut: it is model context, not a log file. */
const MAX_OUTPUT_CHARS = 20_000;
const MAX_SHELL_OUTPUT_CHARS = 20_000;
const DEFAULT_SHELL_TIMEOUT_MS = 120_000;

export interface AgentMailHost {
  inbox(id: string): HiveMessage[];
  send(partial: Partial<HiveMessage>, from?: string): HiveMessage;
}

export interface AgentToolContext {
  /** Every fs tool is confined to this absolute path. */
  workspaceRoot: string;
  /** Where shell commands run. Defaults to `workspaceRoot`. */
  shellCwd?: string;
  hive: AgentMailHost;
  agentId: string;
  agentName: string;
  shellTimeoutMs?: number;
  /** Task-ledger tools. Omitted, the seat simply gets no board access. */
  tasks?: AgentTaskContext;
}

function clamp(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`;
}

function fail(error: string): AgentToolResult {
  return { ok: false, error };
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** One shell command through the platform's shell, bounded in time and output. */
function runShell(command: string, cwd: string, timeoutMs: number): Promise<AgentToolResult> {
  const isWin = process.platform === 'win32';
  const file = isWin ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh';
  const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];

  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = clamp(String(stdout), MAX_SHELL_OUTPUT_CHARS);
        const errText = clamp(String(stderr), MAX_SHELL_OUTPUT_CHARS);
        if (err) {
          // A non-zero exit is the command's answer, not a harness failure: hand
          // the model the code and both streams so it can act on them.
          const code = typeof (err as { code?: unknown }).code === 'number' ? ` (exit ${(err as { code: number }).code})` : '';
          const timedOut = (err as { killed?: boolean }).killed ? ' [timed out]' : '';
          resolve({
            ok: false,
            error: `${err.message}${code}${timedOut}${errText ? `\n${errText}` : ''}${out ? `\n${out}` : ''}`.trim()
          });
          return;
        }
        resolve({ ok: true, output: [out, errText].filter(Boolean).join('\n') || '(no output)' });
      }
    );
  });
}

export function createAgentTools(ctx: AgentToolContext): AgentToolDef[] {
  const shellCwd = ctx.shellCwd ?? ctx.workspaceRoot;
  const shellTimeoutMs = ctx.shellTimeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS;

  return [
    {
      name: 'fs_list',
      description: 'List one directory inside the workspace. Paths are relative to the workspace root.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path, e.g. "." or "src/main"' } },
        required: ['path']
      },
      run: async (input) => {
        const rel = str(input, 'path') ?? '.';
        const res = await listDir(ctx.workspaceRoot, rel);
        if (!res.ok) return fail(res.error);
        const body = res.entries
          .map((e) => `${e.isDir ? 'dir ' : 'file'}  ${e.name}${e.isDir ? '' : `  (${e.size}B)`}`)
          .join('\n');
        return { ok: true, output: clamp(`${res.path}\n${body || '(empty)'}`, MAX_OUTPUT_CHARS) };
      }
    },
    {
      name: 'fs_read',
      description: 'Read a text file inside the workspace. Binary files are refused; use shell_run for those.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      run: async (input) => {
        const rel = str(input, 'path');
        if (!rel) return fail('path is required');
        const res = await readFileText(ctx.workspaceRoot, rel);
        if (!res.ok) return fail(res.error);
        return { ok: true, output: clamp(res.content, MAX_OUTPUT_CHARS) };
      }
    },
    {
      name: 'fs_write',
      description: 'Write a text file inside the workspace, creating parent directories as needed. Overwrites.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content']
      },
      run: async (input) => {
        const rel = str(input, 'path');
        if (!rel) return fail('path is required');
        if (typeof input.content !== 'string') return fail('content must be a string');
        // Resolve through the fence FIRST, so the mkdir below can only ever
        // touch a directory inside the workspace. writeFileText does not create
        // parents, and an agent writing `src/new/thing.ts` should not have to
        // know that — it would just look like a mysterious ENOENT.
        const abs = await safeResolve(ctx.workspaceRoot, rel);
        if (!abs) return fail('path escapes root');
        try {
          await mkdir(dirname(abs), { recursive: true });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
        const res = await writeFileText(ctx.workspaceRoot, rel, input.content);
        if (!res.ok) return fail(res.error);
        return { ok: true, output: `wrote ${input.content.length} chars to ${res.path}` };
      }
    },
    {
      name: 'shell_run',
      description:
        'Run a shell command from the workspace root and get its stdout, stderr and exit code. Use it to build, test, search (rg/grep) or inspect the repo.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string', description: 'Optional directory, relative to the workspace root.' }
        },
        required: ['command']
      },
      run: async (input) => {
        const command = str(input, 'command');
        if (!command) return fail('command is required');
        const rel = str(input, 'cwd');
        // A relative cwd still goes through the workspace fence; the fallback is
        // the seat's own workspace rather than the Electron process cwd.
        let cwd = shellCwd;
        if (rel) {
          const resolved = await listDir(ctx.workspaceRoot, rel);
          if (!resolved.ok) return fail(`cwd: ${resolved.error}`);
          cwd = resolved.path;
        }
        return runShell(command, cwd, shellTimeoutMs);
      }
    },
    {
      name: 'mail_send',
      description: 'Send a hive message to another seat on this floor (the god reads mail as its inbox).',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient seat id, or "god" for the orchestrator.' },
          subject: { type: 'string' },
          body: { type: 'string' },
          act: {
            type: 'string',
            description: 'request | inform | propose | query | agree | refuse | done'
          },
          conversation: { type: 'string', description: 'Thread id to keep a run of messages together.' }
        },
        required: ['to', 'subject', 'body']
      },
      run: async (input) => {
        const to = str(input, 'to');
        if (!to) return fail('to is required');
        try {
          const msg = ctx.hive.send(
            {
              to,
              from: ctx.agentId,
              subject: str(input, 'subject') ?? '(no subject)',
              body: str(input, 'body') ?? '',
              act: (str(input, 'act') as HiveMessage['act']) ?? 'inform',
              conversation: str(input, 'conversation'),
              requires_reply: false
            },
            ctx.agentId
          );
          return { ok: true, output: `sent ${msg.id} to ${to}` };
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      }
    },
    {
      name: 'mail_inbox',
      description: 'Read the mail waiting in this seat’s own inbox.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        try {
          const mail = ctx.hive.inbox(ctx.agentId);
          if (!mail.length) return { ok: true, output: '(inbox empty)' };
          const body = mail
            .map((m) => `[${m.id}] from ${m.from} (${m.act ?? 'inform'}) ${m.subject ?? ''}\n${m.body ?? ''}`)
            .join('\n---\n');
          return { ok: true, output: clamp(body, MAX_OUTPUT_CHARS) };
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      }
    },
    ...(ctx.tasks ? createAgentTaskTools(ctx.tasks) : [])
  ];
}
