import type { CSSProperties } from 'react';
import { useStore } from '@/store/store';
import { projectTabLabel, canDeleteProject } from '@shared/projectTypes';

export interface ProjectTabBarProps {
  onCreate: () => void;
  onActivate: (projectId: string) => void;
  onRequestDelete: (projectId: string) => void;
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

export function ProjectTabBar({ onCreate, onActivate, onRequestDelete, error }: ProjectTabBarProps) {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const canDelete = canDeleteProject(projects);

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
                title={p.status === 'degraded' ? 'Hive folder is missing' : p.name}
                style={tabStyle(active, p.status === 'degraded')}
              >
                {projectTabLabel(p)}
              </button>
              {canDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
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
        data-tip="New project — pick a god"
        aria-label="New project"
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
      {error && (
        <span style={{ fontSize: 11, color: 'var(--cth-coral-700)', whiteSpace: 'nowrap' }}>{error}</span>
      )}
    </div>
  );
}
