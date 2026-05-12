/**
 * .nfab corruption resilience (Q4).
 *
 * Real customer files arrive damaged: truncated downloads, partially
 * corrupted IndexedDB writes, manual JSON edits, oversized payloads.
 * The parser must NEVER produce undefined behavior — it either returns a
 * usable project or throws `NfabParseError` with a typed reason. Crashing
 * is the worst outcome because the user can't tell their file from a bug.
 */

import { describe, it, expect } from 'vitest';
import { parseProject, NfabParseError } from '../nfabFormat';

const VALID_V2 = {
  magic: 'nfab',
  version: 2,
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

describe('.nfab corruption guards (Q4)', () => {
  // ─── Malformed JSON ─────────────────────────────────────────────────────
  it('truncated JSON throws NfabParseError (not SyntaxError)', () => {
    const truncated = JSON.stringify(VALID_V2).slice(0, 50);
    expect(() => parseProject(truncated)).toThrow(NfabParseError);
  });

  it('empty string throws NfabParseError', () => {
    expect(() => parseProject('')).toThrow(NfabParseError);
  });

  it('non-JSON garbage throws NfabParseError', () => {
    expect(() => parseProject('!!!not json!!!')).toThrow(NfabParseError);
  });

  // ─── Wrong magic value (typos / foreign formats) ────────────────────────
  it('typo in magic throws NfabParseError', () => {
    const bad = { ...VALID_V2, magic: 'nfb' };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('numeric magic throws NfabParseError', () => {
    const bad = { ...VALID_V2, magic: 42 };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('JSON array (not object) throws NfabParseError', () => {
    expect(() => parseProject('[]')).toThrow(NfabParseError);
  });

  it('null payload throws NfabParseError', () => {
    expect(() => parseProject('null')).toThrow(NfabParseError);
  });

  // ─── Tree malformation ──────────────────────────────────────────────────
  it('missing tree throws NfabParseError', () => {
    const bad = { ...VALID_V2 } as Record<string, unknown>;
    delete bad.tree;
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('tree.nodes not an array throws NfabParseError', () => {
    const bad = { ...VALID_V2, tree: { nodes: 'oops', rootId: 'r', activeNodeId: 'r' } };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('tree.rootId missing throws NfabParseError', () => {
    const bad = { ...VALID_V2, tree: { nodes: [], activeNodeId: 'r' } };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  // ─── Scene malformation ─────────────────────────────────────────────────
  it('missing scene throws NfabParseError', () => {
    const bad = { ...VALID_V2 } as Record<string, unknown>;
    delete bad.scene;
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('scene.selectedId not a string throws NfabParseError', () => {
    const bad = { ...VALID_V2, scene: { ...VALID_V2.scene, selectedId: 42 } };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  // ─── Assembly malformation ──────────────────────────────────────────────
  it('assembly === null throws NfabParseError', () => {
    const bad = { ...VALID_V2, assembly: null };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('assembly with bogus partial data normalizes, does not crash', () => {
    const bad = {
      ...VALID_V2,
      assembly: {
        placedParts: [{ id: 'p1' /* missing required fields */ }],
        mates: [{ id: 'm1', type: 'invalid_type' }],
        garbageField: 'oops',
      },
    };
    // Normalizer drops invalid entries; should NOT throw.
    const result = parseProject(JSON.stringify(bad));
    expect(result.assembly?.placedParts).toEqual([]);
    expect(result.assembly?.mates).toEqual([]);
  });

  // ─── Boundary sizes ─────────────────────────────────────────────────────
  it('huge feature tree (10k nodes) parses without choking', () => {
    const nodes = [];
    for (let i = 0; i < 10_000; i++) {
      nodes.push({
        id: `n${i}`, parentId: 'r', name: `f${i}`,
        feature: { id: `f${i}`, type: 'boolean', params: {}, enabled: true },
        children: [], editingActive: false,
      });
    }
    const big = { ...VALID_V2, tree: { nodes, rootId: 'r', activeNodeId: 'r' } };
    const json = JSON.stringify(big);
    const t0 = Date.now();
    const parsed = parseProject(json);
    const elapsed = Date.now() - t0;
    expect(parsed.tree.nodes.length).toBe(10_000);
    expect(elapsed).toBeLessThan(2_000); // 2s ceiling for 10k-node parse
  });

  // ─── Non-string version ─────────────────────────────────────────────────
  it('version as string throws (treated as version 0 → invalid)', () => {
    const bad = { ...VALID_V2, version: '2' };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });

  it('missing version field throws (treated as version 0 → invalid)', () => {
    const bad = { ...VALID_V2 } as Record<string, unknown>;
    delete bad.version;
    expect(() => parseProject(JSON.stringify(bad))).toThrow(NfabParseError);
  });
});
