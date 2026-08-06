import { describe, expect, it } from 'vitest';
import { evaluateJointEvidenceRelease, type JointEvidenceClaim } from './jointEvidenceReleaseGate';

const hash = 'a'.repeat(64);
const native = (): JointEvidenceClaim => ({ provenance: 'native-cad', sourceHash: hash, artifactHashes: ['b'.repeat(64)], jointCount: 2, semanticsComplete: true, reviewerApproved: true });

describe('joint evidence release gate', () => {
  it('allows reviewed complete native joints', () => expect(evaluateJointEvidenceRelease(native())).toMatchObject({ status: 'pass', nativeKpiEligible: true, manufacturingReleaseEligible: true, usage: 'native-verified' }));
  it('never promotes geometry inference to native KPI', () => expect(evaluateJointEvidenceRelease({ ...native(), provenance: 'geometry-inferred', semanticsComplete: false })).toMatchObject({ status: 'not_run', nativeKpiEligible: false, manufacturingReleaseEligible: false, usage: 'visualization-only' }));
  it('keeps user-confirmed joints outside manufacturing release', () => expect(evaluateJointEvidenceRelease({ ...native(), provenance: 'user-confirmed', semanticsComplete: false })).toMatchObject({ status: 'not_run', nativeKpiEligible: false, usage: 'editable-unverified' }));
  it('requires reviewer approval even for native semantics', () => expect(evaluateJointEvidenceRelease({ ...native(), reviewerApproved: false })).toMatchObject({ status: 'not_run', nativeKpiEligible: false, usage: 'native-pending-review' }));
  it('keeps incomplete native extraction as not_run rather than a parser failure', () => expect(evaluateJointEvidenceRelease({ ...native(), semanticsComplete: false })).toMatchObject({ status: 'not_run', nativeKpiEligible: false, manufacturingReleaseEligible: false, errors: [] }));
  it('rejects a false complete declaration from inference', () => expect(evaluateJointEvidenceRelease({ ...native(), provenance: 'geometry-inferred' })).toMatchObject({ status: 'fail', errors: ['non_native_semantics_complete_forbidden'] }));
});
