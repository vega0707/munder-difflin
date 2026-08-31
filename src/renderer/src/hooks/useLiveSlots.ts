import { useEffect, useRef } from 'react';
import { useStore, type Agent } from '@/store/store';
import {
  buildSpawnCommand,
  inferAgentProvider,
  tokenizeCommand,
  type AgentProvider,
  type HarnessConfig
} from '@/store/config';
import { roleForHiveSpawn } from '@shared/agentRole';
import { agentPtyId } from '@shared/projectTypes';

/** Shown only when a seat has work but cannot start a live engine yet. */
export const WAITING_FOR_LIVE_SLOT = 'waiting for live slot';

/**
 * How long a worker must stay idle (no PTY output + empty queue) before we
 * park the engine and free a live slot. Long enough to avoid thrash between
 * turns; short enough that waiters aren't starved.
 */
const PARK_IDLE_MS = 45_000;

/**
 * Live slots = agents actively processing (live PTY). Idle seats are just
 * "on floor" — do NOT auto-spawn them into a slot.
 *
 * Only promote a seat when it already needs to process: pending message queue
 * or an explicit waiting-for-live-slot marker. When the global cap is hit, mark
 * WAITING_FOR_LIVE_SLOT; when a slot frees, start the next waiter.
 *
 * Iron rule: no live slot without a task; park when idle; roles stay on floor.
 */

let filling = false;
let parking = false;
const skipIds = new Set<string>();

function hasQueuedWork(agentId: string): boolean {
  const q = useStore.getState().messageQueues[agentId];
  return Array.isArray(q) && q.length > 0;
}

function wantsLiveSlot(a: Agent): boolean {
  if (a.archived || a.isGod || a.ptyId || skipIds.has(a.id)) return false;
  if (a.action === WAITING_FOR_LIVE_SLOT) return true;
  return hasQueuedWork(a.id);
}

function nextWaiter(agents: readonly Agent[]): Agent | undefined {
  return agents.find(wantsLiveSlot);
}

function fillProvider(agent: Agent, config: HarnessConfig): AgentProvider {
  const fromAgent = inferAgentProvider(agent.command, agent.provider);
  if (fromAgent !== 'builtin') return fromAgent;
  return inferAgentProvider(config.defaultCommand, config.godProvider === 'builtin' ? 'claude' : config.godProvider);
}

async function resolveSpawnCwd(agent: Agent): Promise<string | null> {
  if (!agent.cwd) return null;
  if (agent.worktreePath && (await window.cth.gitIsRepo(agent.worktreePath).catch(() => false))) {
    return agent.worktreePath;
  }
  return agent.cwd;
}

async function spawnOne(agent: Agent, config: HarnessConfig): Promise<'live' | 'limit' | 'fail'> {
  const provider = fillProvider(agent, config);
  const command = (agent.command ?? '').trim() || buildSpawnCommand(config, agent.model, provider);
  if (!command || !agent.cwd) return 'fail';
  const [exe, ...args] = tokenizeCommand(command);
  const projectId = useStore.getState().activeProjectId ?? 'default';
  const ptyId = agentPtyId(projectId, agent.id);
  const cwd = await resolveSpawnCwd(agent);
  if (!cwd) return 'fail';
  const res = await window.cth.spawnPty({
    id: ptyId,
    cwd,
    command: exe,
    provider,
    args,
    cols: 100,
    rows: 30,
    isolate: false,
    resume: true,
    projectId,
    hive: {
      id: agent.id,
      name: agent.name,
      provider,
      cwd,
      role: roleForHiveSpawn(agent)
    }
  });
  if (!res.ok) {
    if (res.code === 'SPAWN_LIMIT_REACHED') return 'limit';
    console.warn(`[useLiveSlots] spawn failed for ${agent.id}:`, res.error || res.code);
    return 'fail';
  }
  if (res.builtin) {
    useStore.getState().updateAgent(agent.id, { provider: 'builtin', status: 'idle', action: 'idle' });
    return 'fail';
  }
  useStore.getState().updateAgent(agent.id, {
    provider,
    ptyId,
    command,
    status: 'idle',
    action: 'starting up',
    seedPrompt: res.seedPrompt
  });
  return 'live';
}

export async function ensureLiveSlots(config: HarnessConfig | null | undefined): Promise<void> {
  if (!config || filling) return;
  if (useStore.getState().godStatus === 'booting') return;
  filling = true;
  try {
    for (;;) {
      const agents = useStore.getState().agents;
      const next = nextWaiter(agents);
      if (!next) break;
      const result = await spawnOne(next, config);
      if (result === 'limit') {
        // Has work, but no free processor — this is the only "wait for live slot" case.
        useStore.getState().updateAgent(next.id, { action: WAITING_FOR_LIVE_SLOT });
        break;
      }
      if (result !== 'live') {
        skipIds.add(next.id);
        useStore.getState().updateAgent(next.id, { action: 'idle' });
      }
    }
  } finally {
    filling = false;
  }
}

/** Soft-release idle workers so waiters can take a live slot. God stays live. */
export async function parkIdleWorkers(): Promise<void> {
  if (parking) return;
  parking = true;
  try {
    const ptys = await window.cth.listPtys().catch(() => []);
    const lastOut = new Map(ptys.map((p) => [p.id, p.lastOutputAt] as const));
    const now = Date.now();
    const agents = useStore.getState().agents;
    for (const a of agents) {
      if (a.isGod || a.archived || !a.ptyId) continue;
      if (a.status !== 'idle') continue;
      if (hasQueuedWork(a.id)) continue;
      if (a.action === 'starting up' || a.action === 'reconnecting…') continue;
      const last = lastOut.get(a.ptyId);
      if (typeof last !== 'number' || last <= 0 || now - last < PARK_IDLE_MS) continue;
      const res = await window.cth.parkPty(a.ptyId);
      if (!res.ok) {
        console.warn(`[useLiveSlots] park failed for ${a.id}:`, res.error);
        continue;
      }
      useStore.getState().updateAgent(a.id, {
        ptyId: undefined,
        status: 'idle',
        action: 'idle',
        carrying: undefined
      });
    }
  } finally {
    parking = false;
  }
}

/** Mark a seat as needing a live engine (e.g. work was queued while at cap). */
export function markWaitingForLiveSlot(agentId: string): void {
  const a = useStore.getState().agents.find((x) => x.id === agentId);
  if (!a || a.ptyId || a.archived) return;
  useStore.getState().updateAgent(agentId, { action: WAITING_FOR_LIVE_SLOT });
}

export function useLiveSlots(config?: HarnessConfig | null): void {
  const agentKey = useStore((s) => s.agents.map((a) => `${a.id}:${a.ptyId ?? ''}:${a.action}:${a.status}:${a.archived ? 1 : 0}`).join('|'));
  const queueKey = useStore((s) => Object.entries(s.messageQueues).map(([id, q]) => `${id}:${q.length}`).join('|'));
  const godStatus = useStore((s) => s.godStatus);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const maxActive = config?.maxActiveAgents;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parkTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    skipIds.clear();
  }, [activeProjectId]);

  useEffect(() => {
    if (!config) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void ensureLiveSlots(config);
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [config, agentKey, queueKey, godStatus, maxActive]);

  // Periodically park idle workers (no queued work) to free live slots.
  useEffect(() => {
    if (!config) return;
    const tick = (): void => {
      void parkIdleWorkers().then(() => ensureLiveSlots(config));
    };
    parkTimer.current = setInterval(tick, 15_000);
    return () => {
      if (parkTimer.current) clearInterval(parkTimer.current);
    };
  }, [config, activeProjectId]);
}
