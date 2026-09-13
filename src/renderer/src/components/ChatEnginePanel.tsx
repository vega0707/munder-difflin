import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { useStore, type Agent } from '@/store/store';
import { useRtl } from '@/i18n/useDirection';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

interface Activity {
  name: string;
  ok: boolean;
}

/**
 * The conversation surface for a seat that has no terminal.
 *
 * A built-in seat runs in the main process, so there is no PTY to attach a
 * terminal to — the tab used to say "no live terminal" and stop there, which
 * read as a broken agent rather than as a different kind of engine. This is what
 * that seat actually has instead: a chat window onto the same runtime that
 * answers its hive mail.
 */
export function ChatEnginePanel({ agent }: ChatEnginePanelProps) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const projectId = useStore((s) => s.activeProjectId) ?? undefined;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** The seat is on a run — possibly one mail started, not just one typed here. */
  const [running, setRunning] = useState(false);
  /** Tool calls the run is blocked on. Empty unless one needs an answer. */
  const [pending, setPending] = useState<Array<{ id: string; name: string }>>([]);
  /** Files the last finished run changed, and whether we already undid them. */
  const [changes, setChanges] = useState<Array<{ path: string }>>([]);
  const [undone, setUndone] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<{ ready: boolean; source?: string } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  // A run can start without this panel: mail wakes the seat. Polling is how the
  // stop and steer controls learn about it. Cheap, and local to this process.
  useEffect(() => {
    let alive = true;
    const ask = () => {
      void window.cth
        .agentChatRunning({ projectId, agentId: agent.id })
        .then((info) => {
          if (!alive) return;
          setRunning(info.running);
          setPending((info.pending ?? []).map((p) => ({ id: p.id, name: p.name })));
        })
        .catch(() => { /* app closing */ });
    };
    ask();
    const timer = setInterval(ask, 2500);
    return () => { alive = false; clearInterval(timer); };
  }, [projectId, agent.id]);

  // Which model channel this machine has, if any. Asked up front so a
  // conversation that cannot work says so before anything is typed into it.
  useEffect(() => {
    let alive = true;
    void window.cth.agentChatReady().then((info) => {
      if (alive) setChannel(info);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.cth.agentChatHistory({ projectId, agentId: agent.id }).then((history) => {
      if (alive) setTurns(history);
    });
    return () => { alive = false; };
  }, [projectId, agent.id]);

  // Progress for THIS seat only: every floor window hears every event.
  useEffect(
    () =>
      window.cth.onAgentChatEvent(({ agentId, event }) => {
        if (agentId !== agent.id || event.kind !== 'tool') return;
        setActivity((prev) => [...prev, { name: event.name ?? '?', ok: Boolean(event.ok) }]);
      }),
    [agent.id]
  );

  // Follow the newest turn, the way a terminal follows its last line.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, activity, busy, running]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);

    // While the seat is already on a run, typing does not start a second one:
    // it goes INTO the run as guidance. That is the only honest reading of a
    // message sent to something already working.
    if (running) {
      setDraft('');
      setTurns((prev) => [...prev, { role: 'user', content: `${t('agentChat.steerTag')} ${text}`, at: Date.now() }]);
      const steered = await window.cth.agentChatSteer({ projectId, agentId: agent.id, text });
      if (!steered.ok) setError(steered.error ?? t('agentChat.failed'));
      return;
    }

    setDraft('');
    setActivity([]);
    setTurns((prev) => [...prev, { role: 'user', content: text, at: Date.now() }]);
    setBusy(true);
    try {
      const res = await window.cth.agentChat({ projectId, agentId: agent.id, text });
      if (res.ok && res.text) {
        setTurns((prev) => [...prev, { role: 'assistant', content: res.text as string, at: Date.now() }]);
      } else {
        // The main process already recorded the user's turn; show why it stopped
        // rather than leaving the message sitting there unanswered.
        setError(res.error ?? t('agentChat.failed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [agent.id, busy, draft, projectId, running, t]);

  const stop = useCallback(async () => {
    setError(null);
    const res = await window.cth.agentChatAbort({ projectId, agentId: agent.id });
    if (!res.ok) setError(res.error ?? t('agentChat.failed'));
    // The poll will clear `running`; drop it now so the button does not feel dead.
    setRunning(false);
    setPending([]);
  }, [agent.id, projectId, t]);

  /** Answer a tool call the run is blocked on. */
  const answer = useCallback(
    async (toolCallId: string, approved: boolean, approvalScope?: 'project') => {
      setError(null);
      const res = await window.cth.agentChatApprove({
        projectId,
        agentId: agent.id,
        toolCallId,
        approved,
        ...(approvalScope ? { approvalScope } : {})
      });
      if (!res.ok) setError(res.error ?? t('agentChat.failed'));
      setPending((prev) => prev.filter((p) => p.id !== toolCallId));
    },
    [agent.id, projectId, t]
  );

  // What the last run changed. Read when a run ends, and on mount, because undo
  // is something you reach for after the fact.
  useEffect(() => {
    if (running) return;
    let alive = true;
    void window.cth.agentChatChanges({ projectId, agentId: agent.id }).then((files) => {
      if (!alive) return;
      setChanges(files.map((f) => ({ path: f.path })));
      setUndone(false);
    });
    return () => { alive = false; };
  }, [agent.id, projectId, running]);

  const revert = useCallback(
    async (direction: 'undo' | 'redo') => {
      setError(null);
      const res = await window.cth.agentChatRevert({ projectId, agentId: agent.id, direction });
      if (!res.ok) {
        setError(res.error ?? t('agentChat.failed'));
        return;
      }
      setUndone(direction === 'undo');
      if (direction === 'undo') setChanges([]);
    },
    [agent.id, projectId, t]
  );

  const unavailable = channel !== null && !channel.ready;

  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-50)' }}
    >
      <div
        ref={scroller}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {turns.length === 0 && !busy && (
          <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
            {t('agentChat.empty', { name: agent.name })}
          </div>
        )}

        {turns.map((turn, i) => (
          <div
            key={`${turn.at}-${i}`}
            style={{
              alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              padding: '6px 9px',
              background: turn.role === 'user' ? 'var(--cth-lemon)' : 'var(--cth-paper-100)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {turn.content}
          </div>
        ))}

        {(busy || running) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start' }}>
            <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
              {activity.length ? t('agentChat.working') : t('agentChat.thinking')}
            </span>
            {activity.map((a, i) => (
              <span key={`${a.name}-${i}`} style={{ fontSize: 11, color: a.ok ? 'var(--cth-ink-500)' : 'var(--cth-red-700, #b3261e)' }}>
                {a.ok ? '·' : '×'} {a.name}
              </span>
            ))}
          </div>
        )}

        {error && (
          <div style={{ fontSize: 11, color: 'var(--cth-red-700, #b3261e)', whiteSpace: 'pre-wrap' }}>{error}</div>
        )}
      </div>

      {/* A run blocked on a tool call waits for an answer here. Without this the
          seat would simply sit there looking busy with nothing saying why. */}
      {pending.map((call) => (
        <div
          key={call.id}
          style={{
            borderTop: '1px solid var(--cth-coral, #b3261e)',
            padding: 8,
            background: 'var(--cth-paper-100)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>
            {t('agentChat.needsPermission', { name: call.name })}
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <PixelButton size="sm" onClick={() => void answer(call.id, true)}>
              {t('agentChat.allowOnce')}
            </PixelButton>
            <PixelButton size="sm" onClick={() => void answer(call.id, true, 'project')}>
              {t('agentChat.allowProject')}
            </PixelButton>
            <PixelButton size="sm" variant="destructive" onClick={() => void answer(call.id, false)}>
              {t('agentChat.deny')}
            </PixelButton>
          </div>
        </div>
      ))}

      {/* What the last run changed. Undo lives here rather than in the IDE because
          the change is the seat's, and undoing it is a decision about the seat. */}
      {!running && (changes.length > 0 || undone) && (
        <div
          style={{
            borderTop: '1px solid var(--cth-ink-300)',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
            {undone ? t('agentChat.changesUndone') : t('agentChat.changes', { count: changes.length })}
          </span>
          <PixelButton size="sm" onClick={() => void revert(undone ? 'redo' : 'undo')}>
            {undone ? t('agentChat.redo') : t('agentChat.undo')}
          </PixelButton>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--cth-ink-300)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {unavailable ? (
          // Explaining the real reason beats a composer that fails on send: this
          // seat is a chat engine, it just has no model channel to run on yet.
          <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', lineHeight: 1.5 }}>
            {t('agentChat.noChannel')}
          </div>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              disabled={busy}
              placeholder={running ? t('agentChat.steerHint') : t('agentChat.placeholder', { name: agent.name })}
              style={{
                width: '100%',
                resize: 'none',
                fontSize: 12,
                fontFamily: 'inherit',
                padding: '6px 8px',
                background: 'var(--cth-paper-100)',
                color: 'var(--cth-ink-700)',
                border: '1px solid var(--cth-ink-300)'
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>
                {channel?.ready && channel.source ? t('agentChat.via', { source: channel.source }) : ''}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {running && (
                  <PixelButton onClick={() => void stop()}>
                    {t('agentChat.stop')}
                  </PixelButton>
                )}
                <PixelButton onClick={() => void send()} disabled={busy || !draft.trim()}>
                  {busy ? t('agentChat.sending') : running ? t('agentChat.steer') : t('agentChat.send')}
                </PixelButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export interface ChatEnginePanelProps {
  agent: Agent;
}
