/**
 * sketchSnap — snap target detection tests.
 *
 * Phase 1.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Validates:
 *   - grid rounding
 *   - point / endpoint / midpoint / circle-center proximity
 *   - line/line intersection detection
 *   - distance threshold cutoff
 *   - priority ordering on distance ties
 *   - toggle flags (enableGrid / enablePointSnap / enableIntersection)
 *   - default option fallbacks
 */

import { describe, it, expect } from 'vitest';
import { findSnapTarget, type SnapEntities } from './sketchSnap';

describe('findSnapTarget — grid', () => {
  it('rounds cursor (3, 7) to nearest grid node with spacing 5 → (5, 5)', () => {
    const r = findSnapTarget({ x: 3, y: 7 }, {}, { gridSpacing: 5 });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.pos).toEqual({ x: 5, y: 5 });
  });

  it('rounds (12, 13) with spacing 5 → (10, 15)', () => {
    const r = findSnapTarget({ x: 12, y: 13 }, {}, { gridSpacing: 5, pointRadius: 10 });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.pos).toEqual({ x: 10, y: 15 });
  });

  it('exact-on-grid cursor → distance 0', () => {
    const r = findSnapTarget({ x: 10, y: 10 }, {}, { gridSpacing: 5 });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.distance).toBeCloseTo(0, 6);
  });

  it('grid disabled → no grid candidate; returns null when nothing else is on offer', () => {
    const r = findSnapTarget({ x: 3, y: 7 }, {}, { enableGrid: false });
    expect(r).toBeNull();
  });

  it('uses default gridSpacing 5 when not supplied', () => {
    const r = findSnapTarget({ x: 1, y: 1 }, {});
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.pos).toEqual({ x: 0, y: 0 });
  });

  it('grid candidate beyond threshold is dropped', () => {
    // spacing 100, threshold 5 → nearest node is at (0,0), 50/50 away.
    const r = findSnapTarget({ x: 50, y: 50 }, {}, { gridSpacing: 100, pointRadius: 5 });
    expect(r).toBeNull();
  });
});

