import { describe, expect, it } from 'vitest';
import { applyManufacturingAssignments, resolveManufacturingAssignment } from './manufacturingAssignment';

describe('manufacturing assignment provenance', () => {
  it('keeps absent or unconfirmed metadata unresolved', () => {
    expect(resolveManufacturingAssignment({ definitionId: 'p1' })).toMatchObject({ status: 'not_run', assignment: null });
    expect(resolveManufacturingAssignment({ definitionId: 'p1', explicit: { material: 'steel', process: 'cnc_mill', confirmed: false, sourceRef: 'prompt:1' } })).toMatchObject({ status: 'not_run' });
  });
  it('accepts complete user-confirmed provenance', () => expect(resolveManufacturingAssignment({ definitionId: 'p1', explicit: { material: 'steel', process: 'cnc_mill', confirmed: true, sourceRef: 'user-selection:42' } })).toMatchObject({ status: 'pass', assignment: { source: 'user_confirmed', material: 'steel', process: 'cnc_mill' } }));
  it('requires explicit opt-in to an approved matching family policy', () => {
    const policy = { id: 'policy:gear:1', family: 'gear', material: 'steel_4140', process: 'gear_hobbing', approved: true as const, approvalRef: 'policy-review:99' };
    expect(resolveManufacturingAssignment({ definitionId: 'p1', family: 'gear', policy })).toMatchObject({ status: 'not_run' });
    expect(resolveManufacturingAssignment({ definitionId: 'p1', family: 'gear', policy, acceptFamilyPolicy: true })).toMatchObject({ status: 'pass', assignment: { source: 'approved_family_policy', policyId: 'policy:gear:1' } });
  });
  it('clears only material/process unresolved fields for assigned definitions', () => expect(applyManufacturingAssignments([{ definitionId: 'p1', unresolvedMetadata: ['material', 'process', 'tolerance'] }], [{ definitionId: 'p1', material: 'steel', process: 'cnc_mill', source: 'user_confirmed', sourceRef: 'user:1', confirmedAt: null, policyId: null }])[0]).toMatchObject({ unresolvedMetadata: ['tolerance'], manufacturingAssignment: { material: 'steel' } }));
});
