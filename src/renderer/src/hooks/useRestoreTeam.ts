import { useEffect, useSyncExternalStore } from 'react';
import { useStore, type Agent } from '@/store/store';
import { buildSpawnCommand, inferAgentProvider, type HarnessConfig } from '@/store/config';
import { agentPtyId } from '@shared/projectTypes';

/** "Restore team" — put every previous-session worker back on the floor.
 *
 *  On-demand runtime: restore seats the *role* (command, cwd, session metadata)
 *  without starting a live engine. Work / message queues pull them up via
 *  ensureLiveSlots. Lives here rather than inside AgentStrip because the floor
 *  strip is hidden in fullscreen. */

let restoring = false;
let note: string | null = null;
/** True only while the AUTOMATIC boot restore is in flight, so the UI can say
 *  "this is happening on its own" rather than looking like a click you don't
 *  remember making. */
let autoRestoring = false;
/** Latched the moment the automatic restore starts. Module-level, not per
 *  component: `useRestoreTeam` is mounted from both the floor strip and the
 *  fullscreen rail, and without this each of them would kick off its own. */
let autoStarted = false;
const listeners = new Set<() => void>();

/** How long to wait after boot before restoring on our own.
 *
 *  App.tsx reconciles the persisted roster against the PTYs actually alive in
 *  the main process, and that is an async round trip. Firing before it lands
 *  would read a restorable list that still contains agents whose terminals are
 *  already running. The delay is also the window in which you can hit a dismiss ✕
 *  if you don't want an agent back. */
export const AUTO_RESTORE_DELAY_MS = 2500;

