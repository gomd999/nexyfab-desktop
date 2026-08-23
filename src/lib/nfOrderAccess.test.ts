import { describe, expect, it } from 'vitest';
import { canManageOrderInActiveWorkspace, isOrderBuyerInActiveWorkspace } from './nfOrderAccess';

describe('order active-workspace access', () => {
  it('isolates personal and organization orders even for the same user', () => {
    const personal = { userId: 'u1', orgIds: ['o1', 'o2'], activeOrgId: null, orgContextStatus: 'personal' as const };
    const org = { ...personal, activeOrgId: 'o1', orgContextStatus: 'active' as const };
    expect(isOrderBuyerInActiveWorkspace(personal, { user_id: 'u1', org_id: null })).toBe(true);
    expect(isOrderBuyerInActiveWorkspace(personal, { user_id: 'u1', org_id: 'o1' })).toBe(false);
    expect(isOrderBuyerInActiveWorkspace(org, { user_id: 'someone-else', org_id: 'o1' })).toBe(true);
    expect(isOrderBuyerInActiveWorkspace(org, { user_id: 'u1', org_id: 'o2' })).toBe(false);
  });

  it('allows organization mutations only to the release owner or active-org admin', () => {
    const member = {
      userId: 'member', orgIds: ['o1'], activeOrgId: 'o1', orgContextStatus: 'active' as const,
      roles: [],
    };
    const order = { user_id: 'release-owner', org_id: 'o1' };
    expect(isOrderBuyerInActiveWorkspace(member, order)).toBe(true);
    expect(canManageOrderInActiveWorkspace(member, order)).toBe(false);
    expect(canManageOrderInActiveWorkspace({
      ...member,
      roles: [{ product: 'nexyfab', role: 'org_admin', orgId: 'o1' }],
    }, order)).toBe(true);
    expect(canManageOrderInActiveWorkspace({
      ...member,
      roles: [{ product: 'nexyfab', role: 'org_admin', orgId: 'o2' }],
    }, order)).toBe(false);
  });

  it('fails closed when multi-org selection is missing or invalid', () => {
    const base = { userId: 'u1', orgIds: ['o1', 'o2'], activeOrgId: null };
    expect(isOrderBuyerInActiveWorkspace(
      { ...base, orgContextStatus: 'selection_required' },
      { user_id: 'u1', org_id: null },
    )).toBe(false);
    expect(isOrderBuyerInActiveWorkspace(
      { ...base, activeOrgId: 'unknown', orgContextStatus: 'invalid' },
      { user_id: 'u1', org_id: 'unknown' },
    )).toBe(false);
  });
});
