import { describe, it, expect } from 'vitest';
import {
  buildUsdaText,
  buildUsdzPackage,
  exportSceneToUsdz,
  crc32,
  type UsdScene,
} from './usdzWriter';

const simpleScene: UsdScene = {
  nodes: [
    {
      name: 'Box',
      mesh: {
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        indices: [0, 1, 2, 0, 2, 3],
      },
      materialId: 'mat1',
    },
  ],
  materials: [
    { id: 'mat1', name: 'Red', diffuseColor: [1, 0, 0], roughness: 0.5 },
  ],
};

describe('buildUsdaText', () => {
  it('emits #usda header', () => {
    const text = buildUsdaText(simpleScene);
    expect(text.startsWith('#usda 1.0')).toBe(true);
  });

  it('includes defaultPrim', () => {
    expect(buildUsdaText(simpleScene)).toContain('defaultPrim = "Root"');
  });

  it('emits Mesh definition', () => {
    const text = buildUsdaText(simpleScene);
    expect(text).toContain('def Mesh "Box"');
  });

  it('includes points + faceVertexCounts + faceVertexIndices', () => {
    const text = buildUsdaText(simpleScene);
    expect(text).toContain('point3f[] points');
    expect(text).toContain('faceVertexCounts');
    expect(text).toContain('faceVertexIndices');
  });

  it('emits material', () => {
    const text = buildUsdaText(simpleScene);
    expect(text).toContain('def Material "mat1"');
    expect(text).toContain('UsdPreviewSurface');
  });

  it('sanitizes invalid identifier chars', () => {
    const scene: UsdScene = {
      ...simpleScene,
      nodes: [{ ...simpleScene.nodes[0]!, name: 'My-Box 1!' }],
    };
    const text = buildUsdaText(scene);
    expect(text).toContain('def Mesh "My_Box_1_"');
  });

  it('upAxis = Y by default', () => {
    expect(buildUsdaText(simpleScene)).toContain('upAxis = "Y"');
  });
});

describe('crc32', () => {
  it('CRC of empty buffer = 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('CRC of "123456789" = 0xCBF43926', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xCBF43926);
  });
});

describe('buildUsdzPackage', () => {
  it('produces a non-empty byte stream', () => {
    const pkg = buildUsdzPackage([
      { name: 'model.usda', data: new TextEncoder().encode('#usda 1.0\n') },
    ]);
    expect(pkg.bytes.length).toBeGreaterThan(0);
  });

  it('starts with PK magic number', () => {
    const pkg = buildUsdzPackage([
      { name: 'model.usda', data: new TextEncoder().encode('#usda 1.0\n') },
    ]);
    expect(pkg.bytes[0]).toBe(0x50); // P
    expect(pkg.bytes[1]).toBe(0x4b); // K
  });

  it('preserves assets list', () => {
    const pkg = buildUsdzPackage([
      { name: 'model.usda', data: new Uint8Array([1, 2, 3]) },
      { name: 'tex.png', data: new Uint8Array([4, 5, 6]) },
    ]);
    expect(pkg.assets).toHaveLength(2);
  });
});

describe('exportSceneToUsdz', () => {
  it('returns valid package', () => {
    const pkg = exportSceneToUsdz(simpleScene);
    expect(pkg.bytes.length).toBeGreaterThan(0);
    expect(pkg.assets).toHaveLength(1);
    expect(pkg.assets[0]!.name).toBe('model.usda');
  });

  it('first asset contains USDA text', () => {
    const pkg = exportSceneToUsdz(simpleScene);
    const text = new TextDecoder().decode(pkg.assets[0]!.data);
    expect(text).toContain('#usda 1.0');
  });

  it('custom entry name honored', () => {
    const pkg = exportSceneToUsdz(simpleScene, 'scene.usda');
    expect(pkg.assets[0]!.name).toBe('scene.usda');
  });
});

describe('mesh with normals + UVs', () => {
  it('emits primvars:normals when normals present', () => {
    const scene: UsdScene = {
      nodes: [{
        name: 'M',
        mesh: {
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
        },
      }],
      materials: [],
    };
    expect(buildUsdaText(scene)).toContain('primvars:normals');
  });

  it('emits primvars:st when UVs present', () => {
    const scene: UsdScene = {
      nodes: [{
        name: 'M',
        mesh: {
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          uvs: [0, 0, 1, 0, 0, 1],
        },
      }],
      materials: [],
    };
    expect(buildUsdaText(scene)).toContain('primvars:st');
  });
});
