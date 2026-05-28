import { describe, it, expect } from 'vitest';
import {
  parseProject,
  NFAB_FORMAT_VERSION,
  NfabParseError,
  serializeProject,
  toJsonString,
  migrateV2ToV3,
} from '../nfabFormat';
import type { ReferenceNode } from '../../referenceGeometry/types';

const MINIMAL_V1 = {
  magic: 'nfab',
  version: 1,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  name: 'Untitled',
  tree: { nodes: [], rootId: 'r', activeNodeId: 'r' },
  scene: {
    selectedId: 'box',
    params: { width: 10, height: 10, depth: 10 },
    paramExpressions: {},
    materialId: 'aluminum',
    color: '#888',
    isSketchMode: false,
    sketchPlane: 'xy',
    sketchProfile: { closed: false, segments: [] },
    sketchConfig: { mode: 'extrude', depth: 10 },
  },
};

describe('nfabFormat v1 → v2 → v3 migration', () => {
  it('current build constant is v3', () => {
    expect(NFAB_FORMAT_VERSION).toBe(3);
  });

  it('parses a v1 file and bumps version to 3 (full chain)', () => {
    const json = JSON.stringify(MINIMAL_V1);
    const parsed = parseProject(json);
    expect(parsed.version).toBe(3);
    expect(parsed.magic).toBe('nfab');
    expect(parsed.tree.nodes).toEqual([]);
  });

  it('v1 file gets default empty aiHistory + scadIntents + referenceGeometry', () => {
    const json = JSON.stringify(MINIMAL_V1);
    const parsed = parseProject(json);
    expect(parsed.aiHistory).toEqual([]);
    expect(parsed.scadIntents).toEqual({});
    expect(parsed.referenceGeometry).toEqual([]);
  });

  it('preserves existing v2 fields when migrating v2 → v3', () => {
    const v2 = {
      ...MINIMAL_V1,
      version: 2,
      aiHistory: [{ ts: 123, prompt: 'M8 bolt', summary: 'a bolt' }],
      scadIntents: { node1: { shapeId: 'bolt' } },
    };
    const parsed = parseProject(JSON.stringify(v2));
    expect(parsed.version).toBe(3);
    expect(parsed.aiHistory).toHaveLength(1);
    expect(parsed.aiHistory?.[0]?.prompt).toBe('M8 bolt');
    expect(parsed.scadIntents).toEqual({ node1: { shapeId: 'bolt' } });
    expect(parsed.referenceGeometry).toEqual([]);
  });

  it('rejects unknown version', () => {
    const future = { ...MINIMAL_V1, version: 99 };
    expect(() => parseProject(JSON.stringify(future))).toThrow(NfabParseError);
  });

  it('forward-version error tells the user to update (not a cryptic error)', () => {
    const future = { ...MINIMAL_V1, version: 99 };
    try {
      parseProject(JSON.stringify(future));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/newer version/i);
      expect((e as Error).message).toMatch(/update/i);
    }
  });

  it('rejects negative or zero version', () => {
    const bad = { ...MINIMAL_V1, version: 0 };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
    const negative = { ...MINIMAL_V1, version: -1 };
    expect(() => parseProject(JSON.stringify(negative))).toThrow(NfabParseError);
  });

  it('rejects malformed scadIntents', () => {
    const bad = { ...MINIMAL_V1, version: 2, scadIntents: ['not', 'an', 'object'] };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('rejects malformed aiHistory', () => {
    const bad = { ...MINIMAL_V1, version: 2, aiHistory: 'not-an-array' };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('rejects file without magic', () => {
    const bad = { ...MINIMAL_V1 } as Record<string, unknown>;
    delete bad.magic;
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });
});

// ─── v2 → v3 specific tests (Wave 2 Phase 2 Track D2) ──────────────────────

const SAMPLE_REF_NODE: ReferenceNode = {
  id: 'ref_abc',
  kind: 'plane',
  method: 'offset',
  label: 'Offset Plane 1',
  hidden: false,
  dependsOn: [],
  evaluatedAt: 0,
  params: {
    method: 'offset',
    parent: { kind: 'standard', id: 'front' },
    distanceMm: 25,
    direction: 1,
  },
};

describe('nfabFormat v2 → v3 migration (ref-geom)', () => {
  it('migrateV2ToV3 bumps version and adds empty referenceGeometry', () => {
    const v2 = { ...MINIMAL_V1, version: 2, aiHistory: [], scadIntents: {} };
    const v3 = migrateV2ToV3(v2 as unknown as Record<string, unknown>);
    expect(v3.version).toBe(3);
    expect(v3.referenceGeometry).toEqual([]);
    // Existing v2 fields untouched.
    expect(v3.aiHistory).toEqual([]);
    expect(v3.scadIntents).toEqual({});
    expect(v3.tree).toEqual(MINIMAL_V1.tree);
  });

  it('migrateV2ToV3 preserves pre-existing referenceGeometry array', () => {
    const v2 = {
      ...MINIMAL_V1,
      version: 2,
      referenceGeometry: [SAMPLE_REF_NODE],
    };
    const v3 = migrateV2ToV3(v2 as unknown as Record<string, unknown>);
    expect(v3.referenceGeometry).toEqual([SAMPLE_REF_NODE]);
  });

  it('rejects v3 file when referenceGeometry is not an array', () => {
    const bad = {
      ...MINIMAL_V1,
      version: 3,
      aiHistory: [],
      scadIntents: {},
      referenceGeometry: 'not-an-array',
    };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('v2 → v3 → v3 round-trip is stable (deep equal sans timestamps)', () => {
    // Load a v2 file → serialize as v3 → load again, the ref-geom field
    // is preserved end-to-end.
    const v2json = JSON.stringify({ ...MINIMAL_V1, version: 2 });
    const loaded = parseProject(v2json);
    expect(loaded.version).toBe(3);
    // Now serialize what we have back through `serializeProject` and
    // reparse. The serializer recomputes createdAt/updatedAt, so we
    // compare a stripped view.
    const reserialized = serializeProject({
      name: loaded.name,
      history: {
        nodes: loaded.tree.nodes,
        rootId: loaded.tree.rootId,
        activeNodeId: loaded.tree.activeNodeId,
        editingNodeId: null,
      },
      scene: loaded.scene,
      referenceGeometry: loaded.referenceGeometry,
      aiHistory: loaded.aiHistory,
      scadIntents: loaded.scadIntents,
    });
    expect(reserialized.version).toBe(3);
    const roundTripped = parseProject(toJsonString(reserialized));
    expect(roundTripped.version).toBe(3);
    // Empty ref-geom list is dropped by the serializer (file-size optim)
    // and the v3 loader doesn't repopulate it — so a v2-origin file with
    // no ref geom round-trips as `referenceGeometry: undefined`. This
    // matches the v2 aiHistory behavior on documents without AI calls.
    expect(roundTripped.referenceGeometry).toBeUndefined();
    expect(roundTripped.tree.nodes).toEqual(loaded.tree.nodes);
  });

  it('v3 round-trip with ref-geom preserves the node list', () => {
    const v3 = serializeProject({
      name: 'with-refs',
      history: {
        nodes: [],
        rootId: 'r',
        activeNodeId: 'r',
        editingNodeId: null,
      },
      scene: MINIMAL_V1.scene as unknown as Parameters<typeof serializeProject>[0]['scene'],
      referenceGeometry: [SAMPLE_REF_NODE],
    });
    expect(v3.version).toBe(3);
    expect(v3.referenceGeometry).toEqual([SAMPLE_REF_NODE]);
    const reparsed = parseProject(toJsonString(v3));
    expect(reparsed.version).toBe(3);
    expect(reparsed.referenceGeometry).toEqual([SAMPLE_REF_NODE]);
  });

  it('serializer omits referenceGeometry when input array is empty', () => {
    const v3 = serializeProject({
      name: 'no-refs',
      history: {
        nodes: [],
        rootId: 'r',
        activeNodeId: 'r',
        editingNodeId: null,
      },
      scene: MINIMAL_V1.scene as unknown as Parameters<typeof serializeProject>[0]['scene'],
      referenceGeometry: [],
    });
    expect(v3.referenceGeometry).toBeUndefined();
    // Reparse still surfaces it as [] (migrateV2ToV3 defaults).
    // But v3 docs already have version=3 so no migration kicks in;
    // the field stays undefined on the in-memory shape.
    const reparsed = parseProject(toJsonString(v3));
    expect(reparsed.version).toBe(3);
    // The loader only adds `referenceGeometry: []` during migrate, not
    // post-load normalisation — so a v3-no-ref-geom file stays undefined.
    expect(reparsed.referenceGeometry).toBeUndefined();
  });

  it('forward-version error message lists v3 as the supported ceiling', () => {
    const future = { ...MINIMAL_V1, version: 99 };
    try {
      parseProject(JSON.stringify(future));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/v3/);
    }
  });
});
