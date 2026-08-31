import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowDefaultView, RunRecord, RunStep } from '@shared/runFlow';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';
import { parseTasks, type HiveTask } from './hiveTasks';

const STEP_COLOR: Record<string, string> = {
  pending: 'var(--cth-ink-500)',
  running: 'var(--cth-sky)',
  done: 'var(--cth-mint)',
  failed: 'var(--cth-coral)',
  skipped: 'var(--cth-ink-300)'
};

function stepLabel(status: RunStep['status'], t: (k: string) => string): string {
  return t(`commandCenter.flow.step.${status}`);
}

function truncateTitle(title: string, max = 24): string {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

export function FlowTab() {
  const { t } = useTranslation();
  const select = useStore((s) => s.select);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [view, setView] = useState<FlowDefaultView>({ mode: 'empty' });
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, def] = await Promise.all([
        window.cth.hiveRunFlowList() as Promise<RunRecord[]>,
        window.cth.hiveRunFlowDefaultView() as Promise<FlowDefaultView>
      ]);
      setRuns(list);
      setView(def);
      if (def.mode !== 'overview' && !activeRunId && def.runId) {
        setActiveRunId(def.runId);
      }
    } catch { /* keep last good */ }
    try {
      setTasks(parseTasks(await window.cth.hiveTasks()));
    } catch { /* noop */ }
  }, [activeRunId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId) ?? null,
    [runs, activeRunId]
  );

  const taskById = useMemo(
    () => new Map(tasks.map((tk) => [tk.id, tk])),
    [tasks]
  );

  const inProgress = runs.filter((r) => r.status === 'in_progress');
  const showOverview = view.mode === 'overview' && inProgress.length >= 2 && !activeRunId;

  const onRetry = async () => {
    if (!activeRun || retrying) return;
    setRetrying(true);
    try {
      const res = await window.cth.hiveRunFlowRetry(activeRun.id);
      if (!res.ok) return;
      setExpandedStep(null);
      await refresh();
    } finally {
      setRetrying(false);
    }
  };

  const toggleStep = (taskId: string) => {
    setExpandedStep((prev) => (prev === taskId ? null : taskId));
  };

  const goToAssignee = (taskId: string) => {
    const assignee = taskById.get(taskId)?.assignee;
    if (assignee) select(assignee);
  };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 10, background: 'var(--cth-paper-200)' }}>
      {!runs.length && (
        <div style={{ fontSize: 13, color: 'var(--cth-ink-700)', lineHeight: 1.5 }}>
          {t('commandCenter.flow.emptyHint')}
        </div>
      )}

      {runs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {inProgress.length >= 2 && (
            <PixelButton
              size="sm"
              variant={showOverview ? 'primary' : 'secondary'}
              onClick={() => { setActiveRunId(null); setExpandedStep(null); }}
            >
              {t('commandCenter.flow.floorOverview')}
            </PixelButton>
          )}
          {[...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((r) => (
            <PixelButton
              key={r.id}
              size="sm"
              variant={activeRunId === r.id && !showOverview ? 'primary' : 'secondary'}
              onClick={() => { setActiveRunId(r.id); setExpandedStep(null); }}
            >
              {truncateTitle(r.title)}
            </PixelButton>
          ))}
        </div>
      )}

      {showOverview && (
        <div data-flow-overview style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-500)' }}>
            {t('commandCenter.flow.floorOverview')}
          </div>
          {inProgress.map((r) => {
            const cur = r.steps.find((s) => s.status === 'running' || s.status === 'pending');
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveRunId(r.id)}
                style={{
                  textAlign: 'left', padding: 8, border: '1px solid var(--cth-ink-300)',
                  background: 'var(--cth-paper-100)', cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{r.title}</div>
                <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', marginTop: 4 }}>
                  {cur ? t('commandCenter.flow.currentStep', { step: cur.title ?? cur.taskId }) : t('commandCenter.flow.waiting')}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {activeRun && !showOverview && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-900)' }}>{activeRun.title}</div>
              <div style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{t(`commandCenter.flow.run.${activeRun.status}`)}</div>
            </div>
            {activeRun.status === 'failed' && (
              <PixelButton size="sm" variant="primary" disabled={retrying} onClick={() => { void onRetry(); }}>
                {t('commandCenter.flow.retry')}
              </PixelButton>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {activeRun.steps.map((step) => {
              const open = expandedStep === step.taskId;
              const task = taskById.get(step.taskId);
              return (
                <div key={step.taskId} style={{ border: '1px solid var(--cth-ink-300)', background: 'var(--cth-paper-100)' }}>
                  <button
                    type="button"
                    data-flow-step
                    onClick={() => toggleStep(step.taskId)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left'
                    }}
                  >
                    <span style={{ fontSize: 10, color: STEP_COLOR[step.status] ?? 'var(--cth-ink-500)', flexShrink: 0 }}>
                      {stepLabel(step.status, t)}
                    </span>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--cth-ink-900)' }}>{step.title ?? step.taskId}</span>
                    <span style={{ fontSize: 10, color: 'var(--cth-ink-300)' }}>{step.source}</span>
                  </button>
                  {open && (
                    <div data-flow-step-detail style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--cth-ink-500)', marginBottom: 4 }}>{t('commandCenter.flow.dynamicSummary')}</div>
                        <div style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>
                          {step.summary ?? task?.title ?? step.title ?? '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--cth-ink-500)', marginBottom: 4 }}>{t('commandCenter.flow.output')}</div>
                        <pre style={{
                          margin: 0, padding: 8, maxHeight: 160, overflow: 'auto',
                          background: 'var(--cth-paper-200)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                        }}>
                          {step.output ?? task?.result ?? task?.description ?? t('commandCenter.flow.noOutput')}
                        </pre>
                      </div>
                      {task?.assignee && (
                        <PixelButton size="sm" variant="secondary" onClick={() => goToAssignee(step.taskId)}>
                          {t('commandCenter.flow.goToAgent')}
                        </PixelButton>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!activeRun.steps.length && (
              <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{t('commandCenter.flow.noSteps')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