function emit(): void {
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// useSyncExternalStore requires a stable snapshot identity — returning a fresh
// object each call would loop forever, so the two fields are read separately.
const getRestoring = (): boolean => restoring;
const getNote = (): string | null => note;
const getAutoRestoring = (): boolean => autoRestoring;

export interface RestoreTeamState {
  restoring: boolean;
  /** True when the run in flight was started automatically at boot, not by a
   *  click. Drives the "restoring your team…" banner. */
  autoRestoring: boolean;
  /** Outcome of the last run ("seated 3 · 1 already live — …"), or null. */
  restoreNote: string | null;
  restoreTeam: () => Promise<void>;
}

/**
 * @param config used only to rebuild a spawn command for a restorable agent
 *        persisted before the `command` field existed.
 */
export function useRestoreTeam(config?: HarnessConfig | null): RestoreTeamState {
  const isRestoring = useSyncExternalStore(subscribe, getRestoring, getRestoring);
  const restoreNote = useSyncExternalStore(subscribe, getNote, getNote);
  const isAutoRestoring = useSyncExternalStore(subscribe, getAutoRestoring, getAutoRestoring);

  /** Seat every worker from the previous session with its ORIGINAL agent id,
   *  cwd, model and command — no mandatory spawn. Live engines start only when
   *  there is work (ensureLiveSlots) or a PTY is already running. */
  const restoreTeam = async (): Promise<void> => {
    if (restoring) return;
    restoring = true;
    note = null;
    emit();
    const prevSel = useStore.getState().selectedId;
    const restorableAgents = useStore.getState().restorableAgents;
    let seated = 0;
    let alreadyLive = 0;
    const failures: string[] = [];
    try {
      const live = await window.cth.listPtys().catch(() => []);
      const liveIds = new Set(live.map((p) => p.id));
      const projectId = useStore.getState().activeProjectId ?? 'default';

      const seatedInOrder: Array<Agent | null> = [];
      for (const a of restorableAgents) {
        try {
          const provider = inferAgentProvider(a.command, a.provider);
          const command = (a.command ?? '').trim() || (config ? buildSpawnCommand(config, a.model, provider) : '');
          if (!command || !a.cwd) {
            failures.push(`${a.name}: no saved command`);
            seatedInOrder.push(null);
            continue;
          }

          const expectedPty = a.ptyId?.startsWith('pty:') ? a.ptyId : agentPtyId(projectId, a.id);
          if (liveIds.has(expectedPty)) {
            alreadyLive++;
            useStore.getState().removeRestorableAgent(a.id);
            seatedInOrder.push({
              ...a,
              provider,
              command,
              ptyId: expectedPty,
              archived: false,
              status: 'idle',
              action: 'starting up',
              carrying: undefined,
              currentStation: 'desk',
              recentTextTs: Date.now()
            });
            continue;
          }

          // Probe worktree so a later on-demand spawn can resume there; drop a
          // dead path rather than keep re-probing it.
          let worktreePath = a.worktreePath;
          if (worktreePath && !(await window.cth.gitIsRepo(worktreePath).catch(() => false))) {
            worktreePath = undefined;
          }

          seated++;
          seatedInOrder.push({
            ...a,
            provider,
            command,
            ptyId: undefined,
            archived: false,
            status: 'idle',
            action: 'idle',
            worktreePath,
            carrying: undefined,
            currentStation: 'desk',
            recentTextTs: Date.now()
          });
        } catch (e) {
          failures.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
          console.error('[restore] error for', a.id, e);
          seatedInOrder.push(null);
        }
      }

      for (const seatedAgent of seatedInOrder) {
        if (!seatedAgent) continue;
        const existing = useStore.getState().agents.find((x) => x.id === seatedAgent.id);
        if (existing) {
          useStore.getState().updateAgent(seatedAgent.id, {
            provider: seatedAgent.provider,
            ptyId: seatedAgent.ptyId,
            command: seatedAgent.command,
            archived: false,
            status: seatedAgent.status,
            action: seatedAgent.action,
            worktreePath: seatedAgent.worktreePath,
            carrying: undefined,
            currentStation: seatedAgent.currentStation,
            recentTextTs: seatedAgent.recentTextTs
          });
          useStore.getState().removeRestorableAgent(seatedAgent.id);
        } else {
          useStore.getState().addAgent(seatedAgent);
        }
      }
    } finally {
      const sel = useStore.getState();
      if (prevSel && sel.agents.some((x) => x.id === prevSel)) sel.select(prevSel);
      restoring = false;
      const parts: string[] = [];
      if (seated) parts.push(`seated ${seated}`);
      if (alreadyLive) parts.push(`${alreadyLive} already live`);
      if (failures.length) parts.push(`${failures.length} failed — ${failures.join('; ')}`);
      note = parts.length ? parts.join(' · ') : 'nothing to restore';
      emit();
    }
  };

  // Restore the previous session's team on open, without waiting for a click.
  //
  // Deliberately driven by a store SUBSCRIPTION rather than a plain timer: the
  // restorable list is empty on the first render and only fills once App.tsx's
  // PTY reconcile resolves, so a timer started at mount would look at an empty
  // list, decide there was nothing to do, and never look again.
  //
  // Only ever fires for agents already on the restorable list — i.e. ones that
  // had a terminal open when the app last quit. Archived agents (closed tabs)
  // are never touched.
  useEffect(() => {
    if (autoStarted || !config?.onboardingComplete) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = (): void => {
      if (autoStarted || restoring || timer) return;
      if (!useStore.getState().restorableAgents.length) return;
      // Wait for the god bootstrap to finish (ready or failed) so auto-restore
      // cannot race Boss clock-in.
      const gs = useStore.getState().godStatus;
      if (gs === 'booting') return;
      timer = setTimeout(() => {
        timer = null;
        if (autoStarted || restoring) return;
        if (!useStore.getState().restorableAgents.length) return;
        if (useStore.getState().godStatus === 'booting') return;
        // Latch BEFORE the await so the other mount point's timer, which may
        // fire in this same tick, sees it.
        autoStarted = true;
        autoRestoring = true;
        emit();
        void restoreTeam().finally(() => { autoRestoring = false; emit(); });
      }, AUTO_RESTORE_DELAY_MS);
    };

    check();
    const unsub = useStore.subscribe(check);
    return () => { unsub(); if (timer) clearTimeout(timer); };
    // restoreTeam is rebuilt every render but only ever called from inside the
    // timer, so it is read fresh at call time and does not belong in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.onboardingComplete]);

  return { restoring: isRestoring, autoRestoring: isAutoRestoring, restoreNote, restoreTeam };
}
