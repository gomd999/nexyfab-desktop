import { describe, expect, it } from 'vitest';
import type { NfabProjectV1 } from './nfabFormat';
import {
  buildCadRevisionManifest,
  cadRevisionManifestSha256,
  canonicalizeNfabDesign,
  hashNfabCanonicalDesign,
} from './nfabRevisionManifest';

const project = (overrides: Partial<NfabProjectV1> = {}): NfabProjectV1 => ({
  magic: 'nfab', version: 3, createdAt: 1, updatedAt: 2, name: 'Fixture', thumbnail: 'data:image/png;base64,AQ==',
  tree: { nodes: [], rootId: 'root', activeNodeId: 'root' },
  scene: {
    selectedId: 'box', params: { width: 40, height: 20 }, paramExpressions: {}, materialId: 'steel', color: '#888888',
    isSketchMode: false, sketchPlane: 'xy', sketchProfile: { segments: [], closed: false }, sketchConfig: { mode: 'extrude', depth: 10, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
    renderMode: 'standard', cameraPosition: undefined,
  } as NfabProjectV1['scene'],
  referenceGeometry: [],
  ...overrides,
});

const bytes = (value: NfabProjectV1, pretty = false) => new TextEncoder().encode(pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));

describe('.nfab immutable revision manifest', () => {
  it('keeps exact artifact hash separate from canonical design hash', async () => {
    const a = project();
    const b = project({ createdAt: 100, updatedAt: 200, name: 'Renamed', thumbnail: undefined });
    const ma = await buildCadRevisionManifest({ artifactBytes: bytes(a), revisionId: 'r1', parentManifestSha256: null, kernelStackIdentitySha256: 'a'.repeat(64), createdAt: '2026-08-09T00:00:00.000Z' });
    const mb = await buildCadRevisionManifest({ artifactBytes: bytes(b, true), revisionId: 'r2', parentManifestSha256: await cadRevisionManifestSha256(ma), kernelStackIdentitySha256: 'a'.repeat(64), createdAt: '2026-08-09T00:01:00.000Z' });
    expect(ma.artifactSha256).not.toBe(mb.artifactSha256);
    expect(ma.canonicalDesignSha256).toBe(mb.canonicalDesignSha256);
    expect(mb.parentManifestSha256).toBe(await cadRevisionManifestSha256(ma));
  });

  it('changes the design hash for parameter, feature order and assembly changes', async () => {
    const base = project();
    const parameter = project({ scene: { ...base.scene, params: { ...base.scene.params, width: 41 } } });
    const tree = project({ tree: { ...base.tree, nodes: [{ id: 'feature-1' } as never] } });
    const assembly = project({ assembly: { placedParts: [{ id: 'p1' } as never], mates: [] } });
    const hashes = await Promise.all([base, parameter, tree, assembly].map(hashNfabCanonicalDesign));
    expect(new Set(hashes).size).toBe(4);
  });

  it('is deterministic across object key insertion order and normalizes negative zero', () => {
    const a = project({ scene: { ...project().scene, params: { width: 40, depth: -0 } } });
    const b = project({ scene: { ...project().scene, params: { depth: 0, width: 40 } } });
    expect(canonicalizeNfabDesign(a)).toBe(canonicalizeNfabDesign(b));
  });

  it('rejects malformed parent/kernel hashes and never mutates source bytes', async () => {
    const source = bytes(project());
    const before = source.slice();
    await expect(buildCadRevisionManifest({ artifactBytes: source, revisionId: 'r1', parentManifestSha256: 'bad', kernelStackIdentitySha256: 'a'.repeat(64) })).rejects.toThrow('CAD_PARENT_MANIFEST_SHA256_INVALID');
    expect(source).toEqual(before);
  });

  it('requires exact v3 artifact bytes instead of silently hashing a migrated legacy file', async () => {
    const legacy = new TextEncoder().encode(JSON.stringify({ ...project(), version: 2 }));
    await expect(buildCadRevisionManifest({
      artifactBytes: legacy,
      revisionId: 'legacy',
      parentManifestSha256: null,
      kernelStackIdentitySha256: 'a'.repeat(64),
    })).rejects.toThrow('CAD_PROJECT_FORMAT_VERSION_NOT_CURRENT');
  });
});
