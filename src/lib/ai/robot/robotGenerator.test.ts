import { describe, expect, it } from 'vitest';
import { validateAiAssemblyProgram } from '../aiAssemblyProgram';
import { safeRobot } from './robotEngineering.test';
import { generateRobot6Axis, type RobotAuxiliarySelection } from './robotGenerator';

const auxiliarySelections = (): RobotAuxiliarySelection[] => {
  const common = { manufacturer: 'Maker', revision: 'A', source: 'manufacturer datasheet', artifactHash: 'a'.repeat(64), massSource: 'confirmed' as const, interface: { axisRef: 'axis', mountingPlaneRef: 'face' } };
  const mount = (parentPartId: string, z: number) => ({ parentPartId, parentAxisRef: 'bbox_axis_z_max', parentPlaneRef: 'f.cap.top', positionMm: { x: 0, y: 0, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  return [
    { kind: 'brake', component: { ...common, id: 'BR', model: 'Brake', kind: 'brake', massKg: 0.8, envelopeMm: { x: 70, y: 70, z: 30 }, holdingTorqueNm: 50, maxRpm: 5000, ratedVoltageV: 24, releasePowerW: 20, responseTimeMs: 50 }, mount: mount('base', 100), evidence: ['explicit approved brake selection'] },
    { kind: 'encoder', component: { ...common, id: 'EN', model: 'Encoder', kind: 'encoder', massKg: 0.2, envelopeMm: { x: 50, y: 50, z: 20 }, resolutionBits: 20, accuracyArcsec: 30, maxRpm: 6000, supplyVoltageV: 5 }, mount: mount('shoulder', 200), evidence: ['explicit approved encoder selection'] },
    { kind: 'harness', component: { ...common, id: 'HA', model: 'Harness', kind: 'harness', massKg: 1, envelopeMm: { x: 20, y: 20, z: 500 }, conductorCount: 20, ratedVoltageV: 300, ratedCurrentA: 5, outerDiameterMm: 12, minimumBendRadiusMm: 80, flexLifeCycles: 10_000_000 }, mount: mount('upper-arm', 300), evidence: ['explicit approved harness selection'] },
    { kind: 'tool_connector', component: { ...common, id: 'TC', model: 'Tool connector', kind: 'tool_connector', massKg: 0.3, envelopeMm: { x: 60, y: 60, z: 30 }, contactCount: 12, ratedVoltageV: 60, ratedCurrentA: 3, matingCycles: 10_000, ipRating: 'IP67' }, mount: mount('tool-flange', 900), evidence: ['explicit approved tool connector selection'] },
  ];
};

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
    expect(generated.pendingCatalogComponents).toHaveLength(22);
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
  it('adds all four explicitly selected auxiliary occurrences as catalog CAD and clears only those blockers', () => {
    const generated = generateRobot6Axis(safeRobot, 'auxiliary-complete', [], auxiliarySelections());
    expect(generated.program.parts).toHaveLength(29); expect(generated.program.assembly.parts).toHaveLength(29); expect(generated.program.assembly.mates).toHaveLength(68);
    expect(generated.program.structure).toHaveLength(8); expect(generated.program.structure?.at(-1)).toMatchObject({ id: 'robot-auxiliary', instanceIds: ['AUX:brake:BR', 'AUX:encoder:EN', 'AUX:harness:HA', 'AUX:tool_connector:TC'] });
    expect(generated.pendingCatalogComponents).toHaveLength(18);
    expect(generated.pendingCatalogComponents).not.toEqual(expect.arrayContaining(['brake', 'encoder', 'internal_harness', 'tool_connector']));
    expect(generated.program.unresolved.join(' ')).not.toMatch(/brake|encoder|internal_harness|tool_connector/);
    expect(generated.program.parts.filter(part => part.metadata.source === 'catalog')).toHaveLength(4);
    expect(validateAiAssemblyProgram(generated.program)).toEqual([]);
  });
  it('rejects partial auxiliary selections instead of adding or auto-selecting a subset', () => {
    expect(() => generateRobot6Axis(safeRobot, 'partial-auxiliary', [], auxiliarySelections().slice(0, 3))).toThrow(/exactly four explicit selections or none/);
  });
});
