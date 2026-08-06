import { describe, expect, it } from 'vitest';
import { verifySpaceBoundaryClosure, type BoundarySegment2 } from './spaceBoundaryClosure';

const rectangle = (gap = 0): BoundarySegment2[] => [
  { id: 'bottom', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
  { id: 'right', start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 } },
  { id: 'top', start: { x: 4000, y: 3000 }, end: { x: 0, y: 3000 } },
  { id: 'left', start: { x: 0, y: 3000 }, end: { x: gap, y: 0 } },
];

describe('space boundary closure', () => {
  it('measures a closed room loop and its area', () => {
    expect(verifySpaceBoundaryClosure({ segments: rectangle() })).toMatchObject({ closed: true, openBoundaries: 0, loopCount: 1, loopAreasMm2: [12_000_000], conservative: true });
  });
  it('snaps endpoint noise only inside the declared tolerance', () => {
    expect(verifySpaceBoundaryClosure({ segments: rectangle(0.05), snapToleranceMm: 0.1 }).closed).toBe(true);
    const open = verifySpaceBoundaryClosure({ segments: rectangle(0.2), snapToleranceMm: 0.1 });
    expect(open.closed).toBe(false); expect(open.issues.some(issue => issue.code === 'OPEN_VERTEX')).toBe(true);
  });
  it('fails non-manifold and self-intersecting boundaries instead of inventing a room', () => {
    const branch = [...rectangle(), { id: 'branch', start: { x: 0, y: 0 }, end: { x: -500, y: 0 } }];
    expect(verifySpaceBoundaryClosure({ segments: branch }).issues.some(issue => issue.code === 'NON_MANIFOLD_VERTEX')).toBe(true);
    const bowTie: BoundarySegment2[] = [
      { id: 'a', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }, { id: 'b', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { id: 'c', start: { x: 0, y: 10 }, end: { x: 10, y: 0 } }, { id: 'd', start: { x: 10, y: 0 }, end: { x: 0, y: 0 } },
    ];
    expect(verifySpaceBoundaryClosure({ segments: bowTie }).issues.some(issue => issue.code === 'SELF_INTERSECTION')).toBe(true);
  });
});
