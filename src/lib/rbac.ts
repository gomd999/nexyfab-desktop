/**
 * Role-Based Access Control (RBAC) for Nexysys multi-product platform.
 *
 * Products: platform, nexyfab, nexyflow, nexywise
 * Roles per product:
 *   platform  — super_admin
 *   nexyfab   — customer, partner, org_admin
 *   nexyflow  — org_admin, member
 *   nexywise  — org_admin, member
 *
 * nf_users.role  = global role ('user' | 'super_admin')
 * nf_user_roles  = per-product roles (multiple per user)
 */
import { getDbAdapter } from './db-adapter';

export type Product = 'platform' | 'nexyfab' | 'nexyflow' | 'nexywise';

export type PlatformRole = 'super_admin';
export type NexyfabRole = 'customer' | 'partner' | 'org_admin';
export type NexyflowRole = 'org_admin' | 'member';

export type ProductRole = PlatformRole | NexyfabRole | NexyflowRole;

export interface UserRole {
  product: Product;
  role: ProductRole;
  orgId: string | null;
}

// ─── Query helpers ──────────────────────────────────────────────────────────

/** Fetch all product roles for a user */
export async function getUserRoles(userId: string): Promise<UserRole[]> {
  const db = getDbAdapter();
  const rows = await db.queryAll<{ product: string; role: string; org_id: string | null }>(
    'SELECT product, role, org_id FROM nf_user_roles WHERE user_id = ?',
    userId,
  );
  return rows.map(r => ({
    product: r.product as Product,
    role: r.role as ProductRole,
    orgId: r.org_id,
  }));
}

/** Check if user has a specific role for a product */
export async function hasRole(
  userId: string,
  product: Product,
  role: ProductRole,
): Promise<boolean> {
  const db = getDbAdapter();
  const row = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_user_roles WHERE user_id = ? AND product = ? AND role = ?',
    userId, product, role,
  );
  return !!row;
}

/** Check if user has ANY of the specified roles for a product */
export async function hasAnyRole(
  userId: string,
  product: Product,
  roles: ProductRole[],
): Promise<boolean> {
  const db = getDbAdapter();
  const placeholders = roles.map(() => '?').join(', ');
  const row = await db.queryOne<{ id: string }>(
    `SELECT id FROM nf_user_roles WHERE user_id = ? AND product = ? AND role IN (${placeholders}) LIMIT 1`,
    userId, product, ...roles,
  );
  return !!row;
}

/** Check if user is a platform super_admin (from nf_users.role) */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const db = getDbAdapter();
  const row = await db.queryOne<{ role: string }>(
    'SELECT role FROM nf_users WHERE id = ?',
    userId,
  );
  return row?.role === 'super_admin';
}

// ─── Org helpers ────────────────────────────────────────────────────────────

export interface OrgInfo {
  id: string;
  name: string;
  slug: string | null;
  plan: string;
  country: string;
  role: string; // user's role within the org
}

/** Get the org(s) a user belongs to */
export async function getUserOrgs(userId: string): Promise<OrgInfo[]> {
  const db = getDbAdapter();
  return db.queryAll<OrgInfo>(
    `SELECT o.id, o.name, o.slug, o.plan, o.country, om.role
     FROM nf_orgs o
     JOIN nf_org_members om ON om.org_id = o.id
     WHERE om.user_id = ?`,
    userId,
  );
}

/** Check if two users belong to the same org */
export async function isSameOrg(userIdA: string, userIdB: string): Promise<boolean> {
  const db = getDbAdapter();
  const row = await db.queryOne<{ org_id: string }>(
    `SELECT a.org_id FROM nf_org_members a
     JOIN nf_org_members b ON b.org_id = a.org_id
     WHERE a.user_id = ? AND b.user_id = ?
     LIMIT 1`,
    userIdA, userIdB,
  );
  return !!row;
}

/** Get all user IDs in the same org as a given user */
export async function getOrgMemberIds(userId: string): Promise<string[]> {
  const db = getDbAdapter();
  const rows = await db.queryAll<{ user_id: string }>(
    `SELECT DISTINCT om2.user_id FROM nf_org_members om1
     JOIN nf_org_members om2 ON om2.org_id = om1.org_id
     WHERE om1.user_id = ?`,
    userId,
  );
  return rows.map(r => r.user_id);
}

// ─── Role management ────────────────────────────────────────────────────────

/** Grant a product role to a user */
export async function grantRole(
  userId: string,
  product: Product,
  role: ProductRole,
  orgId?: string,
): Promise<void> {
  const db = getDbAdapter();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT OR IGNORE INTO nf_user_roles (id, user_id, product, role, org_id, granted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id, userId, product, role, orgId ?? null, Date.now(),
  );
}

/** Revoke a product role from a user */
export async function revokeRole(
  userId: string,
  product: Product,
  role: ProductRole,
): Promise<void> {
  const db = getDbAdapter();
  await db.execute(
    'DELETE FROM nf_user_roles WHERE user_id = ? AND product = ? AND role = ?',
    userId, product, role,
  );
}

/** Create an org and make the creator the owner + org_admin */
export async function createOrg(params: {
  name: string;
  slug?: string;
  businessNumber?: string;
  plan?: string;
  country?: string;
  ownerId: string;
}): Promise<string> {
  const db = getDbAdapter();
  const orgId = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_orgs (id, name, slug, business_number, plan, country, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    orgId, params.name, params.slug ?? null, params.businessNumber ?? null,
    params.plan ?? 'free', params.country ?? 'KR', params.ownerId, now,
  );

  // Owner becomes org member with 'owner' role
  await db.execute(
    `INSERT INTO nf_org_members (id, org_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?, ?)`,
    crypto.randomUUID(), orgId, params.ownerId, 'owner', now,
  );

  return orgId;
}

/** Add a member to an org */
export async function addOrgMember(
  orgId: string,
  userId: string,
  role: string = 'member',
): Promise<void> {
  const db = getDbAdapter();
  await db.execute(
    `INSERT OR IGNORE INTO nf_org_members (id, org_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?, ?)`,
    crypto.randomUUID(), orgId, userId, role, Date.now(),
  );
}
