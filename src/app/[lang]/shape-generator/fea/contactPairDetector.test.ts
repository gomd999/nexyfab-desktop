import { describe, it, expect } from 'vitest';
import {
  detectContactPairs,
  summarize,
  type MeshBody,
} from './contactPairDetector';

function faceTop(id: string, z: number, areaMm2: number = 100): MeshBody['faces'][number] {
  return {
    id,
    centroid: { x: 0, y: 0, z },
    normal: { x: 0, y: 0, z: 1 },
    areaMm2,
  };
}

function faceBottom(id: string, z: number, areaMm2: number = 100): MeshBody['faces'][number] {
  return {
    id,
    centroid: { x: 0, y: 0, z },
    normal: { x: 0, y: 0, z: -1 },
    areaMm2,
  };
}

describe('detectContactPairs', () => {
  it('empty bodies → empty pairs', () => {
    const r = detectContactPairs({ id: 'A', faces: [] }, { id: 'B', faces: [] });
    expect(r.pairs).toEqual([]);
  });

  it('facing faces within gap → 1 pair', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.01)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs).toHaveLength(1);
  });

  it('faces too far apart → no pair', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 100)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs).toEqual([]);
  });

  it('parallel-same-direction normals not paired', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceTop('b1', 0.01)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs).toEqual([]);
  });

  it('large facing faces classify as bonded', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0, 100)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.01, 100)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs[0]!.contactType).toBe('bonded');
  });

  it('tiny area facing faces classify as spotweld', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0, 0.1)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.05, 0.1)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs[0]!.contactType).toBe('spotweld');
  });

  it('gap reflects centroid distance', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.3)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs[0]!.gapMm).toBeCloseTo(0.3, 3);
  });

  it('confidence in [0,1]', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.05)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs[0]!.confidence).toBeGreaterThanOrEqual(0);
    expect(r.pairs[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it('unmatched faces reported', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0), faceTop('a2', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.01)] };
    const r = detectContactPairs(A, B);
    expect(r.unmatchedA.length + r.pairs.length).toBe(2);
  });

  it('options override defaults', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 1.0)] };
    const loose = detectContactPairs(A, B, { maxGapMm: 2 });
    const tight = detectContactPairs(A, B, { maxGapMm: 0.5 });
    expect(loose.pairs.length).toBeGreaterThan(tight.pairs.length);
  });

  it('one face on B is matched only once', () => {
    const A: MeshBody = {
      id: 'A',
      faces: [faceTop('a1', 0), faceTop('a2', 0.02)],
    };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.01)] };
    const r = detectContactPairs(A, B);
    expect(r.pairs).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize({ pairs: [], unmatchedA: [], unmatchedB: [] });
    expect(s.pairCount).toBe(0);
  });

  it('counts each contact type', () => {
    const A: MeshBody = {
      id: 'A',
      faces: [faceTop('a1', 0, 100), faceTop('a2', 0, 0.1)],
    };
    const B: MeshBody = {
      id: 'B',
      faces: [faceBottom('b1', 0.01, 100), faceBottom('b2', 0.03, 0.1)],
    };
    // Move spotweld face away from bonded face.
    A.faces[1]!.centroid = { x: 50, y: 50, z: 0 };
    B.faces[1]!.centroid = { x: 50, y: 50, z: 0.03 };
    const r = detectContactPairs(A, B);
    const s = summarize(r);
    expect(s.bondedCount + s.spotweldCount + s.frictionalCount).toBeGreaterThan(0);
  });

  it('average confidence in [0,1]', () => {
    const A: MeshBody = { id: 'A', faces: [faceTop('a1', 0)] };
    const B: MeshBody = { id: 'B', faces: [faceBottom('b1', 0.05)] };
    const s = summarize(detectContactPairs(A, B));
    expect(s.averageConfidence).toBeGreaterThanOrEqual(0);
    expect(s.averageConfidence).toBeLessThanOrEqual(1);
  });
});
