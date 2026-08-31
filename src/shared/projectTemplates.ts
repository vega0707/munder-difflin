/** Built-in opening-floor templates for new projects. */

import {
  assertCreateProjectRoles,
  assertProjectName,
  type CreateProjectRole,
  type OfficeCharacterName
} from './projectTypes';
import {
  BUILTIN_ROLES,
  expandTemplateRoles,
  type ProjectTemplateRole
} from './roleCatalog';

export interface ProjectTemplate {
  id: string;
  name: string;
  blurb: string;
  /** Prefer `{ roleId }` refs; legacy inline CreateProjectRole still supported. */
  roles: ProjectTemplateRole[];
  /** Built-in templates cannot be deleted. */
  builtin: boolean;
}

export const CUSTOM_TEMPLATE_ID = 'custom';

export const BUILTIN_PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: CUSTOM_TEMPLATE_ID,
    name: 'Custom',
    blurb: 'Pick the cast yourself. Still needs exactly one god.',
    roles: [],
    builtin: true
  },
  {
    id: 'solo',
    name: 'Solo',
    blurb: 'One god, no workers. A quiet floor.',
    roles: [{ roleId: 'boss-solo', asGod: true }],
    builtin: true
  },
  {
    id: 'fullstack-squad',
    name: 'Full-stack squad',
    blurb: 'Tech lead plus FE, BE, and QA — a tight shipping crew.',
    roles: [
      { roleId: 'tech-lead', asGod: true },
      { roleId: 'frontend' },
      { roleId: 'backend' },
      { roleId: 'qa' }
    ],
    builtin: true
  },
  {
    id: 'product-rd',
    name: 'Product R&D',
    blurb: 'iClaw-style product crew: PM lead, architect, eng, QA, ops.',
    roles: [
      { roleId: 'pm', asGod: true },
      { roleId: 'architect' },
      { roleId: 'engineer' },
      { roleId: 'fullstack-qa' },
      { roleId: 'ops' }
    ],
    builtin: true
  },
  {
    id: 'fe-be-split',
    name: 'Front / back split',
    blurb: 'Tech lead with frontend, backend, QA, and DevOps.',
    roles: [
      { roleId: 'tech-lead-split', asGod: true },
      { roleId: 'frontend-pam' },
      { roleId: 'backend-dwight' },
      { roleId: 'qa-creed' },
      { roleId: 'devops' }
    ],
    builtin: true
  },
  {
    id: 'accounting',
    name: 'Accounting',
    blurb: 'Angela runs the floor. Oscar and Kevin keep the books.',
    roles: [
      { roleId: 'head-accounting', asGod: true },
      { roleId: 'accountant-oscar' },
      { roleId: 'accountant-kevin' }
    ],
    builtin: true
  },
  {
    id: 'sales',
    name: 'Sales',
    blurb: 'Dwight in the chair. Jim, Stanley, and Phyllis on the phones.',
    roles: [
      { roleId: 'assistant-rm', asGod: true },
      { roleId: 'sales-jim' },
      { roleId: 'sales-stanley' },
      { roleId: 'sales-phyllis' }
    ],
    builtin: true
  },
  {
    id: 'corporate',
    name: 'Corporate',
    blurb: 'Michael plus a tight management row. Five seats on the opening floor.',
    roles: [
      { roleId: 'regional-manager', asGod: true },
      { roleId: 'sales-jim-corp' },
      { roleId: 'reception' },
      { roleId: 'assistant-rm-dwight' },
      { roleId: 'accounting-lead' }
    ],
    builtin: true
  },
  {
    id: 'party-planning',
    name: 'Party Planning',
    blurb: 'Pam chairs the committee. Angela, Phyllis, and Meredith bring the cake.',
    roles: [
      { roleId: 'party-chair', asGod: true },
      { roleId: 'party-angela' },
      { roleId: 'party-phyllis' },
      { roleId: 'party-meredith' }
    ],
    builtin: true
  }
];

export function templateById(
  templates: ReadonlyArray<ProjectTemplate>,
  id: string
): ProjectTemplate | undefined {
  return templates.find((t) => t.id === id);
}

/** Expand roleId refs (and legacy inline roles) to CreateProjectRole[]. */
export function rolesFromTemplate(
  template: ProjectTemplate,
  catalog = BUILTIN_ROLES
): CreateProjectRole[] {
  return expandTemplateRoles(template.roles, catalog).map((r) => ({ ...r, asGod: !!r.asGod }));
}

export function isBuiltinTemplateId(id: string): boolean {
  return BUILTIN_PROJECT_TEMPLATES.some((t) => t.id === id);
}

export interface UserTemplateDraft {
  name: string;
  roles: CreateProjectRole[];
  blurb?: string;
}

/** Validate and normalize a user-saved template. Id is assigned by the store. */
export function parseUserTemplateDraft(input: UserTemplateDraft): {
  name: string;
  blurb: string;
  roles: CreateProjectRole[];
  godCharacter: OfficeCharacterName;
} {
  const name = assertProjectName(input.name);
  const parsed = assertCreateProjectRoles(input.roles);
  const blurb = typeof input.blurb === 'string' ? input.blurb.trim().slice(0, 160) : '';
  return {
    name,
    blurb: blurb || `Saved floor: ${parsed.godName} as god.`,
    roles: parsed.roles,
    godCharacter: parsed.godCharacter
  };
}

export function mergeTemplates(user: ReadonlyArray<ProjectTemplate>): ProjectTemplate[] {
  const extra = user.filter((t) => !isBuiltinTemplateId(t.id));
  return [...BUILTIN_PROJECT_TEMPLATES, ...extra];
}
