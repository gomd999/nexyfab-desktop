import { describe, expect, it } from 'vitest';
import { evaluatePrecisionManufacturingRelease, unrunPrecisionManufacturingRelease, type PrecisionManufacturingReleaseInput } from './precisionManufacturingReleaseGate';

const complete = (domain: 'piping' | 'welded-fabrication' | 'mold-tooling'): PrecisionManufacturingReleaseInput => ({
  domain,
  geometry: { status: 'PASS' as const, supported: true, evidenceId: `${domain}:geometry` },
  dfm: { status: 'PASS' as const, supported: true, evidenceId: `${domain}:dfm` },
  validation: { status: 'PASS' as const, supported: true, evidenceId: `${domain}:validation` },
  manufacturingExport: { status: 'PASS' as const, supported: true, evidenceId: `${domain}:export` },
  releaseAuthorization: { status: 'PASS' as const, supported: true, evidenceId: `${domain}:authorization` },
});

describe('precision manufacturing release boundary', () => {
  it.each(['piping', 'welded-fabrication', 'mold-tooling'] as const)('holds an unrun %s flow', domain => {
    const result = unrunPrecisionManufacturingRelease(domain);
    expect(result).toMatchObject({ status: 'HOLD', contractComplete: false, localPass: false, releaseReady: false, commercialReleaseReady: false });
    expect(result.blockers).toEqual(expect.arrayContaining(['geometry_not_run', 'dfm_not_run', 'validation_not_run', 'manufacturingExport_not_run', 'releaseAuthorization_not_run']));
  });

  it('requires supported PASS evidence for every stage', () => {
    const input = complete('piping');
    input.dfm = { status: 'PASS', supported: false, evidenceId: 'dfm-preview' };
    input.validation = { status: 'NOT_RUN', supported: true };
    const result = evaluatePrecisionManufacturingRelease(input);
    expect(result).toMatchObject({ status: 'HOLD', contractComplete: false, localPass: false, releaseReady: false, commercialReleaseReady: false });
    expect(result.blockers).toEqual(expect.arrayContaining(['dfm_unsupported', 'validation_not_run', 'validation_evidence_missing']));
  });

  it('passes only when all five stages are explicitly evidenced', () => {
    expect(evaluatePrecisionManufacturingRelease(complete('mold-tooling'))).toEqual({
      status: 'PASS_LOCAL',
      contractComplete: true,
      localPass: true,
      releaseReady: false,
      commercialReleaseReady: false,
      blockers: [],
      commercialBlockers: ['signed_independent_release_evidence_required'],
    });
  });
});
