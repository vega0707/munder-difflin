import {
  ClipboardEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react';
import { isComposingKey } from '@shared/imeGuard';
import { segmentForHighlight, skillNameSet } from '@shared/slashSkillMenu';
import { useSlashSkillMenu } from '@/hooks/useSlashSkillMenu';
import { SlashSkillMenu } from './SlashSkillMenu';

export interface SkillComposerInputProps {
  agentCwd: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  dir?: 'auto';
  rows?: number;
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
}

export function SkillComposerInput({
  agentCwd,
  value,
  onChange,
  onKeyDown,
  onPaste,
  dir,
  rows = 5,
  placeholder,
  style,
  className
}: SkillComposerInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [menuSuppressed, setMenuSuppressed] = useState(false);
  const [skillNames, setSkillNames] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setMenuSuppressed(false);
  }, [value, caret]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await window.cth.skillsLocal(agentCwd);
        if (!cancelled) {
          setSkillNames(skillNameSet(all.filter((s) => s.provider === 'claude').map((s) => s.name)));
        }
      } catch {
        if (!cancelled) setSkillNames(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [agentCwd]);

  const syncCaret = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) setCaret(ta.selectionStart ?? value.length);
  }, [value.length]);

  const menu = useSlashSkillMenu({
    text: value,
    setText: onChange,
    textareaRef,
    agentCwd,
    caret
  });

  const segments = useMemo(() => segmentForHighlight(value, skillNames), [value, skillNames]);

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta && mirror) mirror.scrollTop = ta.scrollTop;
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKey(e)) return;

    if (menu.open && !menuSuppressed) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        menu.onHighlightChange(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        menu.onHighlightChange(-1);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuSuppressed(true);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        menu.selectHighlighted();
        syncCaret();
        return;
      }
    }

    onKeyDown?.(e);
    queueMicrotask(syncCaret);
  };

  const shellStyle: CSSProperties = {
    position: 'relative',
    width: '100%'
  };

  const sharedTextStyle: CSSProperties = {
    width: '100%',
    resize: 'vertical',
    padding: '6px 8px',
    border: 'none',
    fontFamily: style?.fontFamily,
    fontSize: style?.fontSize,
    lineHeight: style?.lineHeight,
    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    overflowWrap: 'break-word'
  };

  return (
    <>
      <div style={shellStyle}>
        <div
          ref={mirrorRef}
          aria-hidden
          style={{
            ...sharedTextStyle,
            position: 'absolute',
            inset: 0,
            margin: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            minHeight: style?.minHeight,
            maxHeight: style?.maxHeight,
            background: style?.background ?? 'var(--cth-paper-100)',
            color: 'var(--cth-ink-900)'
          }}
        >
          {segments.map((seg, i) => (
            <span
              key={i}
              style={seg.kind === 'skill' ? { color: 'var(--cth-coral)' } : undefined}
            >{seg.text}</span>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          dir={dir}
          className={className}
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onScroll={syncScroll}
          onPaste={onPaste}
          style={{
            ...style,
            ...sharedTextStyle,
            position: 'relative',
            zIndex: 1,
            background: 'transparent',
            color: 'transparent',
            caretColor: 'var(--cth-ink-900)',
            WebkitTextFillColor: 'transparent'
          }}
        />
      </div>
      <SlashSkillMenu
        open={menu.open && !menuSuppressed}
        anchorRef={textareaRef}
        skills={menu.menuSkills}
        highlight={menu.highlight}
        onHighlight={menu.setHighlight}
        onSelect={menu.selectIndex}
        totalFiltered={menu.filteredCount}
      />
    </>
  );
}
