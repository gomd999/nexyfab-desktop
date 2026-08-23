import { describe, expect, it } from 'vitest';
import { verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';
import { buildValidRobotSystemRequirementsFixture } from './robotSystemRequirements.testFixture';

function bytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }

describe('robot system requirements v2', () => {
  it('passes a frozen, authoritative, cross-field-consistent six-axis requirement set', () => {
    const report = verifyRobotSystemRequirementsBytes(bytes(buildValidRobotSystemRequirementsFixture()));
    expect(report).toMatchObject({ requirementsReady: true, status: 'passed', productId: 'robot-medium-01', lineageId: 'robot-medium', revision: 1, releaseReady: false, counts: { joints: 6, payloadCases: 3, governedPaths: 1, hazards: 1, safetyFunctions: 1, manufacturingAuthorities: 4 }, sideEffects: { persisted: false, cadModified: false } });
    expect(report.frozenRequirementsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.errors).toEqual([]);
  });

  it('is canonical across JSON object key ordering while preserving the raw-byte hash', () => {
    const first = buildValidRobotSystemRequirementsFixture();
    const { authority: rootAuthority, ...rest } = first;
    const second = { authority: rootAuthority, ...rest };
    const a = verifyRobotSystemRequirementsBytes(bytes(first));
    const b = verifyRobotSystemRequirementsBytes(bytes(second));
    expect(a.frozenRequirementsSha256).toBe(b.frozenRequirementsSha256);
    expect(a.requirementsSha256).not.toBe(b.requirementsSha256);
  });

  it('rejects duplicate joints, an unphysical payload and a safety function with an unknown hazard', () => {
    const value = buildValidRobotSystemRequirementsFixture();
    value.mechanics.jointRanges[5]!.joint = 5;
    value.mechanics.payloadCases[1]!.inertiaKgM2 = { ixx: 0.01, iyy: 0.01, izz: 1, ixy: 0, ixz: 0, iyz: 0 };
    value.safety.safetyFunctions[0]!.hazardIds = ['hazard-missing'];
    const report = verifyRobotSystemRequirementsBytes(bytes(value));
    expect(report.requirementsReady).toBe(false);
    expect(report.frozenRequirementsSha256).toBeNull();
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('mechanics.jointRanges must contain each governed joint J1..J6 exactly once'),
      expect.stringContaining('payload-rated: inertia tensor is not physically admissible'),
      expect.stringContaining('unknown hazard hazard-missing'),
      expect.stringContaining('hazard-crush: every hazard must be linked'),
    ]));
  });

  it('rejects power, environment and manufacturing-authority contradictions', () => {
    const value = buildValidRobotSystemRequirementsFixture();
    value.environment.maximumTemperatureC = value.environment.minimumTemperatureC;
    value.environment.expectedLifeCycles = 5;
    value.power.peakPowerW = 1_000;
    value.power.regenerative = { enabled: false, maximumReturnPowerW: 10 };
    value.manufacturing.authorities[3]!.subject = 'materials';
    const report = verifyRobotSystemRequirementsBytes(bytes(value));
    expect(report.requirementsReady).toBe(false);
    expect(report.errors.join('\n')).toMatch(/minimum environment temperature/);
    expect(report.errors.join('\n')).toMatch(/expected life cycles/);
    expect(report.errors.join('\n')).toMatch(/peak power/);
    expect(report.errors.join('\n')).toMatch(/regenerative enabled state/);
    expect(report.errors.join('\n')).toMatch(/manufacturing authorities/);
  });

  it('rejects an invalid approval artifact hash before it can be frozen', () => {
    const value = buildValidRobotSystemRequirementsFixture();
    value.authority = { ...value.authority, sourceArtifactSha256: 'not-a-hash' };
    const report = verifyRobotSystemRequirementsBytes(bytes(value));
    expect(report.requirementsReady).toBe(false);
    expect(report.frozenRequirementsSha256).toBeNull();
    expect(report.errors.join('\n')).toMatch(/requirements.authority.sourceArtifactSha256/);
  });

  it('rejects malformed bytes without side effects', () => {
    const report = verifyRobotSystemRequirementsBytes(new Uint8Array([0xff, 0x00]));
    expect(report).toMatchObject({ requirementsReady: false, status: 'failed', frozenRequirementsSha256: null, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } });
    expect(report.errors).toContain('requirements must be valid UTF-8 JSON');
  });
});
