import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BUILTIN_PROJECT_TEMPLATES,
  isBuiltinTemplateId,
  mergeTemplates,
  parseUserTemplateDraft,
  type ProjectTemplate,
  type UserTemplateDraft
} from '../shared/projectTemplates';

export function templatesDir(harnessHome: string): string {
  return join(harnessHome, 'project-templates');
}

function readUserTemplates(home: string): ProjectTemplate[] {
  const dir = templatesDir(home);
  if (!existsSync(dir)) return [];
  const out: ProjectTemplate[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Partial<ProjectTemplate>;
      if (typeof raw.id !== 'string' || isBuiltinTemplateId(raw.id)) continue;
      if (typeof raw.name !== 'string' || !Array.isArray(raw.roles)) continue;
      out.push({
        id: raw.id,
        name: raw.name,
        blurb: typeof raw.blurb === 'string' ? raw.blurb : '',
        roles: raw.roles,
        builtin: false
      });
    } catch { /* skip bad files */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listProjectTemplates(harnessHome: string | null): ProjectTemplate[] {
  const user = harnessHome ? readUserTemplates(harnessHome) : [];
  return mergeTemplates(user);
}

export function saveProjectTemplate(
  harnessHome: string,
  draft: UserTemplateDraft
): { ok: true; template: ProjectTemplate } | { ok: false; error: string } {
  try {
    const parsed = parseUserTemplateDraft(draft);
    const template: ProjectTemplate = {
      id: `user-${randomUUID()}`,
      name: parsed.name,
      blurb: parsed.blurb,
      roles: parsed.roles,
      builtin: false
    };
    const dir = templatesDir(harnessHome);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${template.id}.json`), JSON.stringify(template, null, 2), 'utf8');
    return { ok: true, template };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteProjectTemplate(
  harnessHome: string,
  id: string
): { ok: true } | { ok: false; error: string } {
  if (isBuiltinTemplateId(id) || !id.startsWith('user-')) {
    return { ok: false, error: 'cannot delete a built-in template' };
  }
  const path = join(templatesDir(harnessHome), `${id}.json`);
  if (!existsSync(path)) return { ok: false, error: 'template not found' };
  try {
    rmSync(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
