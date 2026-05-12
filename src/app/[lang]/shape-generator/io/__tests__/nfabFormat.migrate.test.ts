import { describe, it, expect } from 'vitest';
import { parseProject, NFAB_FORMAT_VERSION, NfabParseError } from '../nfabFormat';

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

describe('nfabFormat v1 → v2 migration', () => {
  it('current build constant is v2', () => {
    expect(NFAB_FORMAT_VERSION).toBe(2);
  });

  it('parses a v1 file and bumps version to 2', () => {
    const json = JSON.stringify(MINIMAL_V1);
    const parsed = parseProject(json);
    expect(parsed.version).toBe(2);
    expect(parsed.magic).toBe('nfab');
    expect(parsed.tree.nodes).toEqual([]);
  });

  it('v1 file gets default empty aiHistory + scadIntents', () => {
    const json = JSON.stringify(MINIMAL_V1);
    const parsed = parseProject(json);
    expect(parsed.aiHistory).toEqual([]);
    expect(parsed.scadIntents).toEqual({});
  });

  it('preserves existing v2 fields when parsing a v2 file', () => {
    const v2 = {
      ...MINIMAL_V1,
      version: 2,
      aiHistory: [{ ts: 123, prompt: 'M8 bolt', summary: 'a bolt' }],
      scadIntents: { node1: { shapeId: 'bolt' } },
    };
    const parsed = parseProject(JSON.stringify(v2));
    expect(parsed.version).toBe(2);
    expect(parsed.aiHistory).toHaveLength(1);
    expect(parsed.aiHistory?.[0]?.prompt).toBe('M8 bolt');
    expect(parsed.scadIntents).toEqual({ node1: { shapeId: 'bolt' } });
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
