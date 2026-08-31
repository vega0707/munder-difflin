import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { useFleetTelemetry } from '@/hooks/useTelemetry';
import { parseTasks, waitsOnHuman } from './hiveTasks';

const POLL_MS = 5000;

/**
 * Compact autonomy strip for Command Center — how many cards wait on Ask Me,
 * how many assignees are hard-gated, and whether any cost breakers are open.
 */
export function HivePulse() {
  const { t } = useTranslation();
  const requestCommandCenterTab = useStore((s) => s.requestCommandCenterTab);
  const agents = useStore((s) => s.agents);
  const restorable = useStore((s) => s.restorableAgents);
  const { breakers } = useFleetTelemetry();
  const [askCount, setAskCount] = useState(0);
  const [gatedIds, setGatedIds] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const tasks = parseTasks(await window.cth.hiveTasks());
      const waiting = tasks.filter(waitsOnHuman);
      setAskCount(waiting.length);
      const ids = new Set<string>();
      for (const task of waiting) {
        const id = task.assignee?.trim();
        if (id) ids.add(id);
      }
      setGatedIds([...ids]);
    } catch { /* keep last good */ }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const gatedNames = useMemo(
    () => gatedIds.map((id) =>
      agents.find((a) => a.id === id)?.name
      ?? restorable.find((a) => a.id === id)?.name
      ?? id
    ),
    [gatedIds, agents, restorable]
  );

  const openBreakers = useMemo(() => {
    const list: string[] = [];
    for (const [id, state] of Object.entries(breakers ?? {})) {
      if (state && state.level && state.level !== 'healthy') list.push(id);
    }
    return list;
  }, [breakers]);

  const quiet = askCount === 0 && gatedIds.length === 0 && openBreakers.length === 0;

  return (
    <div style={{
      flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '5px 10px',
      background: quiet ? 'var(--cth-cream-100)' : 'var(--cth-lilac-light, #ece2f5)',
      borderBottom: '1px solid var(--cth-ink-300)',
      fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-700)'
    }}>
      <span style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)',
        letterSpacing: '0.04em'
      }}>{t('hivePulse.title')}</span>
      {quiet ? (
        <span style={{ color: 'var(--cth-ink-300)' }}>{t('hivePulse.quiet')}</span>
      ) : (
        <>
          <span>
            {t('hivePulse.askMe')}: <strong style={{ color: 'var(--cth-ink-900)' }}>{askCount}</strong>
          </span>
          <span>
            {t('hivePulse.gated')}:{' '}
            <strong style={{ color: 'var(--cth-ink-900)' }}>
              {gatedIds.length}{gatedNames.length ? ` (${gatedNames.join(', ')})` : ''}
            </strong>
          </span>
          {openBreakers.length > 0 && (
            <span>
              {t('hivePulse.breakers')}:{' '}
              <strong style={{ color: 'var(--cth-coral)' }}>{openBreakers.length}</strong>
            </span>
          )}
          {askCount > 0 && (
            <button
              type="button"
              onClick={() => requestCommandCenterTab('human')}
              style={{
                marginLeft: 'auto', border: 'none', cursor: 'pointer', padding: '2px 6px',
                background: 'var(--cth-lilac)', color: 'var(--cth-ink-900)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                fontFamily: 'var(--cth-font-display)', fontSize: 8
              }}
            >
              {t('hivePulse.openAskMe')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
