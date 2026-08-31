/** Built-in opening-floor templates for new projects. */

import {
  assertCreateProjectRoles,
  assertProjectName,
  type CreateProjectRole,
  type OfficeCharacterName
} from './projectTypes';

export interface ProjectTemplate {
  id: string;
  name: string;
  blurb: string;
  roles: CreateProjectRole[];
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
    roles: [{ character: 'michael', asGod: true }],
    builtin: true
  },
  {
    id: 'accounting',
    name: 'Accounting',
    blurb: 'Angela runs the floor. Oscar and Kevin keep the books.',
    roles: [
      { character: 'angela', asGod: true },
      { character: 'oscar' },
      { character: 'kevin' }
    ],
    builtin: true
  },
  {
    id: 'sales',
    name: 'Sales',
    blurb: 'Dwight in the chair. Jim, Stanley, and Phyllis on the phones.',
    roles: [
      { character: 'dwight', asGod: true },
      { character: 'jim' },
      { character: 'stanley' },
      { character: 'phyllis' }
    ],
    builtin: true
  },
  {
    id: 'corporate',
    name: 'Corporate',
    blurb: 'Michael plus a tight management row. Five seats, at the live-PTY cap.',
    roles: [
      { character: 'michael', asGod: true },
      { character: 'jim' },
      { character: 'pam' },
      { character: 'dwight' },
      { character: 'angela' }
    ],
    builtin: true
  },
  {
    id: 'party-planning',
    name: 'Party Planning',
    blurb: 'Pam chairs the committee. Angela, Phyllis, and Meredith bring the cake.',
    roles: [
      { character: 'pam', asGod: true },
      { character: 'angela' },
      { character: 'phyllis' },
      { character: 'meredith' }
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

export function rolesFromTemplate(template: ProjectTemplate): CreateProjectRole[] {
  return template.roles.map((r) => ({ character: r.character, asGod: !!r.asGod }));
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
  const roles: CreateProjectRole[] = [
    { character: parsed.godCharacter, asGod: true },
    ...parsed.extraCharacters.map((character) => ({ character, asGod: false }))
  ];
  const blurb = typeof input.blurb === 'string' ? input.blurb.trim().slice(0, 160) : '';
  return {
    name,
    blurb: blurb || `Saved floor: ${parsed.godName} as god.`,
    roles,
    godCharacter: parsed.godCharacter
  };
}

export function mergeTemplates(user: ReadonlyArray<ProjectTemplate>): ProjectTemplate[] {
  const extra = user.filter((t) => !isBuiltinTemplateId(t.id));
  return [...BUILTIN_PROJECT_TEMPLATES, ...extra];
}
