import { describe, expect, it } from 'vitest';
import { validateAiAssemblyProgram } from '../aiAssemblyProgram';
import { safeRobot } from './robotEngineering.test';
import { generateRobot6Axis } from './robotGenerator';

describe('6-axis robot generator', () => {
  it('creates seven independent editable structural parts and six hinge joints', () => {
    const generated = generateRobot6Axis(safeRobot);
    expect(generated.program.parts).toHaveLength(7);
    expect(new Set(generated.program.parts.map(part => part.featureTree)).size).toBe(7);
    expect(generated.program.assembly.mates).toHaveLength(6);
    expect(validateAiAssemblyProgram(generated.program)).toEqual([]);
  });
  it('does not hide unselected motors, reducers, bearings or harnesses', () => {
    const generated = generateRobot6Axis(safeRobot);
    expect(generated.program.classification).toBe('concept_only');
    expect(generated.pendingCatalogComponents).toEqual(expect.arrayContaining(['motor_j6', 'reducer_j6', 'bearing_set_j6', 'internal_harness']));
  });
});
