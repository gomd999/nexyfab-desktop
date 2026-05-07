import { describe, it, expect } from 'vitest';
import { assemblySnapshotJsonLooksValid, nfabProjectExportJsonLooksValid } from '@/lib/nfAssemblySnapshotGuards';

describe('M0 assembly snapshot JSON guards', () => {
  it('accepts minimal placedParts + mates arrays', () => {
    expect(assemblySnapshotJsonLooksValid(JSON.stringify({ placedParts: [], mates: [] }))).toBe(true);
  });

  it('rejects non-array placedParts', () => {
    expect(assemblySnapshotJsonLooksValid(JSON.stringify({ placedParts: {}, mates: [] }))).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(assemblySnapshotJsonLooksValid('not json')).toBe(false);
  });
});

describe('M0 nfab export JSON guard', () => {
  it('accepts minimal nfab v1 shape', () => {
    const minimal = JSON.stringify({
      magic: 'nfab',
      version: 1,
      tree: { nodes: [], rootId: 'r', activeNodeId: 'r' },
      scene: { selectedId: 'box', params: {}, paramExpressions: {}, materialId: 'al', color: '#fff', isSketchMode: false, sketchPlane: 'xy', sketchProfile: { segments: [] }, sketchConfig: {} },
    });
    expect(nfabProjectExportJsonLooksValid(minimal)).toBe(true);
  });

  it('rejects bad assembly.placedParts', () => {
    const bad = JSON.stringify({
      magic: 'nfab',
      version: 1,
      tree: { nodes: [], rootId: 'r', activeNodeId: 'r' },
      scene: { selectedId: 'box', params: {}, paramExpressions: {}, materialId: 'al', color: '#fff', isSketchMode: false, sketchPlane: 'xy', sketchProfile: { segments: [] }, sketchConfig: {} },
      assembly: { placedParts: {}, mates: [] },
    });
    expect(nfabProjectExportJsonLooksValid(bad)).toBe(false);
  });
});
