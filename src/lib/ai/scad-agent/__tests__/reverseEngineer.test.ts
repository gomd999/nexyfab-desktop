/**
 * reverseEngineer.test.ts — heuristic shape classifier coverage.
 *
 * Each test builds a synthetic THREE.BufferGeometry (cube / sphere /
 * cylinder / torus / disk / multi-body) directly so we don't depend on
 * OpenSCAD rendering. Asserts cover (1) which candidate wins for an
 * unambiguous shape, (2) the multi-body short-circuit, (3) the empty-mesh
 * edge case, (4) the formatter, and (5) the tool wiring.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  reverseEngineerFromGeometry,
  formatProposedIntents,
} from '../reverseEngineer';
import type { AgentSession } from '../types';

function mergeGeoms(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const arrays = geoms.map(g => g.attributes.position.array as Float32Array);
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const combined = new Float32Array(total);
  let off = 0;
  for (const a of arrays) { combined.set(a, off); off += a.length; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));
  return out;
}

describe('reverseEngineerFromGeometry — primitives', () => {
  it('a synthetic cube returns box as the top candidate with high confidence', () => {
    const cube = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: cube });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0]!.intent.shapeId).toBe('box');
    expect(r.candidates[0]!.confidence).toBeGreaterThan(80);
    const params = r.candidates[0]!.intent.params;
    expect(params.width).toBeCloseTo(20, 0);
    expect(params.height).toBeCloseTo(20, 0);
    expect(params.depth).toBeCloseTo(20, 0);
  });

  it('a synthetic sphere returns sphere as the top candidate', () => {
    // High-tessellation sphere so the bbox/volume ratios are close to analytic.
    const sphere = new THREE.SphereGeometry(15, 64, 64).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: sphere });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0]!.intent.shapeId).toBe('sphere');
    const dia = r.candidates[0]!.intent.params.diameter;
    expect(dia).toBeCloseTo(30, 0);
  });

  it('a synthetic cylinder returns cylinder as the top candidate', () => {
    // Cylinder oriented along +Y by default in three.js; height = 50.
    const cyl = new THREE.CylinderGeometry(10, 10, 50, 64).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: cyl });
    expect(r.candidates.length).toBeGreaterThan(0);
    const topId = r.candidates[0]!.intent.shapeId;
    expect(topId).toBe('cylinder');
    const params = r.candidates[0]!.intent.params;
    expect(params.diameter).toBeCloseTo(20, 0);
    expect(params.height).toBeCloseTo(50, 0);
  });

  it('a synthetic torus (genus 1) returns a pipe-variant candidate', () => {
    // Torus has genus 1, two equal axes (the major-diameter plane) and a
    // smaller "height" (tube diameter). Classifier should pick pipe.
    const torus = new THREE.TorusGeometry(15, 5, 16, 48).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: torus });
    expect(r.candidates.length).toBeGreaterThan(0);
    // Genus 1 + cylinder-like fullness → pipe or washer (both are valid).
    const ids = r.candidates.map(c => c.intent.shapeId);
    expect(ids.some(id => id === 'pipe' || id === 'washer')).toBe(true);
  });
});

describe('reverseEngineerFromGeometry — disk variant', () => {
  it('a thin disk (50×50×2) returns disk as the top candidate, not cylinder', () => {
    // Thin cylinder oriented along Z: radius 25, height 2.
    const disk = new THREE.CylinderGeometry(25, 25, 2, 64).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: disk });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0]!.intent.shapeId).toBe('disk');
    const params = r.candidates[0]!.intent.params;
    expect(params.thickness).toBeCloseTo(2, 0);
    expect(params.diameter).toBeCloseTo(50, 0);
  });
});

describe('reverseEngineerFromGeometry — multi-body short-circuit', () => {
  it('two disjoint cubes return a single low-confidence "assembly" candidate', () => {
    const a = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const b = new THREE.BoxGeometry(8, 8, 8).toNonIndexed();
    b.applyMatrix4(new THREE.Matrix4().makeTranslation(50, 0, 0));
    const merged = mergeGeoms([a, b]);
    const r = reverseEngineerFromGeometry({ geometry: merged });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0]!.confidence).toBeLessThan(30);
    expect(r.candidates[0]!.summary).toMatch(/assembly|multi-body|bodies/);
    expect(r.observedStats.componentCount).toBe(2);
  });
});

describe('reverseEngineerFromGeometry — edge cases', () => {
  it('empty geometry returns no candidates and zeroed stats', () => {
    const empty = new THREE.BufferGeometry();
    const r = reverseEngineerFromGeometry({ geometry: empty });
    expect(r.candidates).toHaveLength(0);
    expect(r.observedStats.bbox.wMm).toBe(0);
    expect(r.observedStats.volumeMm3).toBe(0);
    expect(r.observedStats.componentCount).toBe(0);
  });

  it('non-cube tessellation (icosahedron) falls back rather than calling it a box', () => {
    // An icosahedron is curved enough to lose the box rule; classifier may
    // call it sphere or the rule-6 fallback. Either way, NOT a high-confidence box.
    const icos = new THREE.IcosahedronGeometry(10, 0).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: icos });
    expect(r.candidates.length).toBeGreaterThan(0);
    const box = r.candidates.find(c => c.intent.shapeId === 'box' && c.confidence > 80);
    expect(box).toBeUndefined();
  });
});

describe('reverseEngineerFromGeometry — observed stats', () => {
  it('reports topology / surface / dihedral diagnostics in observedStats', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: cube });
    expect(r.observedStats.genus).toBe(0);
    expect(r.observedStats.componentCount).toBe(1);
    expect(r.observedStats.surfaceAreaMm2).toBeCloseTo(600, 0); // 6 × 100
    expect(r.observedStats.volumeMm3).toBeCloseTo(1000, 0);
    expect(r.observedStats.sharpEdgeCount).toBeGreaterThan(0);
  });

  it('candidates are sorted by confidence descending', () => {
    const cube = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: cube });
    for (let i = 0; i + 1 < r.candidates.length; i++) {
      expect(r.candidates[i]!.confidence).toBeGreaterThanOrEqual(r.candidates[i + 1]!.confidence);
    }
  });

  it('returns at most 3 candidates (top-3 cap)', () => {
    const sphere = new THREE.SphereGeometry(10, 64, 64).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: sphere });
    expect(r.candidates.length).toBeLessThanOrEqual(3);
  });
});

describe('formatProposedIntents', () => {
  it('includes shapeId, confidence and first 2 evidence lines', () => {
    const cube = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    const r = reverseEngineerFromGeometry({ geometry: cube });
    const text = formatProposedIntents(r);
    expect(text).toMatch(/box/);
    expect(text).toMatch(/confidence/i);
    expect(text).toMatch(/bbox/i);
    expect(text).toMatch(/volume/i);
  });

  it('empty result formats with a clear "no candidate" line', () => {
    const empty = new THREE.BufferGeometry();
    const text = formatProposedIntents(reverseEngineerFromGeometry({ geometry: empty }));
    expect(text).toMatch(/no candidate/i);
  });
});

describe('reverseEngineerFromGeometry — tool wiring (manual call)', () => {
  it('passes through synchronously and returns a serializable result', () => {
    const cube = new THREE.BoxGeometry(15, 15, 15).toNonIndexed();
    const result = reverseEngineerFromGeometry({ geometry: cube });
    // JSON round-trip should not throw — meta payload for the agent ships
    // this exact shape.
    const json = JSON.stringify(result.candidates);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('intent');
    expect(parsed[0]).toHaveProperty('confidence');
  });
});

// ─── reverse_engineer_mesh tool executor ──────────────────────────────────

describe('reverse_engineer_mesh tool executor', () => {
  // Lazy imports so the helper tests above remain independent of the agent
  // surface (which pulls a large transitive dep chain).
  it('returns BAD_ARGS when stlBase64 is missing', async () => {
    const { makeTools } = await import('../tools');
    const tools = makeTools({
      render: async () => ({ ok: true, errors: [], stlBytes: 0, triangles: 0, ts: Date.now() }),
      geometry: async () => ({ triangleCount: 0 }),
      dfm: async () => ({ summary: '', issuesCount: 0 }),
    });
    const session = blankAgentSession();
    const result = await tools.reverse_engineer_mesh!({}, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BAD_ARGS');
  });

  it('returns STL_DECODE_FAILED on empty base64', async () => {
    const { makeTools } = await import('../tools');
    const tools = makeTools({
      render: async () => ({ ok: true, errors: [], stlBytes: 0, triangles: 0, ts: Date.now() }),
      geometry: async () => ({ triangleCount: 0 }),
      dfm: async () => ({ summary: '', issuesCount: 0 }),
    });
    const session = blankAgentSession();
    // A bare empty string after the data URL prefix decodes to 0 bytes.
    const result = await tools.reverse_engineer_mesh!({ stlBase64: 'data:model/stl;base64,' }, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('STL_DECODE_FAILED');
  });

  it('happy path: parses a synthetic cube STL and writes session.lastIntent', async () => {
    const { makeTools } = await import('../tools');
    const tools = makeTools({
      render: async () => ({ ok: true, errors: [], stlBytes: 0, triangles: 0, ts: Date.now() }),
      geometry: async () => ({ triangleCount: 0 }),
      dfm: async () => ({ summary: '', issuesCount: 0 }),
    });
    const session = blankAgentSession();
    // Build a 20mm cube and serialize it as a binary STL the tool can parse.
    const cube = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    const stlBuf = bufferGeometryToBinaryStl(cube);
    const stlBase64 = Buffer.from(stlBuf).toString('base64');
    const result = await tools.reverse_engineer_mesh!({ stlBase64 }, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return; // type guard
    expect(result.output).toMatch(/box|candidate/i);
    expect(session.lastIntent?.shapeId).toBe('box');
    expect(session.scadSource.length).toBeGreaterThan(0);
    // meta carries the structured candidate list for downstream callers.
    const meta = result.meta as { candidates: Array<{ intent: { shapeId: string } }> } | undefined;
    expect(meta?.candidates[0]?.intent.shapeId).toBe('box');
  });
});

/** Minimal session object that satisfies the AgentSession contract enough
 *  for the reverse_engineer_mesh executor to mutate it. */
