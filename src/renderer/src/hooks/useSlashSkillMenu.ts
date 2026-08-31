import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { LocalSkill } from '../../../preload';
import {
  detectSlashQuery,
  filterSkills,
  insertSkillToken
} from '@shared/slashSkillMenu';

const MAX_VISIBLE = 8;

export function useSlashSkillMenu(opts: {
  text: string;
  setText: (t: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  agentCwd: string;
  caret: number;
}) {
  const { text, setText, textareaRef, agentCwd, caret } = opts;
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await window.cth.skillsLocal(agentCwd);
        if (!cancelled) {
          setSkills(all.filter((s) => s.provider === 'claude'));
        }
      } catch {
        if (!cancelled) setSkills([]);
      }
    })();
    return () => { cancelled = true; };
  }, [agentCwd]);

  const slash = useMemo(() => detectSlashQuery(text, caret), [text, caret]);
  const filtered = useMemo(
    () => (slash ? filterSkills(skills, slash.query) : []),
    [skills, slash]
  );
  const open = slash !== null;

  useEffect(() => {
    setHighlight(0);
  }, [slash?.start, slash?.end, slash?.query]);

  const selectIndex = useCallback(
    (index: number) => {
      if (!slash || !filtered[index]) return false;
      const { text: next, caret: nextCaret } = insertSkillToken(
        text,
        slash,
        filtered[index]!.name
      );
      setText(next);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(nextCaret, nextCaret);
      });
      return true;
    },
    [filtered, setText, slash, text, textareaRef]
  );

  const selectHighlighted = useCallback(() => selectIndex(highlight), [highlight, selectIndex]);

  const onHighlightChange = useCallback((delta: number) => {
    if (!filtered.length) return;
    setHighlight((h) => (h + delta + filtered.length) % filtered.length);
  }, [filtered.length]);

  const menuSkills = filtered.slice(0, MAX_VISIBLE);

  return {
    open,
    slash,
    menuSkills,
    filteredCount: filtered.length,
    highlight,
    setHighlight,
    selectIndex,
    selectHighlighted,
    onHighlightChange,
    anchorRef: textareaRef
  };
}
