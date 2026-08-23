import { describe, expect, it } from 'vitest';
import { applyArchitectureInteriorEdit, type ArchitectureDocument, type InteriorDocument } from './architectureInteriorDocuments';

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 1,
  storeys: [{ id: 'ground', name: 'Ground', elevationMm: 0, heightMm: 3000 }, { id: 'upper', name: 'Upper', elevationMm: 4000, heightMm: 3000 }],
  spaces: [{ id: 'room', storeyId: 'ground', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 'slab', ceilingId: 'ceiling' }],
  walls: [
    { id: 'w1', kind: 'line', storeyId: 'ground', startMm: [0, 0], endMm: [5000, 0], thicknessMm: 200, heightMm: 3000 },
    { id: 'w2', kind: 'line', storeyId: 'ground', startMm: [5000, 0], endMm: [5000, 4000], thicknessMm: 200, heightMm: 3000 },
    { id: 'w3', kind: 'line', storeyId: 'ground', startMm: [5000, 4000], endMm: [0, 4000], thicknessMm: 200, heightMm: 3000 },
    { id: 'w4', kind: 'line', storeyId: 'ground', startMm: [0, 4000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 },
  ],
  slabs: [{ id: 'slab', storeyId: 'ground', spaceId: 'room', boundaryMm: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], thicknessMm: 200 }],
  ceilings: [{ id: 'ceiling', storeyId: 'ground', spaceId: 'room', boundaryMm: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], elevationMm: 3000, thicknessMm: 100 }],
  openings: [{ id: 'door', kind: 'door', hostWallId: 'w1', offsetMm: 1000, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [1000, 0, 0] }],
};
const interior: InteriorDocument = {
  schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'architecture',
  furniture: [{ id: 'desk', spaceId: 'room', positionMm: [2500, 2000, 500], sizeMm: [1000, 600, 750], clearanceMm: 100, rotationDeg: 0 }],
  lights: [{ id: 'light', spaceId: 'room', hostCeilingId: 'ceiling', positionMm: [2500, 2000, 2800], suspensionMm: 200, lumens: 1000, cctK: 3000 }],
  finishes: [{ id: 'finish', spaceId: 'room', hostId: 'slab', surface: 'floor', material: 'oak' }],
  millwork: [{ id: 'case', spaceId: 'room', hostWallId: 'w2', positionMm: [4500, 2000, 0], sizeMm: [400, 1000, 2000], clearanceMm: 50, material: 'oak' }],
};

const clone = () => ({ architecture: structuredClone(architecture), interior: structuredClone(interior) });