function blankAgentSession(): AgentSession {
  return {
    id: 's',
    scadSource: '',
    modules: {},
    composition: null,
    designPlan: null,
    checkpoints: [],
    brepEntries: [],
    sketches: {},
    mates: [],
    gdtFrames: [],
    docRefs: [],
    history: [],
    render: { ok: null, errors: [] },
    geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 50,
      toolCallsUsed: 0, toolCallsCap: 200,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle' as const,
  };
}

/** Serialize a THREE.BufferGeometry as a binary STL the loader can round-trip.
 *  Strictly local to the test — production never serializes from a Three geometry. */
function bufferGeometryToBinaryStl(geometry: THREE.BufferGeometry): Uint8Array {
  const positions = geometry.attributes.position!.array as Float32Array;
  const triCount = positions.length / 9;
  // Header (80) + tri count (4) + 50 bytes per triangle (12 normal + 36 verts + 2 attr).
  const out = new Uint8Array(80 + 4 + triCount * 50);
  const view = new DataView(out.buffer);
  view.setUint32(80, triCount, true);
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    // Normal — flat 0 is fine; STL parsers re-derive.
    view.setFloat32(off + 0, 0, true);
    view.setFloat32(off + 4, 0, true);
    view.setFloat32(off + 8, 0, true);
    for (let v = 0; v < 3; v++) {
      const i = t * 9 + v * 3;
      view.setFloat32(off + 12 + v * 12 + 0, positions[i + 0]!, true);
      view.setFloat32(off + 12 + v * 12 + 4, positions[i + 1]!, true);
      view.setFloat32(off + 12 + v * 12 + 8, positions[i + 2]!, true);
    }
    view.setUint16(off + 48, 0, true);
    off += 50;
  }
  return out;
}
