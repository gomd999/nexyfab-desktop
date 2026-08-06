import { describe, expect, it } from 'vitest';
import { classifyManufacturingReadiness } from '../manufacturingReadiness';
import { evaluateManufacturingGates, type ManufacturingGateInput } from '../manufacturingGates';

const passingGates: ManufacturingGateInput = {
  provenance: { traceable: true, privacyCompliant: true, refs: ['prompt:hash'] },
  intent: { resolved: true, unresolved: [], conflicts: [] },
  program: { valid: true, errors: [] },
  kernel: { built: true, analytic: true, errors: [] },
  topology: { closed: true, manifold: true, solidCount: 1, errors: [] },
  dimensions: { checked: 3, maxErrorMm: 0, toleranceMm: 0.05, mismatches: [] },
  features: { requested: 1, verified: 1, skipped: [], mismatches: [] },
  dfm: { process: 'cnc', material: 'al6061', passed: true, violations: [] },
  stepRoundtrip: { reimported: true, topologyMatched: true, dimensionsMatched: true, errors: [] },
  release: { artifactId: 'step:hash', exactArtifactVerified: true, authorized: true, reasons: [] },
};

describe('classifyManufacturingReadiness', () => {
  it('does not treat a rendered free-form mesh as manufacturing-ready', () => {
    expect(classifyManufacturingReadiness({ hasGeometry: true, hasFeatureProgram: false })).toMatchObject({
      level: 'concept_only', manufacturingAllowed: false,
    });
  });

  it('requires analytic STEP handoff for a feature model', () => {
    expect(classifyManufacturingReadiness({ hasGeometry: true, hasFeatureProgram: true })).toMatchObject({
      level: 'review_required', manufacturingAllowed: false,
    });
  });

  it('keeps reported feature loss out of verified status', () => {
    expect(classifyManufacturingReadiness({
      hasGeometry: true,
      hasFeatureProgram: true,
      analyticStepHandoffPassed: true,
      skippedFeatures: ['fillet'],
    })).toMatchObject({ level: 'review_required', manufacturingAllowed: false });
  });

  it('does not verify a clean export without G0-G9 evidence', () => {
    expect(classifyManufacturingReadiness({
      hasGeometry: true,
      hasFeatureProgram: true,
      analyticStepHandoffPassed: true,
    })).toMatchObject({ level: 'review_required', manufacturingAllowed: false });
  });

  it('verifies only a clean analytic STEP handoff with all G0-G9 gates passed', () => {
    expect(classifyManufacturingReadiness({
      hasGeometry: true,
      hasFeatureProgram: true,
      analyticStepHandoffPassed: true,
      gateReport: evaluateManufacturingGates(passingGates),
    })).toMatchObject({ level: 'verified', manufacturingAllowed: true });
  });
});
