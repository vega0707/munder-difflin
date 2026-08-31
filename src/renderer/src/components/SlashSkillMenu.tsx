import { createPortal } from 'react-dom';
import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalSkill } from '../../../preload';

const MENU_MAX_H = 280;
const MENU_W = 420;

export interface SlashSkillMenuProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  skills: LocalSkill[];
  highlight: number;
  onHighlight: (index: number) => void;
  onSelect: (index: number) => void;
  totalFiltered: number;
}

const SCOPE_KEY: Record<LocalSkill['scope'], string> = {
  bundled: 'slashMenu.scopeBundled',
  user: 'slashMenu.scopeUser',
  project: 'slashMenu.scopeProject'
};

export function SlashSkillMenu({
  open,
  anchorRef,
  skills,
  highlight,
  onHighlight,
  onSelect,
  totalFiltered
}: SlashSkillMenuProps) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, r.left),
      top: Math.max(8, r.top - MENU_MAX_H - 6)
    });
  }, [open, anchorRef, skills.length]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      role="listbox"
      aria-label={t('queueComposer.slashMenu.label')}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: Math.min(MENU_W, window.innerWidth - 16),
        maxHeight: MENU_MAX_H,
        overflowY: 'auto',
        zIndex: 450,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 6,
        boxSizing: 'border-box',
        background: 'var(--cth-paper-100)',
        boxShadow: 'inset 0 0 0 1.5px var(--cth-ink-500), 4px 4px 0 rgba(26,19,32,0.25)'
      }}
    >
      <span style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 9, letterSpacing: 0.5,
        textTransform: 'uppercase', color: 'var(--cth-ink-500)', padding: '2px 4px'
      }}>{t('queueComposer.slashMenu.heading')}</span>

      {skills.length === 0 ? (
        <span style={{
          fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
          color: 'var(--cth-ink-500)', padding: '6px 4px'
        }}>{t('queueComposer.slashMenu.empty')}</span>
      ) : skills.map((skill, i) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-selected={i === highlight}
          onMouseEnter={() => onHighlight(i)}
          onClick={() => onSelect(i)}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2,
            width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left',
            padding: '4px 6px',
            background: i === highlight ? 'var(--cth-cream-200)' : 'transparent',
            boxShadow: i === highlight ? 'inset 0 0 0 1px var(--cth-ink-300)' : 'none'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{
              fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
              color: 'var(--cth-coral)', flexShrink: 0
            }}>/{skill.name}</span>
            <span style={{
              fontSize: 9, fontFamily: 'var(--cth-font-display)', letterSpacing: 0.4,
              padding: '1px 5px', flexShrink: 0, textTransform: 'uppercase',
              color: 'var(--cth-ink-900)', background: 'var(--cth-cream-200)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
            }}>{t(SCOPE_KEY[skill.scope])}</span>
          </span>
          {skill.description && (
            <span style={{
              fontFamily: 'var(--cth-font-ui)', fontSize: 11, lineHeight: '14px',
              color: 'var(--cth-ink-700)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>{skill.description}</span>
          )}
        </button>
      ))}

      {totalFiltered > skills.length && (
        <span style={{
          fontFamily: 'var(--cth-font-ui)', fontSize: 10, color: 'var(--cth-ink-500)',
          padding: '2px 4px'
        }}>{t('queueComposer.slashMenu.more', { count: totalFiltered - skills.length })}</span>
      )}
    </div>,
    document.body
  );
}
