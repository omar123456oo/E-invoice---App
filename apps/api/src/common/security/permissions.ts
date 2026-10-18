/**
 * Role-based access control. Permissions are checked on the server for every
 * protected operation; the Angular app only uses them to shape the UI.
 */
export const PERMISSIONS = [
  'platform:tenants:manage',
  'platform:health:read',
  'company:read',
  'company:manage',
  'branches:read',
  'branches:manage',
  'users:read',
  'users:manage',
  'products:read',
  'products:manage',
  'tax:read',
  'tax:manage',
  'customers:read',
  'customers:manage',
  'pos:devices:read',
  'pos:devices:manage',
  'pos:shifts:operate',
  'pos:shifts:manage',
  'sales:checkout',
  'sales:discount:override',
  'sales:read',
  'receipts:read',
  'receipts:reprint',
  'receipts:submit',
  'eta:read',
  'eta:manage',
  'returns:create',
  'returns:approve',
  'returns:read',
  'payments:read',
  'payments:manage',
  'reports:read',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'PLATFORM_ADMIN',
  'COMPANY_OWNER',
  'COMPANY_ADMIN',
  'FINANCE_MANAGER',
  'CASHIER',
  'ACCOUNTANT',
  'AUDITOR',
  'TECH_SUPPORT',
] as const;

export type Role = (typeof ROLES)[number];

const TENANT_ALL: Permission[] = PERMISSIONS.filter((p) => !p.startsWith('platform:'));

const READ_ONLY: Permission[] = [
  'company:read',
  'branches:read',
  'products:read',
  'tax:read',
  'pos:devices:read',
  'sales:read',
  'receipts:read',
  'eta:read',
  'returns:read',
  'payments:read',
  'reports:read',
  'audit:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Platform operator: manages tenants; deliberately has no access to tenant business data.
  PLATFORM_ADMIN: ['platform:tenants:manage', 'platform:health:read'],
  COMPANY_OWNER: TENANT_ALL,
  COMPANY_ADMIN: TENANT_ALL.filter((p) => p !== 'company:manage'),
  FINANCE_MANAGER: [
    ...READ_ONLY,
    'customers:read',
    'customers:manage',
    'pos:shifts:manage',
    'sales:discount:override',
    'receipts:reprint',
    'receipts:submit',
    'returns:create',
    'returns:approve',
    'payments:manage',
    'users:read',
  ],
  CASHIER: [
    'products:read',
    'customers:read',
    'customers:manage',
    'pos:devices:read',
    'pos:shifts:operate',
    'sales:checkout',
    'sales:read',
    'receipts:read',
    'receipts:reprint',
    'returns:create',
    'returns:read',
  ],
  ACCOUNTANT: [...READ_ONLY, 'customers:read'],
  // Auditors read everything except consumer personal data.
  AUDITOR: READ_ONLY,
  // Support sees integration health and technical status only: no customers, no audit trail, no reports.
  TECH_SUPPORT: ['pos:devices:read', 'eta:read', 'platform:health:read'],
};

/** Roles that may access every branch of the tenant regardless of branch assignment. */
export const ALL_BRANCH_ROLES: ReadonlySet<Role> = new Set(['COMPANY_OWNER', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'AUDITOR', 'TECH_SUPPORT']);

/** Which roles a given role may assign when managing users (prevents privilege escalation). */
export const ASSIGNABLE_ROLES: Record<Role, readonly Role[]> = {
  PLATFORM_ADMIN: ['COMPANY_OWNER'],
  COMPANY_OWNER: ['COMPANY_ADMIN', 'FINANCE_MANAGER', 'CASHIER', 'ACCOUNTANT', 'AUDITOR', 'TECH_SUPPORT'],
  COMPANY_ADMIN: ['FINANCE_MANAGER', 'CASHIER', 'ACCOUNTANT', 'AUDITOR', 'TECH_SUPPORT'],
  FINANCE_MANAGER: [],
  CASHIER: [],
  ACCOUNTANT: [],
  AUDITOR: [],
  TECH_SUPPORT: [],
};

export function permissionsFor(role: Role): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}
