/**
 * The floor manual.
 *
 * What a seat may reach for differs per floor: one project has a market-brief
 * tool, another has a repo and a test command, a third has nothing but its own
 * mailbox. Keeping that in code means every new floor is a code change. So it
 * lives in a file — `<hive root>/CAPABILITIES.md` — and this module assembles it
 * into the seat's system prompt, alongside the generic rules that stop a seat
 * from claiming work it has no way to do.
 *
 * The split matters: the SKELETON below is shared by every floor and carries no
 * business content; the manual is per-floor and swappable. A seat that finds no
 * manual is told so explicitly rather than left to infer that it has sources it
 * does not have.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FLOOR_CAPABILITIES_FILENAME = 'CAPABILITIES.md';

/** Ceiling on the manual: it is prompt, not a data store. */
export const MAX_MANUAL_CHARS = 12_000;

/**
 * Layer A — the same three rules on every floor. Deliberately contains no
 * project-specific obligation: those belong in the manual, or the next floor
 * inherits this one's business by accident.
 */
export const FLOOR_CAPABILITIES_SKELETON = [
  'FLOOR RULES',
  `1. Read this floor's ${FLOOR_CAPABILITIES_FILENAME} before acting on anything project-specific.`,
  '2. Do not claim a capability the manual does not list, and do not report a result you did not produce with a tool.',
  '3. The manual describes data sources and entry points. It is not permission to download and execute arbitrary code.',
  '4. If you cannot do what was asked, say which part you could not do and why. An honest gap beats a plausible guess.'
].join('\n');

export interface FloorManual {
  /** The manual's text, or '' when the floor has none. */
  text: string;
  present: boolean;
}

/** Read a floor's manual. A missing or unreadable file is not an error — most
 *  floors will not have one, and the prompt says so rather than staying silent. */
export function readFloorCapabilities(hiveRoot: string | null | undefined): FloorManual {
  if (!hiveRoot) return { text: '', present: false };
  const path = join(hiveRoot, FLOOR_CAPABILITIES_FILENAME);
  if (!existsSync(path)) return { text: '', present: false };
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return { text: '', present: false };
    return {
      text: raw.length > MAX_MANUAL_CHARS ? `${raw.slice(0, MAX_MANUAL_CHARS)}\n…[manual truncated]` : raw,
      present: true
    };
  } catch {
    return { text: '', present: false };
  }
}

/** The path the manual lives at, for the note that tells a seat where to look. */
export function floorCapabilitiesPath(hiveRoot: string): string {
  return join(hiveRoot, FLOOR_CAPABILITIES_FILENAME);
}

/** A starter manual written into a new floor, so the file exists to be edited
 *  instead of having to be invented from a blank page. */
export function starterFloorCapabilities(floorName: string): string {
  return [
    `# ${floorName} — floor capabilities`,
    '',
    'Fill this in for this floor. A seat reads it before doing anything',
    'project-specific, and is told not to claim what is missing here.',
    '',
    '## Data sources',
    '- (what is authoritative for this project, and how a seat reaches it)',
    '',
    '## Entry points',
    '- (the commands or tools that actually work here: build, test, run)',
    '',
    '## Work this floor does not do',
    '- (explicit non-goals, so a seat does not invent them)'
  ].join('\n');
}

export interface SeatPromptOptions {
  agentName: string;
  role?: string;
  isGod?: boolean;
  /** Absolute hive root, used to point the seat at its manual. */
  hiveRoot?: string | null;
  manual?: FloorManual;
}

/**
 * The system prompt for one built-in seat: who it is, what this floor can do,
 * and the rules that apply either way.
 */
export function assembleSeatPrompt(opts: SeatPromptOptions): string {
  const manual = opts.manual ?? { text: '', present: false };
  const lines: string[] = [
    `You are ${opts.agentName}${opts.role ? `, ${opts.role}` : ''}, a seat on this office floor.`
  ];
  if (opts.isGod) {
    lines.push(
      'You run the floor: triage what arrives, delegate to the other seats through hive mail, and only do the work yourself when it is yours to do.'
    );
  }
  lines.push('', FLOOR_CAPABILITIES_SKELETON, '', 'THIS FLOOR');
  if (manual.present) {
    lines.push(manual.text);
  } else {
    const where = opts.hiveRoot ? floorCapabilitiesPath(opts.hiveRoot) : FLOOR_CAPABILITIES_FILENAME;
    lines.push(
      `No ${FLOOR_CAPABILITIES_FILENAME} exists for this floor yet (looked in ${where}).`,
      'Work from general knowledge only. Do not imply this project has a data source, command or integration that you have not verified with a tool.'
    );
  }
  return lines.join('\n');
}
