import { describe, expect, it } from 'vitest';
import { Sha256 } from '@aws-crypto/sha256-js';
import { canonicalCadConsumerDraftJson, type CanonicalCadJsonValue } from './canonicalCadV2ConsumerDraft';
import {
  CANONICAL_SKETCH_PREFLIGHT_HASH_DOMAIN,
  CANONICAL_SKETCH_PREFLIGHT_SCHEMA,
  preflightCanonicalSketch,
  verifyCanonicalSketchPreflight,
} from './canonicalSketchPreflight';

function payloadHash(value: Record<string, unknown>): string {
  const hash = new Sha256();
  hash.update(`${CANONICAL_SKETCH_PREFLIGHT_HASH_DOMAIN}\n${canonicalCadConsumerDraftJson({
    schema: value.schema,
    projectId: value.projectId,
    documentId: value.documentId,
    currentRevision: value.currentRevision,
    sketchId: value.sketchId,
    plane: value.plane,
    points: value.points,
    lineSegments: value.lineSegments,
    loop: value.loop,
  } as CanonicalCadJsonValue)}`);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function square() {
  return {
    schema: CANONICAL_SKETCH_PREFLIGHT_SCHEMA,
    projectId: 'project-1',
    documentId: 'document-1',
    currentRevision: { revisionId: 'revision-1', sequence: 7, contentSha256: 'a'.repeat(64) },
    sketchId: 'sketch-1',
    plane: 'XY',
    points: [
      { id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 10, y: 0 },
      { id: 'p2', x: 10, y: 10 }, { id: 'p3', x: 0, y: 10 },
    ],
    lineSegments: [
      { id: 'l0', startPointId: 'p0', endPointId: 'p1' },
      { id: 'l1', startPointId: 'p1', endPointId: 'p2' },
      { id: 'l2', startPointId: 'p2', endPointId: 'p3' },
      { id: 'l3', startPointId: 'p3', endPointId: 'p0' },
    ],
  } as const;
}

describe('canonical sketch structural preflight', () => {
  it('passes one strict convex connected loop and remains release HOLD', () => {
    const result = preflightCanonicalSketch(square());
    expect(result.status).toBe('PRECHECK_PASS');
    if (result.status !== 'PRECHECK_PASS') return;
    expect(result.verification).toBe('STRUCTURAL_ONLY');
    expect(result.release).toBe('HOLD');
    expect(result.canonicalSketchSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyCanonicalSketchPreflight(result)).toBe(true);
  });

  it('hashes deterministically across input ordering', () => {
    const first = preflightCanonicalSketch(square());
    const source = square();
    const second = preflightCanonicalSketch({
      ...source,
      points: [...source.points].reverse(),
      lineSegments: [...source.lineSegments].reverse(),
    });
    expect(first.status).toBe('PRECHECK_PASS');
    expect(second.status).toBe('PRECHECK_PASS');
    if (first.status === 'PRECHECK_PASS' && second.status === 'PRECHECK_PASS') {
      expect(second.canonicalSketchSha256).toBe(first.canonicalSketchSha256);
    }
  });

  it.each([
    ['point id missing', () => ({ ...square(), points: [{ ...square().points[0], id: '' }, ...square().points.slice(1)] })],
    ['duplicate point id', () => ({ ...square(), points: [{ ...square().points[1], id: 'p0' }, ...square().points.slice(1)] })],
    ['missing endpoint reference', () => ({ ...square(), lineSegments: [{ ...square().lineSegments[0], endPointId: 'missing' }, ...square().lineSegments.slice(1)] })],
    ['zero length segment', () => ({ ...square(), lineSegments: [{ ...square().lineSegments[0], endPointId: 'p0' }, ...square().lineSegments.slice(1)] })],
    ['duplicate undirected segment', () => ({ ...square(), lineSegments: [{ ...square().lineSegments[0] }, { id: 'l4', startPointId: 'p1', endPointId: 'p0' }, ...square().lineSegments.slice(1)] })],
    ['extra constraints field', () => ({ ...square(), constraints: [] })],
  ])('%s fails closed', (_name, makeInput) => {
    const result = preflightCanonicalSketch(makeInput());
    expect(result.status).toBe('HOLD');
  });

  it('rejects disconnected multi-loop, concave, and self-intersecting geometry', () => {
    const disconnected = { ...square(), points: [...square().points, { id: 'p4', x: 30, y: 30 }], lineSegments: square().lineSegments };
    expect(preflightCanonicalSketch(disconnected).status).toBe('HOLD');
    const concave = {
      ...square(),
      points: [{ id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 4, y: 4 }, { id: 'p3', x: 0, y: 10 }],
    };
    expect(preflightCanonicalSketch(concave).status).toBe('HOLD');
    const bowtie = {
      ...square(),
      lineSegments: [
        { id: 'l0', startPointId: 'p0', endPointId: 'p2' },
        { id: 'l1', startPointId: 'p2', endPointId: 'p1' },
        { id: 'l2', startPointId: 'p1', endPointId: 'p3' },
        { id: 'l3', startPointId: 'p3', endPointId: 'p0' },
      ],
    };
    expect(preflightCanonicalSketch(bowtie).status).toBe('HOLD');
  });

  it('rejects hidden, symbol, getter, proxy, cycle, depth and oversize input', () => {
    const hidden = { ...square(), points: Object.assign([...square().points], { hidden: true }) };
    expect(preflightCanonicalSketch(hidden).status).toBe('HOLD');
    const symbol = { ...square(), [Symbol('hidden')]: true };
    expect(preflightCanonicalSketch(symbol).status).toBe('HOLD');
    const getter = square();
    Object.defineProperty(getter.points[0], 'x', { enumerable: true, get: () => 0 });
    expect(preflightCanonicalSketch(getter).status).toBe('HOLD');
    const proxy = new Proxy(square(), { ownKeys: () => { throw new Error('proxy trap'); } });
    expect(preflightCanonicalSketch(proxy).status).toBe('HOLD');
    const cycle: Record<string, unknown> = { ...square() };
    cycle.cycle = cycle;
    expect(preflightCanonicalSketch(cycle).status).toBe('HOLD');
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 12; index++) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
    expect(preflightCanonicalSketch(deep).status).toBe('HOLD');
    const oversized = { ...square(), projectId: 'x'.repeat(513) };
    expect(preflightCanonicalSketch(oversized).status).toBe('HOLD');
  });

  it('detects result tampering after a successful preflight', () => {
    const result = preflightCanonicalSketch(square());
    expect(result.status).toBe('PRECHECK_PASS');
    if (result.status !== 'PRECHECK_PASS') return;
    const tampered = { ...result, points: result.points.map(point => point.id === 'p1' ? { ...point, x: 11 } : point) };
    expect(verifyCanonicalSketchPreflight(tampered)).toBe(false);

    const forged = {
      ...result,
      points: result.points.map(point => point.id === 'p2' ? { ...point, x: 4, y: 4 } : point),
    } as unknown as Record<string, unknown>;
    forged.canonicalSketchSha256 = payloadHash(forged);
    expect(verifyCanonicalSketchPreflight(forged)).toBe(false);
  });
});
