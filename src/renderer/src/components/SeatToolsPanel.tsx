import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUNDLED_SKILL_IDS } from '@shared/bundledSkills';
import { MCP_CATALOG } from '@shared/mcpCatalog';
import { PixelButton } from './PixelButton';

const BUNDLED_SKILL_HINTS = [...BUNDLED_SKILL_IDS];

export interface SeatToolsPanelProps {
  agentId: string;
}

/**
 * Per-seat skill + MCP allowlists. Empty = inherit floor defaults.
 * Saved to hive registry; applied on the next spawn of this seat.
 */
export function SeatToolsPanel({ agentId }: SeatToolsPanelProps) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<string[] | null>(null);
  const [mcp, setMcp] = useState<string[] | null>(null);
  const [inheritSkills, setInheritSkills] = useState(true);
  const [inheritMcp, setInheritMcp] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const reg = await window.cth.hiveRegistry() as {
          agents?: Record<string, { skills?: string[]; mcp?: string[] }>
        } | null;
        if (cancelled) return;
        const agent = reg?.agents?.[agentId];
        if (agent?.skills) {
          setInheritSkills(false);
          setSkills([...agent.skills]);
        } else {
          setInheritSkills(true);
          setSkills([]);
        }
        if (agent?.mcp) {
          setInheritMcp(false);
          setMcp([...agent.mcp]);
        } else {
          setInheritMcp(true);
          setMcp([]);
        }
      } catch {
        if (!cancelled) setNote(t('seatTools.loadFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, t]);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const save = async (): Promise<void> => {
    setBusy(true);
    setNote('');
    try {
      const res = await window.cth.hivePatchAgentTools(agentId, {
        skills: inheritSkills ? null : (skills ?? []),
        mcp: inheritMcp ? null : (mcp ?? [])
      });
      if (!res.ok) {
        setNote(res.error || t('seatTools.saveFailed'));
        return;
      }
      setNote(t('seatTools.saved'));
    } catch (e) {
      setNote(e instanceof Error ? e.message : t('seatTools.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
      <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
        {t('seatTools.blurb')}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={inheritSkills}
          onChange={(e) => setInheritSkills(e.target.checked)}
        />
        {t('seatTools.inheritSkills')}
      </label>
      {!inheritSkills && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {BUNDLED_SKILL_HINTS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSkills((prev) => toggle(prev ?? [], id))}
              style={{
                fontSize: 11, padding: '2px 8px', border: 'none', cursor: 'pointer',
                background: (skills ?? []).includes(id) ? 'var(--cth-mint-light)' : 'var(--cth-paper-100)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                color: 'var(--cth-ink-900)'
              }}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={inheritMcp}
          onChange={(e) => setInheritMcp(e.target.checked)}
        />
        {t('seatTools.inheritMcp')}
      </label>
      {!inheritMcp && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {MCP_CATALOG.map((e) => (
            <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={(mcp ?? []).includes(e.id)}
                onChange={() => setMcp((prev) => toggle(prev ?? [], e.id))}
              />
              <span>{e.label}</span>
              <span style={{ color: 'var(--cth-ink-500)' }}>({e.id})</span>
            </label>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PixelButton variant="primary" size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? t('seatTools.saving') : t('seatTools.save')}
        </PixelButton>
        {note && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>}
      </div>
    </div>
  );
}
