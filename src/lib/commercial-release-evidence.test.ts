import { describe, expect, it } from 'vitest';
import { commercialReleaseEvidenceIssues } from './commercial-release-evidence';

const now = Date.parse('2026-08-07T00:00:00Z');
const valid = {
  NEXYFAB_COMMERCIAL_MODE: '1',
  ONCALL_OWNER: 'ops@example.com',
  SUPPORT_OWNER: 'support@example.com',
  ROLLBACK_OWNER: 'release@example.com',
  LAST_RESTORE_DRILL_AT: '2026-08-01T00:00:00Z',
  LAST_PAYMENT_REHEARSAL_AT: '2026-08-02T00:00:00Z',
  LEGAL_POLICY_APPROVED_AT: '2026-07-01T00:00:00Z',
};

describe('commercialReleaseEvidenceIssues', () => {
  it('accepts current evidence with named owners', () => {
    expect(commercialReleaseEvidenceIssues(valid, now)).toEqual([]);
  });

  it('rejects stale restore and payment evidence', () => {
    const issues = commercialReleaseEvidenceIssues({
      ...valid,
      LAST_RESTORE_DRILL_AT: '2025-01-01T00:00:00Z',
      LAST_PAYMENT_REHEARSAL_AT: '2026-01-01T00:00:00Z',
    }, now);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'LAST_RESTORE_DRILL_AT.stale',
      'LAST_PAYMENT_REHEARSAL_AT.stale',
    ]));
  });
});