describe('findSnapTarget — point snap', () => {
  const entities: SnapEntities = {
    points: [
      { id: 'p1', x: 10, y: 10 },
      { id: 'p2', x: 50, y: 50 },
    ],
  };

  it('cursor within threshold of existing point → snaps to it', () => {
    const r = findSnapTarget({ x: 11, y: 10.5 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('point');
    expect(r!.refId).toBe('p1');
    expect(r!.pos).toEqual({ x: 10, y: 10 });
  });

  it('cursor outside threshold of any point → null (grid off)', () => {
    const r = findSnapTarget({ x: 30, y: 30 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).toBeNull();
  });

  it('enablePointSnap false → point ignored', () => {
    const r = findSnapTarget({ x: 10, y: 10 }, entities, {
      enableGrid: false,
      enablePointSnap: false,
    });
    expect(r).toBeNull();
  });

  it('picks nearer point when two are in range', () => {
    const ents: SnapEntities = {
      points: [
        { id: 'a', x: 10, y: 10 },
        { id: 'b', x: 13, y: 10 },
      ],
    };
    const r = findSnapTarget({ x: 12, y: 10 }, ents, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r!.refId).toBe('b');
  });
});

describe('findSnapTarget — line endpoint / midpoint', () => {
  const entities: SnapEntities = {
    lines: [
      { id: 'L1', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
    ],
  };

  it('cursor near line.p1 → line_endpoint', () => {
    const r = findSnapTarget({ x: 1, y: 1 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('line_endpoint');
    expect(r!.refId).toBe('L1');
    expect(r!.pos).toEqual({ x: 0, y: 0 });
  });

  it('cursor near line.p2 → line_endpoint with p2 coords', () => {
    const r = findSnapTarget({ x: 99, y: 1 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r!.kind).toBe('line_endpoint');
    expect(r!.pos).toEqual({ x: 100, y: 0 });
  });

  it('cursor near midpoint → line_midpoint', () => {
    const r = findSnapTarget({ x: 50, y: 1 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('line_midpoint');
    expect(r!.refId).toBe('L1');
    expect(r!.pos).toEqual({ x: 50, y: 0 });
  });

  it('cursor outside threshold of line → null', () => {
    const r = findSnapTarget({ x: 25, y: 25 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).toBeNull();
  });
});

describe('findSnapTarget — circle center', () => {
  const entities: SnapEntities = {
    circles: [{ id: 'C1', center: { x: 30, y: 40 }, radius: 10 }],
  };

  it('cursor near (cx, cy) → circle_center', () => {
    const r = findSnapTarget({ x: 31, y: 40 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('circle_center');
    expect(r!.refId).toBe('C1');
    expect(r!.pos).toEqual({ x: 30, y: 40 });
  });

  it('circle disabled via enablePointSnap=false → null (no grid)', () => {
    const r = findSnapTarget({ x: 30, y: 40 }, entities, {
      enableGrid: false,
      enablePointSnap: false,
    });
    expect(r).toBeNull();
  });
});

describe('findSnapTarget — intersection (line/line)', () => {
  const entities: SnapEntities = {
    lines: [
      // Horizontal at y=10, vertical at x=10 → intersect at (10, 10).
      { id: 'H', p1: { x: 0, y: 10 }, p2: { x: 20, y: 10 } },
      { id: 'V', p1: { x: 10, y: 0 }, p2: { x: 10, y: 20 } },
    ],
  };

  it('cursor near crossing point → intersection', () => {
    const r = findSnapTarget({ x: 11, y: 11 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('intersection');
    expect(r!.pos.x).toBeCloseTo(10, 6);
    expect(r!.pos.y).toBeCloseTo(10, 6);
    expect(r!.refId).toBe('H|V');
  });

  it('parallel lines → no intersection candidate', () => {
    const ents: SnapEntities = {
      lines: [
        { id: 'A', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 } },
        { id: 'B', p1: { x: 0, y: 5 }, p2: { x: 10, y: 5 } },
      ],
    };
    const r = findSnapTarget({ x: 5, y: 2.5 }, ents, {
      enableGrid: false,
      enablePointSnap: false,
      pointRadius: 5,
    });
    // Neither line endpoint/mid is in range; no intersection exists.
    expect(r).toBeNull();
  });

  it('non-overlapping segments (lines miss each other) → no candidate', () => {
    const ents: SnapEntities = {
      lines: [
        { id: 'A', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 } },
        { id: 'B', p1: { x: 100, y: -10 }, p2: { x: 100, y: 10 } },
      ],
    };
    const r = findSnapTarget({ x: 50, y: 0 }, ents, {
      enableGrid: false,
      enablePointSnap: false,
      pointRadius: 5,
    });
    expect(r).toBeNull();
  });

  it('enableIntersection=false → intersection skipped', () => {
    const r = findSnapTarget({ x: 10, y: 10 }, entities, {
      enableGrid: false,
      enablePointSnap: false,
      enableIntersection: false,
      pointRadius: 5,
    });
    expect(r).toBeNull();
  });
});

describe('findSnapTarget — priority ordering', () => {
  it('point and grid both at distance 0 → point wins (priority lower)', () => {
    const entities: SnapEntities = {
      points: [{ id: 'p1', x: 5, y: 5 }],
    };
    const r = findSnapTarget({ x: 5, y: 5 }, entities, { gridSpacing: 5 });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('point');
    expect(r!.refId).toBe('p1');
  });

  it('intersection vs line_endpoint at equal distance → intersection wins', () => {
    // Two lines cross at (10,10). A separate line has an endpoint also at (10,10).
    const entities: SnapEntities = {
      lines: [
        { id: 'A', p1: { x: 0, y: 10 }, p2: { x: 20, y: 10 } },
        { id: 'B', p1: { x: 10, y: 0 }, p2: { x: 10, y: 20 } },
        { id: 'C', p1: { x: 10, y: 10 }, p2: { x: 50, y: 50 } },
      ],
    };
    const r = findSnapTarget({ x: 10, y: 10 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('intersection');
  });

  it('nearer candidate beats higher-priority distant candidate', () => {
    const entities: SnapEntities = {
      points: [{ id: 'p1', x: 4, y: 0 }], // distance 4 from cursor
    };
    // Grid spacing 5 → nearest node (0,0) distance 0.
    const r = findSnapTarget({ x: 0, y: 0 }, entities, {
      gridSpacing: 5,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
  });
});

describe('findSnapTarget — threshold + null cases', () => {
  it('all candidates beyond threshold → null', () => {
    const entities: SnapEntities = {
      points: [{ id: 'p1', x: 1000, y: 1000 }],
    };
    const r = findSnapTarget({ x: 0, y: 0 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).toBeNull();
  });

  it('empty entities + grid disabled → null', () => {
    const r = findSnapTarget({ x: 0, y: 0 }, {}, { enableGrid: false });
    expect(r).toBeNull();
  });

  it('distance is reported in input units', () => {
    const entities: SnapEntities = {
      points: [{ id: 'p1', x: 3, y: 4 }],
    };
    const r = findSnapTarget({ x: 0, y: 0 }, entities, {
      enableGrid: false,
      pointRadius: 10,
    });
    expect(r).not.toBeNull();
    expect(r!.distance).toBeCloseTo(5, 6); // 3-4-5 triangle
  });

  it('threshold exactly at distance → still snaps (≤ is inclusive)', () => {
    const entities: SnapEntities = {
      points: [{ id: 'p1', x: 5, y: 0 }],
    };
    const r = findSnapTarget({ x: 0, y: 0 }, entities, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('point');
  });

  it('uses default pointRadius 5 when not supplied', () => {
    const entities: SnapEntities = {
      points: [{ id: 'p1', x: 4, y: 0 }],
    };
    const r = findSnapTarget({ x: 0, y: 0 }, entities, { enableGrid: false });
    expect(r).not.toBeNull();
    expect(r!.refId).toBe('p1');
  });
});

describe('findSnapTarget — pairKey stability for intersections', () => {
  it('intersection refId is sorted alphabetically regardless of line order', () => {
    const a: SnapEntities = {
      lines: [
        { id: 'zzz', p1: { x: 0, y: 10 }, p2: { x: 20, y: 10 } },
        { id: 'aaa', p1: { x: 10, y: 0 }, p2: { x: 10, y: 20 } },
      ],
    };
    const r = findSnapTarget({ x: 10, y: 10 }, a, {
      enableGrid: false,
      pointRadius: 5,
    });
    expect(r!.refId).toBe('aaa|zzz');
  });
});
