/** One-click spawn from a RoleDefinition using active project + default engine. */

import { agentPtyId } from '@shared/projectTypes';
import type { RoleDefinition } from '@shared/roleCatalog';
import { OFFICE_CAST, DEFAULT_CHARACTER, type OfficeCharacterName } from '@/scene/office/cast';
import {
  buildSpawnCommand,
  inferAgentProvider,
  tokenizeCommand,
  type HarnessConfig
} from '@/store/config';
import { useStore, type Agent } from '@/store/store';
import type { AccentColorName } from '@/design/tokens';

const ACCENTS: AccentColorName[] = [
  'mint', 'sky', 'lemon', 'peach', 'lilac', 'coral'
];

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function uniqueId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  const existing = new Set(useStore.getState().agents.map((a) => a.id));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function resolveCharacter(role: RoleDefinition): OfficeCharacterName {
  const hit = OFFICE_CAST.find((c) => c.name === role.character);
  return hit ? hit.name : DEFAULT_CHARACTER;
}

function resolveCwd(config: HarnessConfig): string | undefined {
  const projectId = useStore.getState().activeProjectId;
  const project = useStore.getState().projects.find((p) => p.projectId === projectId);
  const fromProject = project?.defaultCwd?.trim();
  if (fromProject) return fromProject;
  const repos = config.registeredRepos ?? [];
  return repos[0]?.trim() || undefined;
}

export type SpawnFromRoleResult =
  | { ok: true; agentId: string; limited?: boolean }
  | { ok: false; error: string; code?: string };

export async function spawnFromRole(
  role: RoleDefinition,
  config: HarnessConfig
): Promise<SpawnFromRoleResult> {
  const cwd = resolveCwd(config);
  if (!cwd) {
    return { ok: false, error: 'no-cwd' };
  }
  const projectId = useStore.getState().activeProjectId ?? 'default';
  const character = resolveCharacter(role);
  const cast = OFFICE_CAST.find((c) => c.name === character);
  const name = cast?.displayName || role.title;
  const id = uniqueId(role.title || name);
  const ptyId = agentPtyId(projectId, id);
  const provider = inferAgentProvider(config.defaultCommand);
  const model = config.defaultModel;
  const command = buildSpawnCommand(config, model, provider);
  const [exe, ...args] = tokenizeCommand(command.trim());
  const accent = ACCENTS[Math.abs(hash(id)) % ACCENTS.length];

  const spawnRes = await window.cth.spawnPty({
    id: ptyId,
    cwd,
    command: exe,
    provider,
    args,
    cols: 100,
    rows: 30,
    projectId,
    hive: {
      id,
      name,
      provider,
      cwd,
      role: role.title || role.description
    }
  });

  if (!spawnRes.ok) {
    const code = (spawnRes as { code?: string }).code;
    // Cap reached: still seat the agent without a live PTY (划水).
    if (code === 'SPAWN_LIMIT_REACHED') {
      const agent: Agent = {
        id,
        name,
        character,
        accent,
        description: role.description || role.title,
        project: basename(cwd),
        tmuxTarget: '',
        cwd,
        status: 'idle',
        action: '划水',
        progress: 0,
        currentStation: 'desk',
        command: command.trim(),
        provider,
        model,
        recentTextTs: Date.now()
      };
      useStore.getState().addAgent(agent);
      return { ok: true, agentId: id, limited: true };
    }
    return { ok: false, error: spawnRes.error ?? 'spawn failed', code };
  }

  const spawnedCwd = spawnRes.cwd || cwd;
  const agent: Agent = {
    id,
    name,
    character,
    accent,
    description: role.description || role.title,
    project: basename(spawnedCwd),
    tmuxTarget: '',
    cwd: spawnedCwd,
    status: 'idle',
    action: 'starting up',
    progress: 0,
    currentStation: 'desk',
    ptyId: spawnRes.builtin ? undefined : ptyId,
    command: command.trim(),
    provider,
    model,
    worktreePath: spawnRes.worktreePath,
    seedPrompt: spawnRes.seedPrompt,
    recentTextTs: Date.now()
  };
  useStore.getState().addAgent(agent);
  return { ok: true, agentId: id };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
