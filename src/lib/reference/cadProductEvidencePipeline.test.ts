import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateCadEvidenceStatus, buildCadProductEvidenceSummary, resolveEvidenceOutput, safeEvidenceCaseId } from './cadProductEvidencePipeline';

describe('CAD product evidence pipeline governance', () => {
  it('aggregates every independent stage using fail > not_run > pass', () => {
    expect(aggregateCadEvidenceStatus(['pass', 'not_run', 'pass'])).toBe('not_run');
    expect(aggregateCadEvidenceStatus(['not_run', 'fail'])).toBe('fail');
  });
  it('rejects unsafe case identifiers and resolves within the evidence root', () => {
    expect(safeEvidenceCaseId('MeArm Snapshot 10')).toBe('mearm-snapshot-10');
    expect(() => safeEvidenceCaseId('../')).toThrow('invalid_evidence_case_id');
    expect(resolveEvidenceOutput('docs/evidence', 'mearm')).toBe(path.resolve('docs/evidence/mearm'));
  });
  it('emits a deterministic path-free summary contract', () => {
    const summary = buildCadProductEvidenceSummary({ caseId: 'MeArm', lineageId: 'set/mearm.snapshot.10', stages: [{ id: 'bundle', status: 'pass', report: 'bundle.json', summary: { members: 3 } }] });
    expect(summary).toEqual({ schema: 'nexyfab.cad-product-evidence-run.v1', generatorVersion: '1.0.0', caseId: 'mearm', lineageId: 'set/mearm.snapshot.10', sourceBytesCopied: false, absolutePathsStored: false, stages: [{ id: 'bundle', status: 'pass', report: 'bundle.json', summary: { members: 3 } }], status: 'pass' });
    expect(JSON.stringify(summary)).not.toMatch(/[A-Z]:\\|\/Users\//);
  });
});
