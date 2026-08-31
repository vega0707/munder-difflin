import { dirname } from 'node:path';
import type { HiveManager } from './hive';
import type { CreateProjectRole, OfficeCharacterName } from '../shared/projectTypes';
import { OFFICE_CHARACTER_DISPLAY } from '../shared/projectTypes';
import { RosterStore } from './roster';
import {
  DEFAULT_AGENT_PROVIDER,
  resolveAgentProvider,
  type AgentProvider
} from '../shared/agentProvider';

export interface SeedProjectCastOpts {
  roles: CreateProjectRole[];
  cwd: string;
  /** Engine for the opening god. Extra seats always start as Built-in. */
  provider?: AgentProvider;
}

function roleTitle(role: CreateProjectRole): string {
  return role.title?.trim() || OFFICE_CHARACTER_DISPLAY[role.character];
}

function roleDescription(role: CreateProjectRole, isGod: boolean): string {
  if (role.description?.trim()) return role.description.trim();
  if (isGod) return 'god — runs the floor, triages requests, escalates only critical calls to you';
  if (role.title?.trim()) return role.title.trim();
  return OFFICE_CHARACTER_DISPLAY[role.character];
}

/**
 * Opening roster for a new project: exactly one god, plus any extra floor roles
 * the operator picked. Hive `godId` stays `god` so existing `to: 'god'` routing
 * keeps working inside this hive. Seats may exceed the live-PTY cap — extras
 * stay on the floor without a PTY (划水) until a global slot frees.
 */
export async function seedProjectCast(hive: HiveManager, opts: SeedProjectCastOpts): Promise<void> {
  const cwd = opts.cwd;
  const godProvider = resolveAgentProvider(opts.provider);
  const godRole = opts.roles.find((r) => r.asGod);
  if (!godRole) throw new Error('seedProjectCast: roles must include a god');
  const workers = opts.roles.filter((r) => r.character !== godRole.character);

  await hive.ensureAgent({
    id: 'god',
    name: OFFICE_CHARACTER_DISPLAY[godRole.character],
    cwd,
    isGod: true,
    role: roleTitle(godRole),
    provider: godProvider,
    skills: godRole.skills,
    mcp: godRole.mcp
  });
  for (const role of workers) {
    await hive.ensureAgent({
      id: role.character,
      name: OFFICE_CHARACTER_DISPLAY[role.character],
      cwd,
      isGod: false,
      role: roleTitle(role),
      provider: DEFAULT_AGENT_PROVIDER,
      skills: role.skills,
      mcp: role.mcp
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
        name: OFFICE_CHARACTER_DISPLAY[godRole.character],
        character: godRole.character,
        accent: 'lemon',
        description: roleDescription(godRole, true),
        project: 'hive',
        tmuxTarget: '',
        cwd,
        status: 'idle',
        action: 'running the floor',
        progress: 0,
        isGod: true
      },
      ...workers.map((role) => ({
        id: role.character,
        name: OFFICE_CHARACTER_DISPLAY[role.character],
        character: role.character as OfficeCharacterName,
        accent: 'mint' as const,
        description: roleDescription(role, false),
        project: 'hive',
        tmuxTarget: '',
        cwd,
        status: 'idle' as const,
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
