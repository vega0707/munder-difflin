import { useEffect, useState } from 'react';
import { useStore, flushRoster } from '@/store/store';
import type { ProjectMeta } from '@shared/projectTypes';
import { canDeleteProject } from '@shared/projectTypes';

function asMeta(raw: {
  projectId: string; name: string; createdAt: number; status: string;
  defaultCwd?: string; hiveRootPath: string; godCharacter: string;
}): ProjectMeta {
  return {
    projectId: raw.projectId,
    name: raw.name,
    createdAt: raw.createdAt,
    status: raw.status as ProjectMeta['status'],
    defaultCwd: raw.defaultCwd,
    hiveRootPath: raw.hiveRootPath,
    godCharacter: raw.godCharacter as ProjectMeta['godCharacter']
  };
}

export function useProjects(opts: {
  ready: boolean;
  onNeedCreate?: () => void;
}): {
  switchError: string | undefined;
  activate: (projectId: string) => Promise<boolean>;
  remove: (projectId: string) => Promise<boolean>;
} {
  const [switchError, setSwitchError] = useState<string | undefined>();

  useEffect(() => {
    if (!opts.ready) return;
    let cancelled = false;
    void (async () => {
      const list = await window.cth.projectList().catch(() => []);
      const active = await window.cth.projectGetActive().catch(() => ({ projectId: null as string | null }));
      if (cancelled) return;
      useStore.getState().setProjectList(list.map(asMeta));
      useStore.getState().setActiveProjectId(active.projectId);
      if (list.length === 0) opts.onNeedCreate?.();
    })();
    const unsubChanged = window.cth.onProjectChanged?.(() => {
      void window.cth.projectList().then((list) => {
        useStore.getState().setProjectList(list.map(asMeta));
      });
    });
    const unsubActive = window.cth.onProjectActiveChanged?.((e) => {
      useStore.getState().setActiveProjectId(e.projectId);
    });
    return () => {
      cancelled = true;
      unsubChanged?.();
      unsubActive?.();
    };
  }, [opts.ready]);

  const activate = async (projectId: string): Promise<boolean> => {
    const current = useStore.getState().activeProjectId;
    if (current === projectId) return true;
    setSwitchError(undefined);
    flushRoster();
    const res = await window.cth.projectActivate(projectId);
    if (!res.ok) {
      setSwitchError(res.code === 'RESUME_LIMIT_REACHED'
        ? 'This floor has too many agents to resume (max 5 running). Suspend another floor first.'
        : (res.error || 'Could not switch project.'));
      return false;
    }
    useStore.getState().setActiveProjectId(projectId);
    useStore.getState().loadFloorFromRoster(res.roster);
    return true;
  };

  const remove = async (projectId: string): Promise<boolean> => {
    const list = useStore.getState().projects;
    if (!canDeleteProject(list)) return false;
    flushRoster();
    const res = await window.cth.projectDelete(projectId);
    if (!res.ok) {
      setSwitchError(res.error || 'Could not delete the project.');
      return false;
    }
    const remaining = await window.cth.projectList();
    useStore.getState().setProjectList(remaining.map(asMeta));
    useStore.getState().setActiveProjectId(res.activeProjectId);
    useStore.getState().loadFloorFromRoster(res.roster);
    return true;
  };

  return { switchError, activate, remove };
}
