import { describe, it, expect } from 'vitest';
import {
  recognizeImportedBrep,
  summarizeRecognition,
  type ImportedFace,
  type ImportedEdge,
} from './featureRecognition';

const cylFace = (id: string, axis: [number, number, number], radius: number): ImportedFace => ({
  id, shape: 'cylindrical', areaMm2: 50, direction: axis, origin: [0, 0, 0], radiusMm: radius, adjacentFaceIds: [],
});

const planarFace = (id: string, normal: [number, number, number], origin: [number, number, number], area: number): ImportedFace => ({
  id, shape: 'planar', areaMm2: area, direction: normal, origin, adjacentFaceIds: [],
});

describe('hole recognition', () => {
  it('single cylindrical face → drilled hole', () => {
    const r = recognizeImportedBrep([cylFace('c1', [0, 0, 1], 3)], []);
    expect(r.features.some(f => f.kind === 'hole-drilled')).toBe(true);
  });

  it('two concentric cylinders → counterbore', () => {
    const r = recognizeImportedBrep([
      cylFace('small', [0, 0, 1], 3),
      cylFace('big', [0, 0, 1], 5),
    ], []);
    expect(r.features.some(f => f.kind === 'hole-counterbore')).toBe(true);
  });

  it('cone + cylinder on shared axis → countersink', () => {
    const r = recognizeImportedBrep([
      cylFace('c', [0, 0, 1], 3),
      { id: 'cone', shape: 'conical', areaMm2: 40, direction: [0, 0, 1], origin: [0, 0, 0], halfAngleDeg: 41, adjacentFaceIds: [] },
    ], []);
    expect(r.features.some(f => f.kind === 'hole-countersink')).toBe(true);
  });

  it('hole reports diameter param', () => {
    const r = recognizeImportedBrep([cylFace('c1', [0, 0, 1], 4)], []);
    const hole = r.features.find(f => f.kind === 'hole-drilled')!;
    expect(hole.params.diameterMm).toBe(8);
  });
});

describe('fillet + chamfer recognition', () => {
  it('small cylindrical face with smooth edges + planar neighbours → fillet', () => {
    const faces: ImportedFace[] = [
      { ...cylFace('fillet-cyl', [1, 0, 0], 1), adjacentFaceIds: ['p1', 'p2'] },
      planarFace('p1', [0, 0, 1], [0, 0, 0], 100),
      planarFace('p2', [0, 1, 0], [0, 0, 0], 100),
    ];
    const edges: ImportedEdge[] = [
      { id: 'e1', start: [0, 0, 0], end: [1, 0, 0], lengthMm: 1, convexity: 'smooth', leftFaceId: 'fillet-cyl', rightFaceId: 'p1' },
      { id: 'e2', start: [0, 0, 0], end: [1, 0, 0], lengthMm: 1, convexity: 'smooth', leftFaceId: 'fillet-cyl', rightFaceId: 'p2' },
    ];
    const r = recognizeImportedBrep(faces, edges);
    expect(r.features.some(f => f.kind === 'fillet')).toBe(true);
  });

  it('small planar face between two non-parallel planes → chamfer', () => {
    const faces: ImportedFace[] = [
      { ...planarFace('cham', [1, 1, 0], [0, 0, 0], 10), adjacentFaceIds: ['p1', 'p2'] },
      planarFace('p1', [1, 0, 0], [0, 0, 0], 200),
      planarFace('p2', [0, 1, 0], [0, 0, 0], 200),
    ];
    const r = recognizeImportedBrep(faces, []);
    expect(r.features.some(f => f.kind === 'chamfer')).toBe(true);
  });

  it('large planar face NOT recognized as chamfer', () => {
    const faces: ImportedFace[] = [
      { ...planarFace('big', [1, 1, 0], [0, 0, 0], 5000), adjacentFaceIds: ['p1', 'p2'] },
      planarFace('p1', [1, 0, 0], [0, 0, 0], 200),
      planarFace('p2', [0, 1, 0], [0, 0, 0], 200),
    ];
    const r = recognizeImportedBrep(faces, []);
    expect(r.features.find(f => f.kind === 'chamfer')).toBeUndefined();
  });
});

describe('extrude recognition', () => {
  it('two anti-parallel matching faces → extrude-boss', () => {
    const faces: ImportedFace[] = [
      planarFace('bot', [0, 0, -1], [0, 0, 0], 100),
      planarFace('top', [0, 0, 1], [0, 0, 20], 100),
    ];
    const r = recognizeImportedBrep(faces, []);
    expect(r.features.some(f => f.kind === 'extrude-boss')).toBe(true);
    const ext = r.features.find(f => f.kind === 'extrude-boss')!;
    expect(ext.params.depthMm).toBe(20);
  });

  it('mismatched areas not recognized', () => {
    const faces: ImportedFace[] = [
      planarFace('bot', [0, 0, -1], [0, 0, 0], 100),
      planarFace('top', [0, 0, 1], [0, 0, 20], 500),
    ];
    const r = recognizeImportedBrep(faces, []);
    expect(r.features.find(f => f.kind === 'extrude-boss')).toBeUndefined();
  });
});

describe('revolve recognition', () => {
  it('cylindrical → revolve-cylinder', () => {
    const r = recognizeImportedBrep([cylFace('c1', [0, 0, 1], 5)], []);
    expect(r.features.some(f => f.kind === 'revolve-cylinder')).toBe(true);
  });

  it('conical → revolve-cone', () => {
    const r = recognizeImportedBrep([
      { id: 'cn', shape: 'conical', areaMm2: 80, direction: [0, 0, 1], origin: [0, 0, 0], halfAngleDeg: 30, adjacentFaceIds: [] },
    ], []);
    expect(r.features.some(f => f.kind === 'revolve-cone')).toBe(true);
  });

  it('toroidal → revolve-torus', () => {
    const r = recognizeImportedBrep([
      { id: 't', shape: 'toroidal', areaMm2: 100, direction: [0, 0, 1], origin: [0, 0, 0], radiusMm: 2, adjacentFaceIds: [] },
    ], []);
    expect(r.features.some(f => f.kind === 'revolve-torus')).toBe(true);
  });
});

describe('sweep recognition', () => {
  it('3+ cylinders at same radius → sweep-pipe', () => {
    const r = recognizeImportedBrep([
      cylFace('c1', [1, 0, 0], 5),
      cylFace('c2', [0, 1, 0], 5),
      cylFace('c3', [1, 1, 0], 5),
    ], []);
    expect(r.features.some(f => f.kind === 'sweep-pipe')).toBe(true);
  });
});

describe('recognitionRatio', () => {
  it('100% when all faces recognized', () => {
    const r = recognizeImportedBrep([cylFace('c', [0, 0, 1], 5)], []);
    expect(r.recognitionRatio).toBeGreaterThan(0);
  });

  it('0 for empty input', () => {
    const r = recognizeImportedBrep([], []);
    expect(r.recognitionRatio).toBe(0);
  });
});

describe('summarizeRecognition', () => {
  it('counts each recognized kind', () => {
    const r = recognizeImportedBrep([
      cylFace('c1', [0, 0, 1], 3),
      cylFace('c2', [1, 0, 0], 3),
    ], []);
    const s = summarizeRecognition(r);
    expect((s['hole-drilled'] ?? 0) + (s['revolve-cylinder'] ?? 0)).toBeGreaterThanOrEqual(2);
  });
});
