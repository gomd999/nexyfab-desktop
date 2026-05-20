/**
 * permissions.ts — Per-branch RBAC for PDM.
 *
 * Branch-level: a user (or team) has a role on a branch. Roles
 * inherit from a project default. Override per-branch lets you
 * lock `main` to admins while letting everyone push to feature
 * branches.
 *
 * Roles (most → least powerful):
 *   - admin:    everything (incl. delete branch, force-push)
 *   - maintainer: commit + merge to this branch
 *   - writer:   commit but not merge
 *   - reader:   view only
 *
 * The check API is a single `can(action, ctx)` so callers don't
 * have to remember role bits — they describe what they want to do
 * and the rule engine answers yes/no.
 */

export type Role = 'reader' | 'writer' | 'maintainer' | 'admin';

const ROLE_LEVEL: Record<Role, number> = {
  reader: 0,
  writer: 1,
  maintainer: 2,
  admin: 3,
};

export type PdmAction =
  | 'view'
  | 'commit'
  | 'merge'
  | 'force-push'
  | 'delete-branch'
  | 'manage-permissions';

const ACTION_REQUIRES: Record<PdmAction, Role> = {
  'view':               'reader',
  'commit':             'writer',
  'merge':              'maintainer',
  'force-push':         'admin',
  'delete-branch':      'admin',
  'manage-permissions': 'admin',
};

export interface PermissionEntry {
  /** User id or `team:teamId`. */
  principal: string;
  /** Branch name pattern. `*` matches any. */
  branchPattern: string;
  role: Role;
}

export interface PermissionContext {
  userId: string;
  /** Teams the user is on — checked against `team:` principals. */
  teamIds: string[];
  branchName: string;
}

function principalMatches(entry: PermissionEntry, ctx: PermissionContext): boolean {
  if (entry.principal === ctx.userId) return true;
  if (entry.principal.startsWith('team:')) {
    const team = entry.principal.slice('team:'.length);
    return ctx.teamIds.includes(team);
  }
  return false;
}

function branchMatches(pattern: string, name: string): boolean {
  if (pattern === '*') return true;
  if (pattern === name) return true;
  // Simple `prefix-*` wildcard support.
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return name.startsWith(prefix);
  }
  return false;
}

/** Resolve the effective role a user has on a given branch. The
 *  most-permissive matching entry wins. Returns null if no entries
 *  apply (deny by default). */
export function effectiveRole(
  entries: PermissionEntry[],
  ctx: PermissionContext,
): Role | null {
  let best: Role | null = null;
  for (const e of entries) {
    if (!principalMatches(e, ctx)) continue;
    if (!branchMatches(e.branchPattern, ctx.branchName)) continue;
    if (!best || ROLE_LEVEL[e.role] > ROLE_LEVEL[best]) best = e.role;
  }
  return best;
}

/** Permission check entry point. */
export function can(
  action: PdmAction,
  entries: PermissionEntry[],
  ctx: PermissionContext,
): boolean {
  const role = effectiveRole(entries, ctx);
  if (!role) return false;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[ACTION_REQUIRES[action]];
}

/** Convenience helpers for the most common checks. */
export const canView   = (e: PermissionEntry[], c: PermissionContext) => can('view', e, c);
export const canCommit = (e: PermissionEntry[], c: PermissionContext) => can('commit', e, c);
export const canMerge  = (e: PermissionEntry[], c: PermissionContext) => can('merge', e, c);
