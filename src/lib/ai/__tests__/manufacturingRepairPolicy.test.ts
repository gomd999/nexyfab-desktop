import { describe, expect, it } from 'vitest';
import { evaluateManufacturingGates, type ManufacturingGateInput } from '../manufacturingGates';
import { manufacturingRepairFeedback, manufacturingReportVerdict, planManufacturingRepair } from '../manufacturingRepairPolicy';

const base: ManufacturingGateInput = {
  provenance: { traceable: true, privacyCompliant: true, refs: ['prompt:hash'] },
  intent: { resolved: true, unresolved: [], conflicts: [] },
  program: { valid: true, errors: [] },
  kernel: { built: true, analytic: true, engine: 'OCCT', errors: [] },
  topology: { closed: true, manifold: true, solidCount: 1, errors: [] },
  dimensions: { checked: 3, maxErrorMm: 0, toleranceMm: 0.05, mismatches: [] },
  features: { requested: 2, verified: 2, skipped: [], mismatches: [] },
  dfm: { process: 'cnc', material: 'al6061', passed: true, violations: [] },
  stepRoundtrip: { reimported: true, topologyMatched: true, dimensionsMatched: true, errors: [] },
  release: { artifactId: 'step:hash', exactArtifactVerified: true, authorized: true, reasons: [] },
};

describe('manufacturing repair policy', () => {
  it('routes unresolved intent to the user instead of an AI retry', () => {
    const report = evaluateManufacturingGates({
      ...base, intent: { resolved: false, unresolved: ['thickness'], conflicts: [] },
    });
    expect(planManufacturingRepair({ report })).toMatchObject({ disposition: 'user_input', gate: 'G1', actions: [] });
  });

  it('rebuilds dimensional mismatches from immutable confirmed intent', () => {
    const report = evaluateManufacturingGates({
      ...base, dimensions: { checked: 3, maxErrorMm: 2, toleranceMm: 0.05, mismatches: ['width expected 50 actual 48'] },
    });
    const plan = planManufacturingRepair({ report, confirmedDimensionKeys: ['width', 'height', 'depth'] });
    expect(plan).toMatchObject({ disposition: 'auto_retry', gate: 'G5' });
    expect(plan.actions[0]).toMatchObject({ type: 'rebuild_from_confirmed_dimensions' });
    expect(manufacturingRepairFeedback(plan)).toContain('Immutable confirmed fields: width, height, depth.');
    expect(manufacturingRepairFeedback(plan)).toContain('never alter the expected dimensions');
  });

  it('never auto-repairs DFM or exact-artifact authorization', () => {
    const dfmReport = evaluateManufacturingGates({
      ...base, dfm: { process: 'cnc', material: 'al6061', passed: false, violations: ['wall too thin'] },
    });
    expect(planManufacturingRepair({ report: dfmReport })).toMatchObject({ disposition: 'manual_review', gate: 'G7' });
    const releaseReport = evaluateManufacturingGates({
      ...base, release: { artifactId: 'step:hash', exactArtifactVerified: true, authorized: false, reasons: [] },
    });
    expect(planManufacturingRepair({ report: releaseReport })).toMatchObject({ disposition: 'manual_review', gate: 'G9' });
  });

  it('stops after repeated identical failures', () => {
    const report = evaluateManufacturingGates({ ...base, topology: { closed: false, manifold: false, solidCount: 1, errors: [] } });
    const first = planManufacturingRepair({ report, maxAttempts: 2 });
    const history = [
      { fingerprint: first.fingerprint, gate: first.gate, at: 1 },
      { fingerprint: first.fingerprint, gate: first.gate, at: 2 },
    ];
    expect(planManufacturingRepair({ report, maxAttempts: 2, history })).toMatchObject({ disposition: 'stop', gate: 'G4', attempt: 3 });
  });

  it('does nothing after a full pass', () => {
    expect(planManufacturingRepair({ report: evaluateManufacturingGates(base) })).toMatchObject({ disposition: 'stop', gate: null, attempt: 0 });
  });

  it('marks only safe automatic plans as retryable for the existing loop', () => {
    const userInput = evaluateManufacturingGates({
      ...base, intent: { resolved: false, unresolved: ['thickness'], conflicts: [] },
    });
    expect(manufacturingReportVerdict(userInput).verdict).toMatchObject({ passed: false, retryable: false });
    const topology = evaluateManufacturingGates({
      ...base, topology: { closed: false, manifold: false, solidCount: 1, errors: [] },
    });
    expect(manufacturingReportVerdict(topology).verdict).toMatchObject({ passed: false, retryable: true });
  });
});
