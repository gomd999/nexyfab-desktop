import { describe, expect, it } from 'vitest';
import { cadIndependentReleaseAuditV2Issues, type CadIndependentReleaseAuditV2 } from './cad-independent-release-audit-v2';

const sha = 'a'.repeat(64);
const valid: CadIndependentReleaseAuditV2 = {
  schema: 'nexyfab.cad-independent-release-audit.v2', releaseId: '2026.08.09-rc1', productRisk: 'standard',
  externalCadRequired: false, runtimeKernelMode: 'wasm-only-no-stub',
  closedBetaIntegrity: { status: 'pass', reportSha256: sha }, revisionManifest: { status: 'pass', sha256: sha },
  kernelStackIdentity: { status: 'pass', sha256: sha }, kernelEvidence: { status: 'pass', sha256: sha },
  licenses: { status: 'pass', inventorySha256: sha, unresolved: [] },
  apiControls: { evidenceSha256: sha, authentication: 'pass', authorization: 'pass', rateLimit: 'pass', metering: 'pass' },
  operations: { restoreDrill: 'pass', rollback: 'pass', monitoring: 'pass' }, expertReview: { status: 'not-required' },
};

describe('CAD-independent release audit v2', () => {
  it('accepts a complete standard-product audit', () => expect(cadIndependentReleaseAuditV2Issues(valid)).toEqual([]));
  it('requires an identified internal expert for complex products', () => {
    expect(cadIndependentReleaseAuditV2Issues({ ...valid, productRisk: 'complex', expertReview: { status: 'missing' } }).map(issue => issue.code)).toContain('audit.expert_review');
  });
  it('fails closed on stub mode, unresolved licenses or missing API metering', () => {
    const bad = { ...valid, runtimeKernelMode: 'wasm-only-no-stub' as const, licenses: { ...valid.licenses, unresolved: ['buffers@0.1.1'] }, apiControls: { ...valid.apiControls, metering: 'fail' as const } };
    expect(cadIndependentReleaseAuditV2Issues(bad).map(issue => issue.code)).toEqual(expect.arrayContaining(['audit.licenses.failed', 'audit.api.metering']));
  });
});
