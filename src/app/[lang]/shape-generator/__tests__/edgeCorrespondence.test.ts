import { describe, it, expect } from 'vitest';
import { matchEdgeBySignature, normalizeEdgeDir, type EdgeSig } from '../features/edgeCorrespondence';

describe('edgeCorrespondence — geometric edge matching for topology tracking', () => {
  it('normalizeEdgeDir makes an edge and its reverse compare equal', () => {
    expect(normalizeEdgeDir([0, 0, 2])).toEqual([0, 0, 1]);
    expect(normalizeEdgeDir([0, 0, -2])).toEqual([0, 0, 1]); // reverse → same
    expect(normalizeEdgeDir([-1, 0, 0])).toEqual([1, 0, 0]);
  });

  it('picks the parallel edge with the nearest midpoint', () => {
    const target: EdgeSig = { mid: [10, 10, 0], dir: [0, 0, 1], length: 20 };
    const candidates: EdgeSig[] = [
      { mid: [-10, -10, 0], dir: [0, 0, 1], length: 20 }, // parallel, far
      { mid: [10, 10, 0], dir: [0, 0, 1], length: 20 },   // parallel, exact → win
      { mid: [10, 10, 0], dir: [1, 0, 0], length: 20 },   // perpendicular at same mid
    ];
    expect(matchEdgeBySignature(target, candidates)).toBe(1);
  });

  it('ignores a closer perpendicular edge in favour of a parallel one', () => {
    const target: EdgeSig = { mid: [10, 10, 0], dir: [0, 0, 1], length: 20 };
    const candidates: EdgeSig[] = [
      { mid: [10, 10, 0.5], dir: [1, 0, 0], length: 20 }, // very close but perpendicular
      { mid: [12, 11, 0], dir: [0, 0, 1], length: 20 },   // parallel, slightly off
    ];
    expect(matchEdgeBySignature(target, candidates)).toBe(1);
  });

  it('matches a reversed-direction edge (sign-normalised)', () => {
    const target: EdgeSig = { mid: [5, 0, 0], dir: [0, 1, 0], length: 10 };
    const candidates: EdgeSig[] = [{ mid: [5, 0, 0], dir: [0, -1, 0], length: 10 }];
    expect(matchEdgeBySignature(target, candidates)).toBe(0);
  });

  it('survives a topology change: extra edges from a new feature do not steal the match', () => {
    // The user filleted the +X,+Y vertical edge. Later a hole is added, adding
    // many new edges. The target edge still exists; the matcher must find it
    // among the enlarged candidate set.
    const target: EdgeSig = { mid: [10, 10, -10], dir: [0, 0, 1], length: 20 };
    const candidates: EdgeSig[] = [
      { mid: [-10, -10, -10], dir: [0, 0, 1], length: 20 }, // other box corner
      { mid: [0, 0, -5], dir: [0, 0, 1], length: 10 },      // new hole wall edge
      { mid: [0, 0, -15], dir: [0, 0, 1], length: 10 },     // new hole wall edge
      { mid: [10, 10, -10], dir: [0, 0, 1], length: 20 },   // the original target
      { mid: [3, 0, -5], dir: [1, 0, 0], length: 6 },       // new hole rim edge
    ];
    expect(matchEdgeBySignature(target, candidates)).toBe(3);
  });

  it('returns −1 when no candidate is parallel enough', () => {
    const target: EdgeSig = { mid: [0, 0, 0], dir: [0, 0, 1], length: 10 };
    const candidates: EdgeSig[] = [
      { mid: [0, 0, 0], dir: [1, 0, 0], length: 10 },
      { mid: [0, 0, 0], dir: [0, 1, 0], length: 10 },
    ];
    expect(matchEdgeBySignature(target, candidates)).toBe(-1);
  });
});
