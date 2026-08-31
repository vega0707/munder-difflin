/** Pure helpers for the composer slash-skill picker (程小帮 / Cursor-style). */

export interface SlashQuery {
  /** Index of `/` in the draft. */
  start: number;
  /** Caret index (exclusive end of the partial token). */
  end: number;
  /** Characters after `/`, lowercased for filtering. */
  query: string;
}

export type HighlightSegment = { kind: 'plain' | 'skill'; text: string };

/** True when `caret` sits inside a `/partial` token at line/word boundary. */
export function detectSlashQuery(text: string, caret: number): SlashQuery | null {
  if (caret <= 0 || caret > text.length) return null;
  let i = caret - 1;
  while (i >= 0 && /[a-zA-Z0-9_-]/.test(text[i]!)) i--;
  if (i < 0 || text[i] !== '/') return null;
  if (i > 0 && !/[\s\n]/.test(text[i - 1]!)) return null;
  return { start: i, end: caret, query: text.slice(i + 1, caret) };
}

export function filterSkills<T extends { name: string; description: string }>(
  skills: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...skills];
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
  );
}

export function insertSkillToken(
  text: string,
  range: Pick<SlashQuery, 'start' | 'end'>,
  skillName: string
): { text: string; caret: number } {
  const insert = `/${skillName} `;
  return {
    text: text.slice(0, range.start) + insert + text.slice(range.end),
    caret: range.start + insert.length
  };
}

/** Split draft text into plain vs highlighted skill tokens. */
export function segmentForHighlight(text: string, skillNames: ReadonlySet<string>): HighlightSegment[] {
  if (!text) return [{ kind: 'plain', text: '' }];
  const out: HighlightSegment[] = [];
  const re = /(^|[\s\n])(\/([a-zA-Z0-9_-]+))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    const prefix = m[1] ?? '';
    const token = m[2] ?? '';
    const name = m[3] ?? '';
    if (idx > last) out.push({ kind: 'plain', text: text.slice(last, idx) });
    if (prefix) out.push({ kind: 'plain', text: prefix });
    out.push({
      kind: skillNames.has(name.toLowerCase()) ? 'skill' : 'plain',
      text: token
    });
    last = idx + prefix.length + token.length;
  }
  if (last < text.length) out.push({ kind: 'plain', text: text.slice(last) });
  return out.length ? out : [{ kind: 'plain', text }];
}

export function skillNameSet(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.map((n) => n.toLowerCase()));
}
