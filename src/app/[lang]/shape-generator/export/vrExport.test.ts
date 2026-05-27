import { describe, it, expect } from 'vitest';
import { writeUsda, writeSingleMeshUsda, type UsdMesh } from './usdaWriter';
import { writeGltf, type GltfMesh } from './gltfWriter';

// ── USDA ────────────────────────────────────────────────────────────

describe('writeUsda', () => {
  const sample: UsdMesh = {
    name: 'Cube',
    positions: [
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };

  it('emits USDA header', () => {
    const out = writeUsda([sample]);
    expect(out).toContain('#usda 1.0');
  });

  it('contains mesh name', () => {
    const out = writeUsda([sample]);
    expect(out).toContain('def Mesh "Cube"');
  });

  it('encodes vertex positions', () => {
    const out = writeUsda([sample]);
    expect(out).toContain('point3f[] points');
    expect(out).toContain('(1.0000, 0.0000, 0.0000)');
  });

  it('encodes face indices', () => {
    const out = writeUsda([sample]);
    expect(out).toContain('faceVertexIndices = [0, 1, 2, 0, 2, 3]');
  });

  it('material binding emitted when material present', () => {
    const mat: UsdMesh = {
      ...sample,
      material: {
        name: 'Steel',
        baseColor: [0.7, 0.7, 0.75],
        metalness: 1.0,
        roughness: 0.3,
      },
    };
    const out = writeUsda([mat]);
    expect(out).toContain('def Material "Steel"');
    expect(out).toContain('material:binding');
  });

  it('sanitizes invalid name characters', () => {
    const dirty: UsdMesh = { ...sample, name: 'My Part / v2.1' };
    const out = writeUsda([dirty]);
    expect(out).toContain('def Mesh "My_Part___v2_1"');
  });

  it('upAxis option propagates', () => {
    const out = writeUsda([sample], { upAxis: 'Z' });
    expect(out).toContain('upAxis = "Z"');
  });

  it('writeSingleMeshUsda is a thin wrapper', () => {
    const out = writeSingleMeshUsda(sample.positions, sample.indices);
    expect(out).toContain('def Mesh "Part"');
  });
});

// ── glTF ────────────────────────────────────────────────────────────

describe('writeGltf', () => {
  const sample: GltfMesh = {
    name: 'Cube',
    positions: [
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };

  it('produces JSON with required top-level keys', () => {
    const r = writeGltf([sample]);
    const j = r.json as Record<string, unknown>;
    expect(j.asset).toBeDefined();
    expect(j.meshes).toBeDefined();
    expect(j.accessors).toBeDefined();
    expect(j.bufferViews).toBeDefined();
    expect(j.buffers).toBeDefined();
  });

  it('binary buffer size matches schema', () => {
    const r = writeGltf([sample]);
    const buffers = (r.json as { buffers: Array<{ byteLength: number }> }).buffers;
    expect(buffers[0]!.byteLength).toBe(r.bin.byteLength);
  });

  it('accessor min/max included for positions', () => {
    const r = writeGltf([sample]);
    const accs = (r.json as { accessors: Array<{ min?: number[]; max?: number[]; type: string }> }).accessors;
    const posAcc = accs.find(a => a.type === 'VEC3' && a.min);
    expect(posAcc?.min).toEqual([0, 0, 0]);
    expect(posAcc?.max).toEqual([1, 1, 0]);
  });

  it('material exported when present', () => {
    const withMat: GltfMesh = {
      ...sample,
      material: {
        name: 'Steel',
        baseColor: [0.7, 0.7, 0.75, 1],
        metalness: 1.0,
        roughness: 0.3,
      },
    };
    const r = writeGltf([withMat]);
    const mats = (r.json as { materials?: object[] }).materials;
    expect(mats).toBeDefined();
    expect(mats).toHaveLength(1);
  });

  it('binary buffer encodes positions + indices', () => {
    const r = writeGltf([sample]);
    // 4 verts × 3 floats × 4 bytes = 48; 6 indices × 4 bytes = 24; total 72.
    expect(r.bin.byteLength).toBe(72);
  });

  it('normals + uvs emit extra accessors when present', () => {
    const full: GltfMesh = {
      ...sample,
      normals: new Array(12).fill(0),
      uvs: new Array(8).fill(0),
    };
    const r = writeGltf([full]);
    const accs = (r.json as { accessors: object[] }).accessors;
    expect(accs.length).toBeGreaterThan(2); // POS + IDX + NORM + UV
  });
});
