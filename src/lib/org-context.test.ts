import { describe, expect, it } from 'vitest';
import { resourceBelongsToOrgContext, resolveRequestOrgContext } from './org-context';

describe('organization context', () => {
  it('uses the only organization for backward-compatible sessions', () => {
    expect(resolveRequestOrgContext({
      orgIds: ['org-a'], activeOrgId: null, orgContextStatus: 'active',
    })).toEqual({ ok: true, orgId: 'org-a', mode: 'active' });
  });

  it('requires an explicit selection for a multi-org user', () => {
    expect(resolveRequestOrgContext({
      orgIds: ['org-a', 'org-b'], activeOrgId: null, orgContextStatus: 'selection_required',
    })).toEqual({ ok: false, code: 'ORG_CONTEXT_REQUIRED' });
  });

  it('rejects an active organization outside the membership snapshot', () => {
    expect(resolveRequestOrgContext({
      orgIds: ['org-a'], activeOrgId: 'org-b', orgContextStatus: 'active',
    })).toEqual({ ok: false, code: 'ORG_CONTEXT_INVALID' });
  });

  it('keeps personal and organization resources mutually exclusive', () => {
    expect(resourceBelongsToOrgContext(null, { ok: true, orgId: null, mode: 'personal' })).toBe(true);
    expect(resourceBelongsToOrgContext('org-a', { ok: true, orgId: null, mode: 'personal' })).toBe(false);
    expect(resourceBelongsToOrgContext('org-a', { ok: true, orgId: 'org-a', mode: 'active' })).toBe(true);
    expect(resourceBelongsToOrgContext(null, { ok: true, orgId: 'org-a', mode: 'active' })).toBe(false);
  });
});
