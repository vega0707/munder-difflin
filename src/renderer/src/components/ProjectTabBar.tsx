import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { projectTabLabel, canDeleteProject } from '@shared/projectTypes';

export interface ProjectTabBarProps {
  onCreate: () => void;
  onActivate: (projectId: string) => void;
  onRequestDelete: (projectId: string) => void;
  onJoinFloor?: (projectId: string) => Promise<boolean>;
  error?: string;
}

const tabStyle = (active: boolean, degraded: boolean): CSSProperties => ({
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 12,
  padding: '4px 8px',
  border: 'none',
  borderRadius: 2,
  cursor: 'pointer',
  color: degraded ? 'var(--cth-coral-700)' : 'var(--cth-ink-900)',
  background: active ? 'var(--cth-lemon-light)' : 'var(--cth-paper-100)',
  boxShadow: active
    ? 'inset 0 0 0 1.5px var(--cth-ink-900)'
    : 'inset 0 0 0 1px var(--cth-ink-300)'
});

export function ProjectTabBar({ onCreate, onActivate, onRequestDelete, onJoinFloor, error }: ProjectTabBarProps) {
  const { t } = useTranslation();
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const canDelete = canDeleteProject(projects);
  const known = new Set(projects.map((p) => p.projectId));
  const [joinOpen, setJoinOpen] = useState(false);
  const [floors, setFloors] = useState<Array<{ projectId: string; name: string; agents: unknown[] }>>([]);

  useEffect(() => {
    if (!joinOpen) return;
    void window.cth.seatListFloors?.().then((list) => {
      setFloors((list ?? []).filter((f) => !known.has(f.projectId)));
    }).catch(() => setFloors([]));
  }, [joinOpen, projects.length]);

  return (
    <div
      className="cth-titlebar-nodrag"
      style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflowX: 'auto' }}>
        {projects.map((p) => {
          const active = p.projectId === activeProjectId;
          return (
            <span key={p.projectId} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <button
                type="button"
                onClick={() => onActivate(p.projectId)}
                title={p.status === 'degraded' ? t('projects.degradedTitle') : p.name}
                style={tabStyle(active, p.status === 'degraded')}
              >
                {projectTabLabel(p)}
              </button>
              {canDelete && (
                <button
                  type="button"
                  aria-label={t('projects.deleteAria', { name: p.name })}
                  onClick={() => onRequestDelete(p.projectId)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--cth-ink-500)',
                    fontSize: 11,
                    padding: '0 2px',
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      <button
        type="button"
        className="cth-tip"
        onClick={onCreate}
        data-tip={t('projects.newTip')}
        aria-label={t('projects.newAria')}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, padding: 0, flexShrink: 0,
          background: 'var(--cth-paper-100)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          border: 'none', borderRadius: 2, cursor: 'pointer',
          color: 'var(--cth-ink-900)'
        }}
      >
        +
      </button>
      {onJoinFloor && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            className="cth-tip"
            onClick={() => setJoinOpen((v) => !v)}
            data-tip={t('projects.joinTip')}
            aria-label={t('projects.joinAria')}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 28, padding: '0 8px', flexShrink: 0,
              background: 'var(--cth-paper-100)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              border: 'none', borderRadius: 2, cursor: 'pointer',
              color: 'var(--cth-ink-900)', fontSize: 11
            }}
          >
            {t('projects.join')}
          </button>
          {joinOpen && (
            <div style={{
              position: 'absolute', top: 32, left: 0, zIndex: 40, minWidth: 220,
              background: 'var(--cth-paper-100)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              padding: 6
            }}>
              {floors.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', padding: 6 }}>
                  {t('projects.noHubFloors')}
                </div>
              ) : floors.map((f) => (
                <button
                  key={f.projectId}
                  type="button"
                  onClick={() => {
                    setJoinOpen(false);
                    void onJoinFloor(f.projectId);
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    padding: '6px 8px', fontSize: 12, color: 'var(--cth-ink-900)'
                  }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && (
        <span style={{ fontSize: 11, color: 'var(--cth-coral-700)', whiteSpace: 'nowrap' }}>{error}</span>
      )}
    </div>
  );
}
