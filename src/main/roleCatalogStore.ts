import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertRoleDraft,
  isBuiltinRoleId,
  mergeRoleCatalog,
  type RoleDefinition,
  type RoleSource
} from '../shared/roleCatalog';

export function roleCatalogDir(harnessHome: string): string {
  return join(harnessHome, 'role-catalog');
}

function readUserRoles(home: string): RoleDefinition[] {
  const dir = roleCatalogDir(home);
  if (!existsSync(dir)) return [];
  const out: RoleDefinition[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Partial<RoleDefinition>;
      if (typeof raw.id !== 'string' || isBuiltinRoleId(raw.id)) continue;
      if (typeof raw.title !== 'string' || typeof raw.description !== 'string') continue;
      if (typeof raw.character !== 'string') continue;
      out.push({
        id: raw.id,
        title: raw.title,
        description: raw.description,
        character: raw.character as RoleDefinition['character'],
        skills: Array.isArray(raw.skills) ? raw.skills.filter((x): x is string => typeof x === 'string') : undefined,
        mcp: Array.isArray(raw.mcp) ? raw.mcp.filter((x): x is string => typeof x === 'string') : undefined,
        builtin: false,
        source: raw.source === 'ai-ui' || raw.source === 'ai-god' || raw.source === 'user' ? raw.source : 'user'
      });
    } catch { /* skip bad files */ }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function listRoles(harnessHome: string | null): RoleDefinition[] {
  const user = harnessHome ? readUserRoles(harnessHome) : [];
  return mergeRoleCatalog(user);
}

export function saveRole(
  harnessHome: string,
  draft: unknown
): { ok: true; role: RoleDefinition } | { ok: false; error: string } {
  try {
    const parsed = assertRoleDraft(draft);
    const role: RoleDefinition = {
      id: `user-${randomUUID()}`,
      title: parsed.title,
      description: parsed.description,
      character: parsed.character,
      skills: parsed.skills,
      mcp: parsed.mcp,
      builtin: false,
      source: (parsed.source || 'user') as RoleSource
    };
    const dir = roleCatalogDir(harnessHome);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${role.id}.json`), JSON.stringify(role, null, 2), 'utf8');
    return { ok: true, role };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteRole(
  harnessHome: string,
  id: string
): { ok: true } | { ok: false; error: string } {
  if (isBuiltinRoleId(id) || !id.startsWith('user-')) {
    return { ok: false, error: 'cannot delete a built-in role' };
  }
  const path = join(roleCatalogDir(harnessHome), `${id}.json`);
  if (!existsSync(path)) return { ok: false, error: 'role not found' };
  try {
    rmSync(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
