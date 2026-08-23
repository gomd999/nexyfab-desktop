import { describe, expect, it } from 'vitest';
import {
  buildArchitectureInteriorLineageOperationsReport,
  defaultOperationsReportInputs,
} from './build-architecture-interior-lineage-operations-report.mjs';

describe('architecture/interior lineage operations report', () => {
  it('reports the checked-in 7,407-file lineage as HOLD without approved assignments', () => {
    const inputs = defaultOperationsReportInputs(process.cwd());
    const report = buildArchitectureInteriorLineageOperationsReport({
      ...inputs,
      now: Date.parse('2026-08-23T12:00:00.000Z'),
    });
    expect(report).toMatchObject({
      schema: 'nexyfab.architecture-interior.lineage-operations-report.v1',
      status: 'HOLD',
      scoreEligible: false,
      inventory: { files: 7407, schema: 'nexyfab.architecture-interior.reference-inventory.v1' },
    });
    expect(Object.keys(report.scenarios)).toEqual([
      'office',
      'apartment',
      'cafe',
      'mep_companion',
      'comprehensive_residential',
      'ifc_regression',
    ]);
    for (const scenario of Object.values(report.scenarios)) {
      expect(scenario.status).toBe('HOLD');
      expect(scenario.assignment.status).toBe('unassigned');
      expect(scenario.license.decision).toBe('HOLD');
      expect(scenario.independentReviewer.status).toBe('HOLD');
    }
  });

  it('keeps the report score-ineligible even when the underlying receipt validation is clean', () => {
    const inputs = defaultOperationsReportInputs(process.cwd());
    const report = buildArchitectureInteriorLineageOperationsReport({
      ...inputs,
      now: Date.parse('2026-08-23T12:00:00.000Z'),
    });
    expect(report.policy).toEqual({
      sourceReadOnly: true,
      licenseDecisionNeverInferred: true,
      assignmentNeverInferred: true,
      independentReviewerRequired: true,
      holdoutTuningExcluded: true,
    });
    expect(report.goldenManifest.validation.status).toBe('PASS');
    expect(report.scoreEligible).toBe(false);
  });
});
