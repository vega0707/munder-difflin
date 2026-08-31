import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { PixelBadge } from './PixelBadge';
import { Icon } from './Icon';
import { useStore } from '@/store/store';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { useRtl } from '@/i18n/useDirection';
import { parseTasks, waitsOnHuman, type HiveTask } from './hiveTasks';

type Status = HiveTask['status'];

const COLUMNS: { key: Status; labelKey: string; accent: string }[] = [
  { key: 'todo',    labelKey: 'kanban.colTodo',    accent: 'var(--cth-sky)' },
  { key: 'doing',   labelKey: 'kanban.colDoing',   accent: 'var(--cth-lemon)' },
  { key: 'blocked', labelKey: 'kanban.colBlocked', accent: 'var(--cth-coral)' },
  { key: 'done',    labelKey: 'kanban.colDone',    accent: 'var(--cth-mint)' }
];

const POLL_MS = 5000;

/**
 * Task kanban over hive/tasks.json — a READ surface. Polls every 5s; cards
 * carry just the title and open the app-wide detail overlay on click. The god
 * is the ledger's writer: new work enters via the dispatch box (mailed to the
 * god), never by the human inserting cards the orchestrator never heard about.
 */
export function TasksKanban() {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  // Detail view: cards show just the title — clicking one opens the full
  // breakdown as an APP-WIDE overlay over the office floor (see
  // TaskDetailOverlay) — the content grows (contracts, deps, human Q&A), so it
  // gets the big stage instead of the narrow side panel.
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const requestCommandCenterTab = useStore((s) => s.requestCommandCenterTab);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setTasks(parseTasks(await window.cth.hiveTasks())); } catch { /* keep last good */ }
  }, []);

  // Dismiss a card off the board (human-initiated). The kanban is otherwise the
  // god's to write, but a person can clear a card they no longer want tracked.
  // Main removes the named id from its latest on-disk ledger, so a webhook or
  // god card added since this renderer's last poll cannot be lost.
  const dismissTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id)); // optimistic
    try {
      const result = await window.cth.hiveDeleteTask(id);
      if (!result.ok) void refresh();
    } catch { /* keep last good; the next poll re-syncs from disk */ }
  }, [refresh]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const restorableAgents = useStore((s) => s.restorableAgents);
  /** Resolve an assignee id to a display name — falls back to the restorable
   *  roster so a done card keeps its author's name even after that worker's
   *  terminal is gone, then to the raw id. */
  const nameFor = (id?: string): string | undefined =>
    id
      ? (agents.find((a) => a.id === id)?.name
        ?? restorableAgents.find((a) => a.id === id)?.name
        ?? id)
      : undefined;

  const assigneeOptions = (() => {
    const ids = new Set<string>();
    for (const t of tasks) if (t.assignee) ids.add(t.assignee);
    return [...ids].sort((a, b) => (nameFor(a) ?? a).localeCompare(nameFor(b) ?? b));
  })();

  const visible = assigneeFilter === 'all'
    ? tasks
    : assigneeFilter === 'unassigned'
      ? tasks.filter((t) => !t.assignee)
      : tasks.filter((t) => t.assignee === assigneeFilter);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-200)', position: 'relative' }}>
      {/* Toolbar — read-only: the god is the ledger's writer. New work enters
          through the dispatch box (which mails the god), not by the human
          inserting cards the orchestrator never heard about. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flexShrink: 0,
        borderBottom: '1px solid var(--cth-ink-300)'
      }}>
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-500)' }}>
          {t('kanban.count', { count: visible.length })}
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--cth-ink-500)' }}>
          <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8 }}>{t('kanban.filterAssignee')}</span>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="all">{t('kanban.filterAll')}</option>
            <option value="unassigned">{t('kanban.unassigned')}</option>
            {assigneeOptions.map((id) => (
              <option key={id} value={id}>{nameFor(id)}</option>
            ))}
          </select>
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cth-ink-300)' }}>
          {t('kanban.newWorkHint')}
        </span>
      </div>

      {/* Columns */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', gap: 8, padding: 10, overflowX: 'auto'
      }}>
        {COLUMNS.map((col) => {
          const cards = visible.filter((t) => t.status === col.key);
          return (
            <div key={col.key} style={{
              flex: '1 1 0', minWidth: 170, display: 'flex', flexDirection: 'column',
              background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 4px',
                background: col.accent, boxShadow: 'inset 0 -1px 0 var(--cth-ink-900)',
                fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-900)'
              }}>
                {t(col.labelKey)}
                <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--cth-font-ui)' }}>{cards.length}</span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cards.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-300)', textAlign: 'center', padding: '8px 0' }}>—</div>
                )}
                {cards.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    accent={col.accent}
                    assigneeName={nameFor(t.assignee)}
                    onOpen={() => openTaskDetail(t.id)}
                    onDismiss={() => dismissTask(t.id)}
                    onOpenAskMe={waitsOnHuman(t) ? () => requestCommandCenterTab('human') : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
// Deliberately minimal — a colored status edge, the title, a whisper of an
// assignee. Everything else (the full contract, deps, controls) lives in the
// detail view a click away: a kanban card can carry a title at most.

function TaskCard({ task, accent, assigneeName, onOpen, onDismiss, onOpenAskMe }: {
  task: HiveTask;
  accent: string;
  assigneeName?: string;
  onOpen: () => void;
  onDismiss: () => void;
  onOpenAskMe?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <button
        onClick={onOpen}
        title={t('kanban.openTaskDetails')}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'stretch', gap: 0, padding: 0,
          border: 'none', cursor: 'pointer', textAlign: 'left',
          background: 'var(--cth-paper-100)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
        }}
      >
        <span style={{ width: 4, flexShrink: 0, background: accent, boxShadow: 'inset -1px 0 0 var(--cth-ink-700)' }} />
        <span style={{ flex: 1, minWidth: 0, padding: '6px 18px 6px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
            color: 'var(--cth-ink-900)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>{task.title}</span>
          {assigneeName && (
            <span style={{ fontSize: 10, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-display)' }}>
              {assigneeName.toUpperCase()}
            </span>
          )}
        </span>
        {waitsOnHuman(task) && (
          <span
            role={onOpenAskMe ? 'button' : undefined}
            title={t('kanban.needsYouTitle')}
            onClick={(e) => {
              if (!onOpenAskMe) return;
              e.stopPropagation();
              onOpenAskMe();
            }}
            style={{
              alignSelf: 'center', marginRight: 18, flexShrink: 0,
              fontFamily: 'var(--cth-font-display)', fontSize: 10, padding: '2px 5px 1px',
              background: 'var(--cth-lilac)', color: 'var(--cth-ink-900)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              cursor: onOpenAskMe ? 'pointer' : 'default'
            }}
          >?</span>
        )}
      </button>
      {/* Dismiss — sibling button (not nested) so it never triggers onOpen. */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        title={t('kanban.dismissTitle')}
        aria-label={t('kanban.dismissAria')}
        style={{
          position: 'absolute', top: 0, right: 0, width: 16, height: 16, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          border: 'none', cursor: 'pointer', background: 'transparent',
          color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)', fontSize: 12
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--cth-coral)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--cth-ink-500)'; }}
      >✕</button>
    </div>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────────────
// The full breakdown of one task: status, assignee, priority, the complete
// description (the god writes 4-part dispatch contracts in there — preserved
// line by line), dependencies resolved to their titles, the human Q&A trail,
// and the move/assign controls that used to crowd every card. Rendered as an
// APP-WIDE overlay (over the office floor) — this content grows, so it gets
// the big stage instead of the narrow side panel. Exported for App's
// TaskDetailOverlay; opened via the store's openTaskDetail from anywhere.

export function TaskDetail({ task, all, assigneeName, onMove, onAssign, onClose }: {
  task: HiveTask;
  all: HiveTask[];
  assigneeName?: string;
  onMove: (s: Status) => void;
  onAssign: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const col = COLUMNS.find((c) => c.key === task.status) ?? COLUMNS[0];
  // Belt + suspenders: parseTasks normalizes these, but the ledger is a
  // hand-written file — never trust a card's shape at the point of use.
  const deps = (task.dependsOn ?? [])
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is HiveTask => !!t);
  const created = new Date(task.createdAt);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 280,
        background: 'rgba(26, 19, 32, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '94vw', maxHeight: '90vh', display: 'flex' }}>
        <PixelPanel variant="dialog" title={t('kanban.taskTitle')} noPadding style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0 }}>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
            {/* Title under a status-colored bar */}
            <div style={{ borderLeft: `4px solid ${col.accent}`, paddingLeft: 8 }}>
              <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 15, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
                {task.title}
              </div>
            </div>

            {/* Fact row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'var(--cth-font-display)', fontSize: 8, padding: '2px 6px 1px',
                background: col.accent, color: 'var(--cth-ink-900)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
              }}>{t(col.labelKey)}</span>
              {assigneeName
                ? <PixelBadge status="working" label={assigneeName} />
                : <span style={{ fontSize: 11, color: 'var(--cth-ink-300)' }}>{t('kanban.unassigned')}</span>}
              <PriorityDots level={Math.max(1, Math.min(5, task.priority))} />
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-display)' }}>
                {isNaN(created.getTime()) ? '' : created.toLocaleString()}
              </span>
            </div>

            {/* The contract — preserved line by line */}
            <div style={{
              padding: 10, background: 'var(--cth-paper-100)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '18px',
              color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
            }} dir={rtl ? 'auto' : undefined}>
              {task.description?.trim() || <span style={{ color: 'var(--cth-ink-300)' }}>{t('kanban.noDescription')}</span>}
            </div>

            {/* The human Q&A trail — every decision documented on the card.
                Rendered as markdown (card variant), matching the ASK ME tab the
                "view earlier answers" link arrives from. */}
            {(task.humanQA?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)' }}>
                  {t('kanban.humanQA')}
                </div>
                {task.humanQA!.map((e, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{
                      display: 'flex', gap: 6, padding: '5px 7px',
                      background: 'var(--cth-lilac-light, #ece2f5)',
                      boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                      fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)'
                    }}>
                      <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, flexShrink: 0, marginTop: 2 }}>Q</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <MarkdownPreview source={e.q} variant="card" />
                      </div>
                    </div>
                    {e.a ? (
                      <div style={{
                        display: 'flex', gap: 6, padding: '5px 7px',
                        background: 'var(--cth-mint-light, #d9eed9)',
                        boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                        fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)'
                      }}>
                        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, flexShrink: 0, marginTop: 2 }}>A</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <MarkdownPreview source={e.a} variant="card" />
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--cth-coral)', fontFamily: 'var(--cth-font-display)' }}>
                        {t('kanban.awaitingAnswer')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Dependencies, resolved to titles */}
            {deps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)' }}>
                  {t('kanban.dependsOn')}
                </div>
                {deps.map((d) => {
                  const dc = COLUMNS.find((c) => c.key === d.status) ?? COLUMNS[0];
                  return (
                    <div key={d.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px',
                      background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                      fontSize: 12, color: 'var(--cth-ink-700)'
                    }}>
                      <span style={{ width: 8, height: 8, background: dc.accent, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={task.status}
                onChange={(e) => onMove(e.target.value as Status)}
                style={{
                  flex: 1, padding: '4px 6px', background: 'var(--cth-paper-100)', border: 'none',
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontFamily: 'var(--cth-font-ui)',
                  fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer'
                }}
              >
                {COLUMNS.map((c) => (<option key={c.key} value={c.key}>{t(c.labelKey).toLowerCase()}</option>))}
              </select>
              <PixelButton variant="secondary" size="sm" onClick={onAssign}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Icon name="arrow-right" /> {t('kanban.assign')}
                </span>
              </PixelButton>
              <PixelButton variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

function PriorityDots({ level }: { level: number }) {
  const { t } = useTranslation();
  // 1 = lowest, 5 = highest. Warmer fill as priority climbs.
  const color = level >= 4 ? 'var(--cth-coral)' : level === 3 ? 'var(--cth-lemon)' : 'var(--cth-mint)';
  return (
    <span title={t('kanban.priority', { level })} style={{ display: 'inline-flex', gap: 1, flexShrink: 0, marginTop: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{
          width: 4, height: 8,
          background: i <= level ? color : 'var(--cth-cream-200)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
        }} />
      ))}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', outline: 'none', boxSizing: 'border-box'
};

const selectStyle: React.CSSProperties = {
  padding: '3px 6px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer'
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)'
};
