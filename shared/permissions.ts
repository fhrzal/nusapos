import type { Role } from './types';

export type Permission =
  | 'pos.use'
  | 'pos.approve'
  | 'dashboard.view'
  | 'products.view'
  | 'products.manage'
  | 'inventory.view'
  | 'inventory.manage'
  | 'purchasing.manage'
  | 'promotions.manage'
  | 'members.view'
  | 'members.manage'
  | 'sales.view'
  | 'shifts.view'
  | 'schedules.manage'
  | 'reports.view'
  | 'users.manage'
  | 'stores.manage'
  | 'settings.manage'
  | 'audit.view';

const MANAGEMENT: Role[] = ['HQ_ADMIN', 'STORE_MANAGER'];
const STORE_LEAD: Role[] = ['STORE_MANAGER', 'SUPERVISOR'];

// SUPER_ADMIN selalu memiliki semua izin, tidak perlu dicantumkan.
const MATRIX: Record<Permission, Role[]> = {
  'pos.use': ['CASHIER', ...STORE_LEAD],
  'pos.approve': STORE_LEAD,
  'dashboard.view': [...MANAGEMENT, 'SUPERVISOR', 'INVENTORY'],
  'products.view': [...MANAGEMENT, 'SUPERVISOR', 'INVENTORY'],
  'products.manage': ['HQ_ADMIN'],
  'inventory.view': [...MANAGEMENT, 'SUPERVISOR', 'INVENTORY'],
  'inventory.manage': ['HQ_ADMIN', 'STORE_MANAGER', 'INVENTORY'],
  'purchasing.manage': ['HQ_ADMIN', 'STORE_MANAGER', 'INVENTORY'],
  'promotions.manage': ['HQ_ADMIN'],
  'members.view': [...MANAGEMENT, 'SUPERVISOR', 'CASHIER'],
  'members.manage': [...MANAGEMENT, 'SUPERVISOR', 'CASHIER'],
  'sales.view': [...MANAGEMENT, 'SUPERVISOR'],
  'shifts.view': [...MANAGEMENT, 'SUPERVISOR'],
  'schedules.manage': MANAGEMENT,
  'reports.view': MANAGEMENT,
  'users.manage': MANAGEMENT,
  'stores.manage': ['HQ_ADMIN'],
  'settings.manage': [],
  'audit.view': MANAGEMENT,
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  return MATRIX[permission].includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(MATRIX) as Permission[]).filter((p) => can(role, p));
}