describe('architecture/interior existing-object edits', () => {
  it('edits a storey and rebases absolute hosted elevations without changing ids', () => {
    const value = clone();
    const result = applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_storey', storeyId: 'ground', name: 'Ground 1', elevationMm: 500, heightMm: 3200 });
    expect(result.architecture.storeys.find(item => item.id === 'ground')).toEqual({ id: 'ground', name: 'Ground 1', elevationMm: 500, heightMm: 3200 });
    expect(result.architecture.ceilings.find(item => item.id === 'ceiling')).toMatchObject({ id: 'ceiling', storeyId: 'ground', elevationMm: 3500 });
    expect(result.interior.lights.find(item => item.id === 'light')?.positionMm).toEqual([2500, 2000, 3300]);
    expect(result.interior.furniture.find(item => item.id === 'desk')?.positionMm[2]).toBe(500);
    expect(result.affectedObjectIds).toEqual(expect.arrayContaining(['ground', 'ceiling', 'light', 'desk', 'w1', 'room']));
    expect(result.invalidatedChecks).toEqual(expect.arrayContaining(['level_relationships', 'lighting', 'furniture_clearance']));
  });

  it('rejects a storey move that reorders/overlaps a level or shrinks below hosted geometry', () => {
    const value = clone();
    const before = structuredClone(value);
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_storey', storeyId: 'ground', elevationMm: 3500 })).toThrow(/reorder|overlap/);
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_storey', storeyId: 'ground', heightMm: 2500 })).toThrow(/wall height|hosted/);
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_storey', storeyId: 'ground', name: 'Ground' })).toThrow(/no-op/);
    expect(value).toEqual(before);
  });

  it('reassigns a space only with a complete wall/slab/ceiling/interior host rebind', () => {
    const value = clone();
    const result = applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_space', spaceId: 'room', name: 'Upper Room', storeyId: 'upper' });
    expect(result.architecture.spaces.find(item => item.id === 'room')).toMatchObject({ name: 'Upper Room', storeyId: 'upper' });
    expect(result.architecture.walls.filter(item => ['w1', 'w2', 'w3', 'w4'].includes(item.id)).every(item => item.storeyId === 'upper')).toBe(true);
    expect(result.architecture.slabs[0]).toMatchObject({ id: 'slab', storeyId: 'upper', spaceId: 'room' });
    expect(result.architecture.ceilings[0]).toMatchObject({ id: 'ceiling', storeyId: 'upper', spaceId: 'room', elevationMm: 7000 });
    expect(result.interior.lights[0]).toMatchObject({ id: 'light', spaceId: 'room', hostCeilingId: 'ceiling', positionMm: [2500, 2000, 6800] });
    expect(result.interior.furniture[0]).toMatchObject({ id: 'desk', spaceId: 'room', positionMm: [2500, 2000, 500] });
    expect(result.interior.finishes[0]).toMatchObject({ id: 'finish', spaceId: 'room', hostId: 'slab' });
    expect(result.interior.millwork?.[0]).toMatchObject({ id: 'case', spaceId: 'room', hostWallId: 'w2' });
  });

  it('rebases a self-connected hosted opening with the moved space', () => {
    const value = clone();
    value.architecture.openings[0]!.connectsSpaceIds = ['room'];
    const result = applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_space', spaceId: 'room', storeyId: 'upper' });
    expect(result.architecture.openings[0]).toMatchObject({ id: 'door', connectsSpaceIds: ['room'] });
    expect(result.architecture.spaces[0]).toMatchObject({ id: 'room', storeyId: 'upper' });
  });

  it('fails closed for cross-storey shared walls and malformed/no-op space edits', () => {
    const value = clone();
    value.architecture.spaces.push({ id: 'other', storeyId: 'ground', name: 'Other', usage: 'office', boundaryMm: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], wallIds: ['w1'], slabId: 'other-slab', ceilingId: 'other-ceiling' });
    value.architecture.slabs.push({ id: 'other-slab', storeyId: 'ground', spaceId: 'other', boundaryMm: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], thicknessMm: 200 });
    value.architecture.ceilings.push({ id: 'other-ceiling', storeyId: 'ground', spaceId: 'other', boundaryMm: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], elevationMm: 3000, thicknessMm: 100 });
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_space', spaceId: 'room', storeyId: 'upper' })).toThrow(/shared wall/);
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_space', spaceId: 'room' })).toThrow(/supported field/);
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_space', spaceId: 'room', name: 'Room' })).toThrow(/no-op/);
  });

  it('recomputes dependent opening and light geometry while preserving ids', () => {
    const value = clone();
    const opening = applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_opening', openingId: 'door', offsetMm: 2000 });
    expect(opening.architecture.openings[0]).toMatchObject({ offsetMm: 2000, positionMm: [2000, 0, 0] });
    const light = applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_light', lightId: 'light', suspensionMm: 400 });
    expect(light.interior.lights[0]?.positionMm[2]).toBe(2600);
    expect(light.affectedObjectIds).toEqual(expect.arrayContaining(['light']));
  });

  it('rejects furniture envelopes outside the host space/storey and preserves source inputs', () => {
    const value = clone(); const before = structuredClone(value.interior);
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_furniture', furnitureId: 'desk', positionMm: [300, 300, 500], rotationDeg: 45 })).toThrow(/envelope/);
    expect(value.interior).toEqual(before);
  });

  it('rejects host-kind and millwork storey mismatches atomically', () => {
    const value = clone();
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_finish', finishId: 'finish', hostId: 'w1' })).toThrow(/surface kind/);
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_millwork', millworkId: 'case', hostWallId: 'w1', spaceId: 'room' })).not.toThrow();
    value.interior.millwork![0]!.spaceId = 'room'; value.interior.millwork![0]!.hostWallId = 'w1';
    value.architecture.spaces[0]!.storeyId = 'upper';
    expect(() => applyArchitectureInteriorEdit(value.architecture, value.interior, { kind: 'edit_millwork', millworkId: 'case', hostWallId: 'w2' })).toThrow(/storey/);
  });
});
