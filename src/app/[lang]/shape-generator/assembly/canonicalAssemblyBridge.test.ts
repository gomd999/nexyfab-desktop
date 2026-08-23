import { describe, expect, it } from 'vitest';
import type { AssemblyMate } from './AssemblyMates';
import type { PlacedPart } from './PartPlacementPanel';
import { canonicalAssemblyToLegacy, legacyAssemblyToCanonical, placedPartSemanticRefs } from './canonicalAssemblyBridge';
import { featureTreeGeometryResolver } from '@/lib/assembly/geometryResolver';

const parts: PlacedPart[] = [
  { id: 'base', name: 'Base', shapeId: 'box', params: { width: 20 }, qty: 1, position: [1, 2, 3], rotation: [0, 0, 90] },
  { id: 'pin', name: 'Pin', shapeId: 'cylinder', params: {}, qty: 1, position: [4, 5, 6], rotation: [0, 0, 0] },
];

describe('canonical assembly bridge', () => {
  it('round-trips supported mates and transform metadata', () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', type: 'concentric', partA: 'base', partB: 'pin', faceA: 2, faceB: 3, locked: false },
      { id: 'm2', type: 'distance', partA: 'base', partB: 'pin', faceA: 4, faceB: 5, value: 8, locked: true },
    ];
    const canonical = legacyAssemblyToCanonical(parts, mates);
    expect(canonical.state.parts[0].fixed).toBe(true);
    expect(canonical.state.mates).toHaveLength(2);
    expect(canonical.issues.every(issue => issue.code === 'DERIVED_TOPOLOGY_REFERENCE')).toBe(true);
    const resolver = featureTreeGeometryResolver(new Map([
      ['base', { nodes: [] }],
      ['pin', { nodes: [] }],
    ]));
    const partById = new Map(canonical.state.parts.map(part => [part.id, part]));
    for (const mate of canonical.state.mates) {
      expect(resolver(mate.a, partById.get(mate.a.partId)!)).not.toBeNull();
      expect(resolver(mate.b, partById.get(mate.b.partId)!)).not.toBeNull();
    }
    const legacy = canonicalAssemblyToLegacy(canonical.state, parts, mates);
    expect(legacy.assemblyMates).toMatchObject(mates);
    expect(legacy.placedParts[0]).toMatchObject({ id: 'base', shapeId: 'box', position: [1, 2, 3] });
    expect(legacy.placedParts[0].rotation[2]).toBeCloseTo(90);
  });

  it('retains unsupported legacy mates and reports a blocking issue', () => {
    const widthMate: AssemblyMate = {
      id: 'width-1', type: 'width', partA: 'base', partB: 'pin', faceA: 1, faceA2: 2, faceB: 3, locked: false,
    };
    const canonical = legacyAssemblyToCanonical(parts, [widthMate]);
    expect(canonical.state.mates).toEqual([]);
    expect(canonical.issues).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_LEGACY_MATE', blocking: true }));
    const legacy = canonicalAssemblyToLegacy(canonical.state, parts, [widthMate]);
    expect(legacy.assemblyMates).toEqual([widthMate]);
  });

  it('never silently maps a canonical rack-and-pinion mate', () => {
    const canonical = legacyAssemblyToCanonical(parts, []).state;
    const result = canonicalAssemblyToLegacy({
      ...canonical,
      mates: [{
        id: 'rack-1', kind: 'rack_pinion',
        a: { partId: 'base', refId: 'axis:0', refKind: 'axis' },
        b: { partId: 'pin', refId: 'edge:0', refKind: 'edge' },
        pinionRadius: 10,
      }],
    }, parts, []);
    expect(result.assemblyMates).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_CANONICAL_MATE', blocking: true }));
  });

  it('owns gear and rack paths as stable semantic references', () => {
    const gearRefs = placedPartSemanticRefs({
      id: 'gear', name: 'Gear', shapeId: 'gear', params: { teeth: 24, module: 2, width: 15, boreDiameter: 10, pressureAngle: 20 },
      qty: 1, position: [0, 0, 0], rotation: [0, 0, 0],
    });
    expect(gearRefs.rotation_axis).toMatchObject({ kind: 'axis', direction: { z: 1 } });
    expect(gearRefs.pitch_point).toMatchObject({ kind: 'point', origin: { x: 24 } });
    const rackRefs = placedPartSemanticRefs({
      id: 'rack', name: 'Rack', shapeId: 'box', params: { width: 100, height: 20, depth: 10 },
      qty: 1, position: [0, 0, 0], rotation: [0, 0, 0],
    });
    expect(rackRefs.rack_path).toMatchObject({ kind: 'axis', origin: { x: -50, y: 10 }, direction: { x: 1 } });
  });

  it('maps a legacy gear pair to semantic axes without derived topology', () => {
    const gears: PlacedPart[] = [0, 1].map(index => ({
      id: `g${index}`, name: `Gear ${index}`, shapeId: 'gear',
      params: { teeth: 24, module: 2, width: 15, boreDiameter: 10, pressureAngle: 20 },
      qty: 1, position: [index * 48, 0, 0], rotation: [0, 0, 0],
    }));
    const result = legacyAssemblyToCanonical(gears, [{
      id: 'gear-mate', type: 'gear', partA: 'g0', partB: 'g1', value: 1, locked: false,
    }]);
    expect(result.issues).toEqual([]);
    expect(result.state.mates[0]).toMatchObject({
      a: { refId: 'rotation_axis', refKind: 'axis' },
      b: { refId: 'rotation_axis', refKind: 'axis' },
    });
  });
});
