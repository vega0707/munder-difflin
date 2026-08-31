import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { OFFICE_CAST } from '@/scene/office/cast';
import {
  assignCreateProjectGod,
  canSubmitCreateProject,
  toggleCreateRole,
  type CreateProjectRole,
  type OfficeCharacterName
} from '@shared/projectTypes';
import {
  BUILTIN_PROJECT_TEMPLATES,
  CUSTOM_TEMPLATE_ID,
  rolesFromTemplate,
  type ProjectTemplate
} from '@shared/projectTemplates';
import { useStore } from '@/store/store';

export interface ProjectCreateDialogProps {
  onClose: () => void;
  onCreated?: (projectId: string) => void;
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 13,
  color: 'var(--cth-ink-900)',
  background: 'var(--cth-cream-50)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-200)'
};

export function ProjectCreateDialog({ onClose, onCreated }: ProjectCreateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [roles, setRoles] = useState<CreateProjectRole[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [templates, setTemplates] = useState<ProjectTemplate[]>(BUILTIN_PROJECT_TEMPLATES);
  const [templateId, setTemplateId] = useState(CUSTOM_TEMPLATE_ID);
  const [saveName, setSaveName] = useState('');

  useEffect(() => {
    void window.cth.projectListTemplates?.().then((list) => {
      setTemplates(list as ProjectTemplate[]);
    }).catch(() => setTemplates([]));
  }, []);

  const ready = name.trim().length > 0 && canSubmitCreateProject(roles);
  const god = roles.find((r) => r.asGod);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tmpl = templates.find((x) => x.id === id);
    if (!tmpl) return;
    setRoles(rolesFromTemplate(tmpl));
    setError(undefined);
  };

  const pick = (character: OfficeCharacterName) => {
    setRoles((prev) => toggleCreateRole(prev, character));
    setError(undefined);
  };

  const makeGod = (character: OfficeCharacterName) => {
    setRoles((prev) => assignCreateProjectGod(prev, character));
  };

  const browse = async () => {
    const res = await window.cth.chooseFolder();
    if (res.ok) setCwd(res.path);
  };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await window.cth.projectCreate({
        name: name.trim(),
        defaultCwd: cwd.trim() || undefined,
        roles
      });
      if (!res.ok) {
        setError(res.code === 'GOD_REQUIRED'
          ? t('projects.godRequired')
          : (res.error || t('projects.createFailed')));
        setBusy(false);
        return;
      }
      onCreated?.(res.project.projectId);
      useStore.getState().setActiveProjectId(res.project.projectId);
      if ('roster' in res) useStore.getState().loadFloorFromRoster(res.roster);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80,
      background: 'rgba(26, 25, 30, 0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24
    }}>
      <div style={{ width: 560, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto' }}>
        <PixelPanel variant="dialog" title={t('projects.createTitle')} noPadding>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
              {t('projects.createBlurb')}
            </p>

            {templates.length > 0 && (
              <div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Floor template</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {templates.map((t) => {
                    const active = templateId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        title={t.blurb}
                        onClick={() => applyTemplate(t.id)}
                        style={{
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          fontSize: 12,
                          fontFamily: 'var(--cth-font-ui)',
                          color: 'var(--cth-ink-900)',
                          background: active ? 'var(--cth-lemon-light)' : 'var(--cth-cream-100)',
                          boxShadow: active
                            ? 'inset 0 0 0 1.5px var(--cth-ink-900)'
                            : 'inset 0 0 0 1px var(--cth-ink-200)'
                        }}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t('projects.nameLabel')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('projects.namePlaceholder')}
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t('projects.cwdLabel')}
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={t('projects.cwdPlaceholder')} style={inputStyle} />
                <PixelButton size="sm" onClick={() => void browse()}>{t('projects.browse')}</PixelButton>
              </div>
            </label>

            <div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                {t('projects.castLabel')}
                {god
                  ? t('projects.castGod', { name: OFFICE_CAST.find((c) => c.name === god.character)?.displayName })
                  : t('projects.castNoGod')}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {OFFICE_CAST.map((c) => {
                  const selected = roles.find((r) => r.character === c.name);
                  const isGod = !!selected?.asGod;
                  return (
                    <div key={c.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <button
                        onClick={() => pick(c.name)}
                        title={c.blurb}
                        style={{
                          padding: 4,
                          background: isGod
                            ? 'var(--cth-lemon-light)'
                            : selected
                              ? 'var(--cth-mint-light)'
                              : 'var(--cth-cream-100)',
                          boxShadow: isGod
                            ? 'inset 0 0 0 2px var(--cth-ink-900)'
                            : selected
                              ? 'inset 0 0 0 1.5px var(--cth-ink-500)'
                              : 'inset 0 0 0 1px var(--cth-ink-100)',
                          cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                          border: 'none', width: 56
                        }}
                      >
                        <div style={{
                          width: 44, height: 56, display: 'flex',
                          alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden'
                        }}>
                          <SpritePortrait character={c.name} scale={2} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>{c.displayName}</span>
                      </button>
                      {selected && !isGod && (
                        <button
                          onClick={() => makeGod(c.name)}
                          style={{
                            border: 'none', background: 'transparent', cursor: 'pointer',
                            fontSize: 10, color: 'var(--cth-ink-500)', padding: 0
                          }}
                        >
                          {t('projects.makeGod')}
                        </button>
                      )}
                      {isGod && (
                        <span style={{ fontSize: 10, color: 'var(--cth-ink-900)' }}>{t('projects.godBadge')}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {error && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--cth-coral-700)' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('projects.saveTemplatePlaceholder')}
                style={{ ...inputStyle, flex: 1 }}
                disabled={!canSubmitCreateProject(roles)}
              />
              <PixelButton
                size="sm"
                disabled={!saveName.trim() || !canSubmitCreateProject(roles) || busy}
                onClick={() => {
                  void (async () => {
                    const res = await window.cth.projectSaveTemplate({
                      name: saveName.trim(),
                      roles
                    });
                    if (!res.ok) { setError(res.error); return; }
                    setTemplates((prev) => [...prev, res.template as ProjectTemplate]);
                    setSaveName('');
                  })();
                }}
              >
                Save template
              </PixelButton>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <PixelButton onClick={onClose} disabled={busy}>{t('common.cancel')}</PixelButton>
              <PixelButton variant="primary" onClick={() => void submit()} disabled={!ready || busy}>
                {busy ? t('projects.creating') : t('projects.create')}
              </PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
