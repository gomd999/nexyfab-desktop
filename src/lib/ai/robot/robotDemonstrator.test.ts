import { describe, expect, it } from 'vitest';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from './robotDemonstrator';
import { generateRobot6Axis } from './robotGenerator';
import { verifyRobotEngineering } from './robotEngineering';

describe('non-holdout 6-axis demonstrator', () => {
  it('produces a complete editable decomposition without claiming production readiness', () => {
    const generated = generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC, 'test demonstrator');
    const engineering = verifyRobotEngineering(ROBOT_6AXIS_DEMONSTRATOR_SPEC);

    expect(generated.program.parts).toHaveLength(25);
    expect(generated.program.parts.every(part => Object.keys(part.featureTree).length > 0)).toBe(true);
    expect(generated.program.assembly.mates).toHaveLength(60);
    expect(generated.program.structure).toHaveLength(7);
    expect(generated.program.classification).toBe('concept_only');
    expect(generated.pendingCatalogComponents).toHaveLength(22);
    expect(engineering.designOk).toBe(true);
    expect(engineering.workspace.sampledPoses).toBe(24);
  });
});
