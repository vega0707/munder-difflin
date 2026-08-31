import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoleDefinition } from '@shared/roleCatalog';
import { OFFICE_CHARACTER_NAMES, type OfficeCharacterName } from '@shared/projectTypes';
import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import type { HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import { spawnFromRole } from '@/lib/spawnFromRole';

type View = 'list' | 'ai' | 'ai-preview';

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 13,
  border: 'none',
  background: 'var(--cth-cream-100)',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-200)',
  color: 'var(--cth-ink-900)',
  boxSizing: 'border-box'
};

interface Props {
  config: HarnessConfig;
  onClose: () => void;
}

export function RolePickerPanel({ config, onClose }: Props) {
  const { t } = useTranslation();
  const setAddAgentOpen = useStore((s) => s.setAddAgentOpen);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [view, setView] = useState<View>('list');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    character: string;
    skills?: string[];
    mcp?: string[];
    source?: string;
  } | null>(null);
  const [via, setVia] = useState<string | undefined>();

  const reload = () => {
    void window.cth.roleList?.().then((list) => {
      setRoles(list as RoleDefinition[]);
    }).catch(() => setRoles([]));
  };

  useEffect(() => { reload(); }, []);

  const hire = async (role: RoleDefinition) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const res = await spawnFromRole(role, config);
    setBusy(false);
    if (!res.ok) {
      setError(res.error === 'no-cwd'
        ? t('rolePicker.errNoCwd')
        : (res.error || t('rolePicker.errSpawn')));
      return;
    }
    onClose();
  };

  const openCustom = () => {
    onClose();
    setAddAgentOpen(true);
  };

  const propose = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const cwd = config.registeredRepos?.[0];
    const res = await window.cth.roleProposeFromBrief?.({ brief: brief.trim(), cwd });
    setBusy(false);
    if (!res || !res.ok) {
      setError(res && 'error' in res ? res.error : t('rolePicker.errPropose'));
      return;
    }
    setDraft(res.draft);
    setVia(res.via);
    setView('ai-preview');
  };

  const confirmAi = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(undefined);
    const saved = await window.cth.roleSave?.({
      title: draft.title,
      description: draft.description,
      character: draft.character,
      skills: draft.skills,
      mcp: draft.mcp,
      source: 'ai-ui'
    });
    if (!saved || !saved.ok) {
      setBusy(false);
      setError(saved && 'error' in saved ? saved.error : t('rolePicker.errSave'));
      return;
    }
    const res = await spawnFromRole(saved.role as RoleDefinition, config);
    setBusy(false);
    if (!res.ok) {
      setError(res.error === 'no-cwd'
        ? t('rolePicker.errNoCwd')
        : `${t('rolePicker.savedButSpawnFailed')}: ${res.error}`);
      reload();
      return;
    }
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80,
      background: 'rgba(26, 25, 30, 0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24
    }}>
      <div style={{ width: 520, maxWidth: '94vw', maxHeight: '88vh', overflow: 'auto' }}>
        <PixelPanel
          variant="dialog"
          title={view === 'list' ? t('rolePicker.title') : t('rolePicker.aiTitle')}
          noPadding
        >
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {error && (
              <div style={{ fontSize: 12, color: 'var(--cth-coral)', lineHeight: '18px' }}>{error}</div>
            )}

            {view === 'list' && (
              <>
                <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
                  {t('rolePicker.blurb')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflow: 'auto' }}>
                  {roles.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void hire(r)}
                      style={{
                        textAlign: 'left',
                        border: 'none',
                        cursor: busy ? 'wait' : 'pointer',
                        padding: '8px 10px',
                        background: 'var(--cth-cream-100)',
                        boxShadow: 'inset 0 0 0 1px var(--cth-ink-200)',
                        fontFamily: 'var(--cth-font-ui)',
                        color: 'var(--cth-ink-900)'
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--cth-ink-600)', marginTop: 2 }}>
                        {r.description}
                      </div>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <PixelButton size="sm" variant="primary" disabled={busy} onClick={() => { setView('ai'); setError(undefined); }}>
                    {t('rolePicker.aiCreate')}
                  </PixelButton>
                  <PixelButton size="sm" variant="secondary" disabled={busy} onClick={openCustom}>
                    {t('rolePicker.custom')}
                  </PixelButton>
                  <PixelButton size="sm" variant="ghost" onClick={onClose}>{t('common.cancel')}</PixelButton>
                </div>
              </>
            )}

            {view === 'ai' && (
              <>
                <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
                  {t('rolePicker.aiBlurb')}
                </p>
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder={t('rolePicker.aiPlaceholder')}
                  rows={5}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <PixelButton size="sm" variant="primary" disabled={busy || !brief.trim()} onClick={() => void propose()}>
                    {busy ? t('rolePicker.proposing') : t('rolePicker.propose')}
                  </PixelButton>
                  <PixelButton size="sm" variant="ghost" onClick={() => setView('list')}>{t('common.back')}</PixelButton>
                </div>
              </>
            )}

            {view === 'ai-preview' && draft && (
              <>
                {via === 'heuristic' && (
                  <div style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>{t('rolePicker.heuristicNote')}</div>
                )}
                <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {t('rolePicker.fieldTitle')}
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    style={inputStyle}
                  />
                </label>
                <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {t('rolePicker.fieldDescription')}
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </label>
                <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {t('rolePicker.fieldCharacter')}
                  <select
                    value={draft.character}
                    onChange={(e) => setDraft({ ...draft, character: e.target.value })}
                    style={inputStyle}
                  >
                    {OFFICE_CHARACTER_NAMES.map((c: OfficeCharacterName) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <PixelButton size="sm" variant="primary" disabled={busy} onClick={() => void confirmAi()}>
                    {busy ? t('rolePicker.spawning') : t('rolePicker.saveAndSpawn')}
                  </PixelButton>
                  <PixelButton size="sm" variant="ghost" onClick={() => setView('ai')}>{t('common.back')}</PixelButton>
                </div>
              </>
            )}
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
