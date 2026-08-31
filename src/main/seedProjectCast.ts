import { dirname } from 'node:path';
import type { HiveManager } from './hive';
import type { OfficeCharacterName } from '../shared/projectTypes';
import { OFFICE_CHARACTER_DISPLAY } from '../shared/projectTypes';
import { RosterStore } from './roster';
import {
  DEFAULT_AGENT_PROVIDER,
  resolveAgentProvider,
  type AgentProvider
} from '../shared/agentProvider';

export interface SeedProjectCastOpts {
  godCharacter: OfficeCharacterName;
  godName: string;
  extraCharacters: OfficeCharacterName[];
  cwd: string;
  /** Engine for the opening god. Extra seats always start as Built-in. */
  provider?: AgentProvider;
}

/**
 * Opening roster for a new project: exactly one god, plus any extra floor roles
 * the operator picked. Hive `godId` stays `god` so existing `to: 'god'` routing
 * keeps working inside this hive.
 */
export async function seedProjectCast(hive: HiveManager, opts: SeedProjectCastOpts): Promise<void> {
  const cwd = opts.cwd;
  const godProvider = resolveAgentProvider(opts.provider);
  await hive.ensureAgent({
    id: 'god',
    name: opts.godName,
    cwd,
    isGod: true,
    role: 'orchestrator (god)',
    provider: godProvider
  });
  for (const character of opts.extraCharacters) {
    await hive.ensureAgent({
      id: character,
      name: OFFICE_CHARACTER_DISPLAY[character],
      cwd,
      isGod: false,
      role: OFFICE_CHARACTER_DISPLAY[character],
      provider: DEFAULT_AGENT_PROVIDER
    });
  }

  const hiveRoot = hive.root();
  if (!hiveRoot) return;
  const projectRoot = dirname(hiveRoot);
  const roster = new RosterStore(() => projectRoot);
  roster.write({
    version: 1,
    savedAt: new Date().toISOString(),
    agents: [
      {
        id: 'god',
        name: opts.godName,
        character: opts.godCharacter,
        accent: 'lemon',
        description: 'god — runs the floor, triages requests, escalates only critical calls to you',
        project: 'hive',
        tmuxTarget: '',
        cwd,
        status: 'idle',
        action: 'running the floor',
        progress: 0,
        isGod: true
      },
      ...opts.extraCharacters.map((character) => ({
        id: character,
        name: OFFICE_CHARACTER_DISPLAY[character],
        character,
        accent: 'mint',
        description: OFFICE_CHARACTER_DISPLAY[character],
        project: 'hive',
        tmuxTarget: '',
        cwd,
        status: 'idle',
        action: '',
        progress: 0,
        isGod: false
      }))
    ],
    archived: [],
    restorable: [],
    queues: {},
    selectedId: 'god'
  });
}
