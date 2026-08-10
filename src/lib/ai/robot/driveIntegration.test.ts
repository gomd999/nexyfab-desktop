import { describe, expect, it } from 'vitest';
import { din625BearingCatalog, type CatalogComponent } from './componentCatalog';
import { selectRobotDriveTrain } from './componentSelector';
import { deriveJointSelectionRequirements, evaluateSelectedDriveHousing } from './driveIntegration';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from './robotDemonstrator';
import { verifyRobotEngineering } from './robotEngineering';
import { generateRobot6Axis } from './robotGenerator';

const base = { manufacturer: 'fixture', revision: 'A', source: 'verified fixture datasheet', artifactHash: 'abcdef123456', massSource: 'confirmed' as const, interface: { axisRef: 'z_axis', mountingPlaneRef: 'xy_plane', shaftDiameterMm: 20 } };
const catalog: CatalogComponent[] = [
  { ...base, id: 'M1', model: 'M1', kind: 'motor', massKg: 1, envelopeMm: { x: 60, y: 60, z: 100 }, ratedTorqueNm: 2, peakTorqueNm: 4, maxRpm: 10000, rotorInertiaKgM2: 0.001 },
  { ...base, id: 'R1', model: 'R1', kind: 'reducer', massKg: 2, envelopeMm: { x: 90, y: 90, z: 80 }, ratio: 100, ratedOutputTorqueNm: 200, peakOutputTorqueNm: 300, maxInputRpm: 12000, efficiency: 0.8, backlashArcmin: 3 },
  ...din625BearingCatalog(),
];

describe('robot drive integration gates', () => {
  it('derives six explicit, non-zero catalog requirements from engineering evidence', () => {
    const result = deriveJointSelectionRequirements(ROBOT_6AXIS_DEMONSTRATOR_SPEC, verifyRobotEngineering(ROBOT_6AXIS_DEMONSTRATOR_SPEC));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requirements).toHaveLength(6);
      expect(result.requirements.map(item => item.requiredOutputTorqueNm)).toEqual([60, 80, 45, 20, 12, 8]);
    }
  });

  it('refuses catalog selection when speed, load or shaft requirements are absent', () => {
    const spec = { ...ROBOT_6AXIS_DEMONSTRATOR_SPEC, joints: ROBOT_6AXIS_DEMONSTRATOR_SPEC.joints.map((joint, index) => index === 5 ? { ...joint, radialLoadN: undefined } : joint) };
    expect(deriveJointSelectionRequirements(spec, verifyRobotEngineering(spec))).toMatchObject({ ok: false, errors: [expect.stringContaining('J6')] });
  });

  it('fails a small wrist housing and passes a traceable large housing without claiming release', () => {
    const requirements = deriveJointSelectionRequirements(ROBOT_6AXIS_DEMONSTRATOR_SPEC, verifyRobotEngineering(ROBOT_6AXIS_DEMONSTRATOR_SPEC));
    expect(requirements.ok).toBe(true);
    if (!requirements.ok) return;
    const selected = selectRobotDriveTrain([requirements.requirements[5]!], catalog);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const generated = generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC, 'selected J6', selected.selections);
    expect(generated.program.parts.filter(part => part.instanceId.startsWith('J6:')).every(part => part.metadata.source === 'catalog')).toBe(true);
    expect(generated.pendingCatalogComponents).not.toEqual(expect.arrayContaining(['motor_j6', 'reducer_j6', 'bearing_set_j6']));
    const common = { joint: 6, radialClearanceMm: 2, axialClearanceMm: 3, source: 'fixture housing drawing', artifactHash: '1'.repeat(64) };
    expect(evaluateSelectedDriveHousing(selected.selections, [{ ...common, internalMm: { x: 80, y: 80, z: 100 } }])[0]).toMatchObject({ status: 'failed' });
    expect(evaluateSelectedDriveHousing(selected.selections, [{ ...common, internalMm: { x: 100, y: 100, z: 210 } }])[0]).toMatchObject({ status: 'passed', requiredInternalMm: { x: 94, y: 94 } });
  });
});
