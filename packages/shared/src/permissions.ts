import type { Role } from './types';

// Role matrix from PRD §11. All checks are enforced on the server; the client uses the same
// table only to hide actions a user cannot perform.

export type Action =
  | 'comment'
  | 'resolveAny'
  | 'resolveOwn'
  | 'editOwn'
  | 'deleteAny'
  | 'manageMembers'
  | 'manageSites'
  | 'manageSharing'
  | 'manageIntegrations'
  | 'export'
  | 'billing'
  | 'deleteWorkspace'
  | 'assign'
  | 'createShareLink'
  | 'bulk';

const MATRIX: Record<Action, Role[]> = {
  comment: ['owner', 'admin', 'member', 'guest'],
  resolveAny: ['owner', 'admin', 'member'],
  resolveOwn: ['owner', 'admin', 'member', 'guest'],
  editOwn: ['owner', 'admin', 'member', 'guest'],
  deleteAny: ['owner', 'admin'],
  manageMembers: ['owner', 'admin'],
  manageSites: ['owner', 'admin'],
  manageSharing: ['owner', 'admin'],
  manageIntegrations: ['owner', 'admin'],
  export: ['owner', 'admin', 'member'],
  billing: ['owner'],
  deleteWorkspace: ['owner'],
  assign: ['owner', 'admin', 'member'],
  createShareLink: ['owner', 'admin', 'member'],
  bulk: ['owner', 'admin', 'member'],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return MATRIX[action].includes(role);
}

const RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/** Can `actor` change `target`'s role to `next`? Owners can do anything; admins cannot touch owners. */
export function canChangeRole(actor: Role, target: Role, next: Role): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner' && next !== 'owner';
  return false;
}
