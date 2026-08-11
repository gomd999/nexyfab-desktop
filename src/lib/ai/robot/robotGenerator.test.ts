import { describe, expect, it } from 'vitest';
import { validateAiAssemblyProgram } from '../aiAssemblyProgram';
import { safeRobot } from './robotEngineering.test';
import { generateRobot6Axis } from './robotGenerator';

describe('6-axis robot generator', () => {
  it('creates seven structural parts plus eighteen explicit editable drive placeholders', () => {
    const generated = generateRobot6Axis(safeRobot);
    expect(generated.program.parts).toHaveLength(25);
    expect(new Set(generated.program.parts.map(part => part.featureTree)).size).toBe(25);
    expect(generated.program.assembly.mates).toHaveLength(60);
    expect(generated.intendedContacts).toHaveLength(24);
    expect(generated.intendedContacts.every(contact => contact.justification.includes('volumetric interference is not permitted'))).toBe(true);
    expect(generated.program.assembly.mates.filter(mate => mate.kind === 'hinge').every(mate => mate.kind === 'hinge' && mate.zeroAngleRef !== undefined)).toBe(true);
    expect(generated.program.structure).toHaveLength(7);
    expect(validateAiAssemblyProgram(generated.program)).toEqual([]);
  });
  it('does not hide unselected motors, reducers, bearings or harnesses', () => {
    const generated = generateRobot6Axis(safeRobot);
    expect(generated.program.classification).toBe('concept_only');
    expect(generated.pendingCatalogComponents).toEqual(expect.arrayContaining(['motor_j6', 'reducer_j6', 'bearing_set_j6', 'internal_harness']));
    expect(generated.program.parts.filter(part => part.metadata.source === 'assumed')).toHaveLength(25);
    expect(generated.program.parts.some(part => part.metadata.process === 'selection-required')).toBe(true);
  });
  it('places each output link after its complete coaxial drive stack', () => {
    const generated = generateRobot6Axis(safeRobot);
    for (let joint = 1; joint <= 6; joint += 1) {
      const hinge = generated.program.assembly.mates.find(mate => mate.id === `J${joint}`);
      expect(hinge).toMatchObject({
        kind: 'hinge',
        a: { partId: `J${joint}:bearing:bearing-j${joint}-unselected`, refId: 'bbox_axis_z_max' },
        b: { partId: ['base', 'shoulder', 'upper-arm', 'forearm', 'wrist-1', 'wrist-2', 'tool-flange'][joint], refId: 'bbox_axis_z_min' },
      });
      const child = generated.program.assembly.parts.find(part => part.id === hinge!.b.partId)!;
      const bearing = generated.program.assembly.parts.find(part => part.id === hinge!.a.partId)!;
      expect(child.position.z).toBe(bearing.position.z + 16);
      expect(generated.intendedContacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ partA: bearing.id, partB: child.id }),
      ]));
    }
  });
  it('rejects ambiguous or out-of-range catalog selections', () => {
    const invalid = { joint: 7 } as never;
    const duplicate = { joint: 1 } as never;
    expect(() => generateRobot6Axis(safeRobot, 'invalid', [invalid])).toThrow(/integer from 1 to 6/);
    expect(() => generateRobot6Axis(safeRobot, 'duplicate', [duplicate, duplicate])).toThrow(/Duplicate catalog selection/);
  });
});
