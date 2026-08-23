import type { AuthUser } from './auth-middleware';
import { resolveRequestOrgContext } from './org-context';

export interface OrderWorkspaceIdentity {
  user_id: string;
  org_id: string | null;
}

/** Buyer-side order access is always evaluated against the active workspace. */
export function isOrderBuyerInActiveWorkspace(
  auth: Pick<AuthUser, 'userId' | 'orgIds' | 'activeOrgId' | 'orgContextStatus'>,
  order: OrderWorkspaceIdentity,
): boolean {
  const context = resolveRequestOrgContext(auth);
  if (!context.ok) return false;
  return context.orgId
    ? order.org_id === context.orgId
    : order.org_id == null && order.user_id === auth.userId;
}

/** Commercial mutations require the original order owner or active-org admin. */
export function canManageOrderInActiveWorkspace(
  auth: Pick<AuthUser, 'userId' | 'roles' | 'orgIds' | 'activeOrgId' | 'orgContextStatus'>,
  order: OrderWorkspaceIdentity,
): boolean {
  if (!isOrderBuyerInActiveWorkspace(auth, order)) return false;
  if (order.org_id == null) return order.user_id === auth.userId;
  return order.user_id === auth.userId || auth.roles?.some(role => (
    role.product === 'nexyfab'
    && role.role === 'org_admin'
    && role.orgId === order.org_id
  )) === true;
}
