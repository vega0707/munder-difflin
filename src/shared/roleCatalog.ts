/** Shared seat/job role catalog — floor templates and one-click hire both resolve from here. */

import {
  OFFICE_CHARACTER_NAMES,
  type CreateProjectRole,
  type OfficeCharacterName
} from './projectTypes';

export type RoleSource = 'builtin' | 'user' | 'ai-ui' | 'ai-god';

export interface RoleDefinition {
  id: string;
  title: string;
  description: string;
  character: OfficeCharacterName;
  skills?: string[];
  mcp?: string[];
  builtin: boolean;
  source?: RoleSource;
}

/** Floor template entry: reference a catalog role (preferred) or legacy inline role. */
export interface ProjectTemplateRoleRef {
  roleId: string;
  asGod?: boolean;
}

export type ProjectTemplateRole = CreateProjectRole | ProjectTemplateRoleRef;

export function isProjectTemplateRoleRef(r: ProjectTemplateRole): r is ProjectTemplateRoleRef {
  return !!r && typeof r === 'object' && 'roleId' in r && typeof (r as ProjectTemplateRoleRef).roleId === 'string';
}

export const BUILTIN_ROLES: RoleDefinition[] = [
  // Product R&D
  {
    id: 'pm',
    title: '产品经理',
    description: '拆需求、排优先级、对齐交付，只把关键决策升级给你。',
    character: 'michael',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'architect',
    title: '软件架构师',
    description: '定模块边界、技术选型与关键决策。',
    character: 'oscar',
    skills: ['md-audit', 'capabilities'],
    mcp: ['sequential-thinking', 'filesystem', 'git'],
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'engineer',
    title: '研发工程师',
    description: '按设计实现功能与修复。',
    character: 'jim',
    skills: ['today', 'yesterday', 'md-hive-sync'],
    mcp: ['filesystem', 'git', 'fetch'],
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'fullstack-qa',
    title: '全栈代码质检官',
    description: '审查质量、安全与可维护性。',
    character: 'creed',
    skills: ['md-audit'],
    mcp: ['filesystem', 'git', 'sequential-thinking'],
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'ops',
    title: '运维工程师',
    description: '部署、观测与运行稳定性。',
    character: 'stanley',
    skills: ['temporal', 'today'],
    mcp: ['filesystem', 'time', 'fetch'],
    builtin: true,
    source: 'builtin'
  },
  // Full-stack / FE-BE
  {
    id: 'tech-lead',
    title: 'Tech Lead',
    description: 'Orchestrates the squad, splits work, unblocks, escalates only the sharp calls.',
    character: 'michael',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'frontend',
    title: 'Frontend',
    description: 'UI, client state, and accessibility.',
    character: 'jim',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'backend',
    title: 'Backend',
    description: 'APIs, data, and service boundaries.',
    character: 'dwight',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'qa',
    title: 'QA',
    description: 'Tests, regressions, and release confidence.',
    character: 'creed',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'frontend-pam',
    title: 'Frontend',
    description: 'Product UI and client experience.',
    character: 'pam',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'backend-dwight',
    title: 'Backend',
    description: 'Services, persistence, and contracts.',
    character: 'dwight',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'qa-creed',
    title: 'QA',
    description: 'Coverage, acceptance, and bug triage.',
    character: 'creed',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'devops',
    title: 'DevOps',
    description: 'CI, environments, and ship pipelines.',
    character: 'ryan',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'tech-lead-split',
    title: 'Tech Lead',
    description: 'Owns the plan and the hand-offs across the split.',
    character: 'michael',
    builtin: true,
    source: 'builtin'
  },
  // Solo / office
  {
    id: 'boss-solo',
    title: 'Boss',
    description: 'Runs the floor alone.',
    character: 'michael',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'head-accounting',
    title: 'Head of accounting',
    description: 'Runs the books and the floor.',
    character: 'angela',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'accountant-oscar',
    title: 'Accountant',
    description: 'Numbers, reconciliation, quiet judgment.',
    character: 'oscar',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'accountant-kevin',
    title: 'Accountant',
    description: 'Books, chili, and good intentions.',
    character: 'kevin',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'assistant-rm',
    title: 'Assistant (to the) RM',
    description: 'Closes deals and runs the floor.',
    character: 'dwight',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'sales-jim',
    title: 'Sales',
    description: 'Accounts and carefully timed pranks.',
    character: 'jim',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'sales-stanley',
    title: 'Sales',
    description: 'Accounts and the crossword.',
    character: 'stanley',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'sales-phyllis',
    title: 'Sales',
    description: 'Accounts and party planning intel.',
    character: 'phyllis',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'regional-manager',
    title: 'Regional Manager',
    description: 'Runs the floor.',
    character: 'michael',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'sales-jim-corp',
    title: 'Sales',
    description: 'Seller and sometime co-manager energy.',
    character: 'jim',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'reception',
    title: 'Reception / office',
    description: 'Front desk and floor glue.',
    character: 'pam',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'assistant-rm-dwight',
    title: 'Assistant (to the) RM',
    description: 'Loyalty, beets, and follow-through.',
    character: 'dwight',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'accounting-lead',
    title: 'Accounting lead',
    description: 'Rules, cats, and the books.',
    character: 'angela',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'party-chair',
    title: 'Committee chair',
    description: 'Plans the party and the floor.',
    character: 'pam',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'party-angela',
    title: 'Committee',
    description: 'Standards enforcement.',
    character: 'angela',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'party-phyllis',
    title: 'Committee',
    description: 'Cake and morale.',
    character: 'phyllis',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'party-meredith',
    title: 'Committee',
    description: 'Supplies and chaos.',
    character: 'meredith',
    builtin: true,
    source: 'builtin'
  },
  // Former AddAgent briefing chips
  {
    id: 'repo-janitor',
    title: '仓库清洁工',
    description: 'keeps the codebase tidy and healthy',
    character: 'creed',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'docs-writer',
    title: '文档写手',
    description: 'keeps docs in sync with the code',
    character: 'pam',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'bug-triager',
    title: '缺陷分诊员',
    description: 'investigates and root-causes bugs',
    character: 'stanley',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'research-assistant',
    title: '研究助理',
    description: 'gathers and summarizes information',
    character: 'oscar',
    builtin: true,
    source: 'builtin'
  },
  {
    id: 'release-manager',
    title: '发布经理',
    description: 'prepares and ships releases',
    character: 'dwight',
    builtin: true,
    source: 'builtin'
  }
];

