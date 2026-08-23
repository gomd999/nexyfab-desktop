import { describe, expect, it } from 'vitest';
import { evaluateRobotEngineeringAnalysisPacket } from './robotEngineeringAnalysisPacket';
import { buildRobotEngineeringAnalysisPacketFixture } from './robotEngineeringAnalysisPacket.testFixture';

describe('robot engineering analysis packet', () => {
  it('independently recomputes and binds all engineering analyses without claiming physical release', () => {
    const report = evaluateRobotEngineeringAnalysisPacket(buildRobotEngineeringAnalysisPacketFixture());
    expect(report.engineeringAnalysisReady).toBe(true);
    expect(Object.values(report.componentStatus)).toEqual([true, true, true, true, true, true, true]);
    expect(report).toMatchObject({ status: 'passed', scope: { onePayloadPathCombination: true, fullRequirementsCoverageComplete: false }, externalValidationComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } });
    expect(report.applicationHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a forged or stale dynamic report before downstream evidence can pass', () => {
    const fixture = buildRobotEngineeringAnalysisPacketFixture();
    const reportValue = JSON.parse(new TextDecoder().decode(fixture.dynamicReport)) as { durationS: number };
    reportValue.durationS += 1;
    fixture.dynamicReport = new TextEncoder().encode(JSON.stringify(reportValue));
    const report = evaluateRobotEngineeringAnalysisPacket(fixture);
    expect(report.engineeringAnalysisReady).toBe(false);
    expect(report.errors).toContain('supplied dynamic report does not equal the independently recomputed report');
  });

  it('rejects a precision budget that understates computed structural compliance', () => {
    const fixture = buildRobotEngineeringAnalysisPacketFixture();
    const precision = JSON.parse(new TextDecoder().decode(fixture.precisionInput)) as { contributors: Array<{ category: string; accuracyBound: number }> };
    precision.contributors.find(item => item.category === 'structural_compliance')!.accuracyBound = 0.01;
    fixture.precisionInput = new TextEncoder().encode(JSON.stringify(precision));
    const report = evaluateRobotEngineeringAnalysisPacket(fixture);
    expect(report.componentStatus.structuralPrecisionBinding).toBe(false);
    expect(report.errors).toContain('precision structural_compliance bound is below the computed maximum TCP structural deflection');
  });

  it('rejects duty, life and model values that diverge from frozen requirements', () => {
    const fixture = buildRobotEngineeringAnalysisPacketFixture();
    const thermal = JSON.parse(new TextDecoder().decode(fixture.thermalInput)) as { dutyCycleRatio: number };
    thermal.dutyCycleRatio = 0.5;
    fixture.thermalInput = new TextEncoder().encode(JSON.stringify(thermal));
    const report = evaluateRobotEngineeringAnalysisPacket(fixture);
    expect(report.engineeringAnalysisReady).toBe(false);
    expect(report.errors).toContain('thermal duty cycle differs from the frozen performance requirement');
  });
});
