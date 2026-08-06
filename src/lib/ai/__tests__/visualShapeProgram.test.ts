import { describe, expect, it } from 'vitest';
import { validateVisualShapeProgram, type VisualShapeProgram } from '../visualShapeProgram';

const scene: VisualShapeProgram = {
  version: 1,
  classification: 'concept_only',
  name: 'NX Jet shape study',
  units: 'mm',
  view: { preset: 'cutaway', exploded: 0 },
  parts: [
    {
      id: 'fuselage', name: 'Lofted fuselage', role: 'outer_shell', cutaway: true,
      material: { color: '#252a31', metalness: 0.7, roughness: 0.32, opacity: 0.72 },
      geometry: { kind: 'loft', sections: [
        { z: 0, profile: [[0, 1], [1, 0], [0, -1], [-1, 0]] },
        { z: 100, profile: [[0, 8], [10, 0], [0, -6], [-10, 0]] },
        { z: 300, profile: [[0, 1], [1, 0], [0, -1], [-1, 0]] },
      ] },
    },
    {
      id: 'engine_left', name: 'Left engine', role: 'propulsion',
      material: { color: '#8b9199', metalness: 0.9, roughness: 0.25 },
      geometry: { kind: 'revolve', profile: [[0, 0], [12, 0], [14, 40], [10, 90], [0, 90]] },
    },
    {
      id: 'engine_right', name: 'Right engine', role: 'propulsion', mirrorOf: 'engine_left',
      material: { color: '#8b9199', metalness: 0.9, roughness: 0.25 },
      geometry: { kind: 'revolve', profile: [[0, 0], [12, 0], [14, 40], [10, 90], [0, 90]] },
    },
  ],
};

describe('validateVisualShapeProgram', () => {
  it('accepts a coherent multi-part cutaway concept', () => {
    expect(validateVisualShapeProgram(scene)).toEqual([]);
  });

  it('never accepts a visual scene as manufacturing verified', () => {
    const invalid = { ...scene, classification: 'manufacturing_verified' } as unknown as VisualShapeProgram;
    expect(validateVisualShapeProgram(invalid)).toContainEqual({
      path: 'classification', message: 'visual scenes must remain concept_only',
    });
  });

  it('rejects mismatched loft section topology and broken mirrors', () => {
    const invalid: VisualShapeProgram = {
      ...scene,
      parts: [{ ...scene.parts[0], mirrorOf: 'missing', geometry: { kind: 'loft', sections: [
        { z: 0, profile: [[0, 0], [1, 0], [0, 1]] },
        { z: 10, profile: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      ] } }],
    };
    const paths = validateVisualShapeProgram(invalid).map(issue => issue.path);
    expect(paths).toContain('parts[0].geometry.sections');
    expect(paths).toContain('parts[0].mirrorOf');
  });
});