const builtinById = new Map(BUILTIN_ROLES.map((r) => [r.id, r]));

export function isBuiltinRoleId(id: string): boolean {
  return builtinById.has(id);
}

export function roleById(
  roles: ReadonlyArray<RoleDefinition>,
  id: string
): RoleDefinition | undefined {
  return roles.find((r) => r.id === id);
}

export function mergeRoleCatalog(user: ReadonlyArray<RoleDefinition>): RoleDefinition[] {
  const extra = user.filter((r) => !isBuiltinRoleId(r.id));
  return [...BUILTIN_ROLES, ...extra];
}

export function resolveRoleToCreateProjectRole(
  role: RoleDefinition,
  asGod?: boolean
): CreateProjectRole {
  const out: CreateProjectRole = {
    character: role.character,
    asGod: !!asGod,
    title: role.title,
    description: role.description
  };
  if (role.skills?.length) out.skills = [...role.skills];
  if (role.mcp?.length) out.mcp = [...role.mcp];
  return out;
}

export function expandTemplateRole(
  entry: ProjectTemplateRole,
  catalog: ReadonlyArray<RoleDefinition> = BUILTIN_ROLES
): CreateProjectRole {
  if (isProjectTemplateRoleRef(entry)) {
    const def = roleById(catalog, entry.roleId);
    if (!def) {
      throw new Error(`unknown roleId: ${entry.roleId}`);
    }
    return resolveRoleToCreateProjectRole(def, entry.asGod);
  }
  return { ...entry, asGod: !!entry.asGod };
}

export function expandTemplateRoles(
  entries: ReadonlyArray<ProjectTemplateRole>,
  catalog: ReadonlyArray<RoleDefinition> = BUILTIN_ROLES
): CreateProjectRole[] {
  return entries.map((e) => expandTemplateRole(e, catalog));
}

/** Validate a user/AI role draft before save. */
export function assertRoleDraft(input: unknown): Omit<RoleDefinition, 'id' | 'builtin'> & {
  title: string;
  description: string;
  character: OfficeCharacterName;
} {
  if (!input || typeof input !== 'object') throw new Error('role draft required');
  const raw = input as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : '';
  const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 280) : '';
  if (!title) throw new Error('role title required');
  if (!description) throw new Error('role description required');
  const character = raw.character;
  if (typeof character !== 'string' || !(OFFICE_CHARACTER_NAMES as readonly string[]).includes(character)) {
    throw new Error('role character required');
  }
  const source = raw.source;
  const skills = Array.isArray(raw.skills)
    ? raw.skills.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : undefined;
  const mcp = Array.isArray(raw.mcp)
    ? raw.mcp.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : undefined;
  return {
    title,
    description,
    character: character as OfficeCharacterName,
    skills: skills?.length ? skills : undefined,
    mcp: mcp?.length ? mcp : undefined,
    source: source === 'ai-ui' || source === 'ai-god' || source === 'user' ? source : 'user'
  };
}

/** Prefer an existing catalog entry whose title matches (case-insensitive). */
export function findRoleByTitle(
  catalog: ReadonlyArray<RoleDefinition>,
  title: string
): RoleDefinition | undefined {
  const needle = title.trim().toLowerCase();
  if (!needle) return undefined;
  return catalog.find((r) => r.title.trim().toLowerCase() === needle);
}
