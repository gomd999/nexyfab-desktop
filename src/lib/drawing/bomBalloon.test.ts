/**
 * bomBalloon.test — SolidWorks-parity Phase 3.
 * Pure IR tests: BOM dedup / deterministic numbering + balloon placement
 * (ring positions, collision avoidance) on synthetic layouts.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBomRows,
  bomGroupKey,
  bomItemNoIndex,
  placeBalloons,
  BomBalloonError,
  type BalloonAnchor,
} from './bomBalloon';

// ─── buildBomRows ──────────────────────────────────────────────────────────

describe('buildBomRows — dedup + deterministic numbering', () => {
  it('collapses identical (name, material) pairs into one row with qty', () => {
    const rows = buildBomRows([
      { name: 'Bracket', material: 'AL6061' },
      { name: 'Base' },
      { name: 'Bracket', material: 'AL6061' },
    ]);
    expect(rows).toHaveLength(2);
    const bracket = rows.find((r) => r.name === 'Bracket')!;
    expect(bracket.qty).toBe(2);
    expect(bracket.material).toBe('AL6061');
    const base = rows.find((r) => r.name === 'Base')!;
    expect(base.qty).toBe(1);
    expect(base.material).toBe('');
  });

  it('numbers rows 1..N ascending by name regardless of input order', () => {
    const a = buildBomRows([{ name: 'Zeta' }, { name: 'Alpha' }, { name: 'Mid' }]);
    const b = buildBomRows([{ name: 'Mid' }, { name: 'Zeta' }, { name: 'Alpha' }]);
    expect(a).toEqual(b);
    expect(a.map((r) => [r.itemNo, r.name])).toEqual([
      [1, 'Alpha'],
      [2, 'Mid'],
      [3, 'Zeta'],
    ]);
  });

  it('same name + different material → separate rows, ties broken by material', () => {
    const rows = buildBomRows([
      { name: 'Plate', material: 'SS304' },
      { name: 'Plate', material: 'AL6061' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ itemNo: 1, name: 'Plate', material: 'AL6061' });
    expect(rows[1]).toMatchObject({ itemNo: 2, name: 'Plate', material: 'SS304' });
  });

  it('empty part name throws', () => {
    expect(() => buildBomRows([{ name: '' }])).toThrow(BomBalloonError);
  });

  it('empty list → empty rows', () => {
    expect(buildBomRows([])).toEqual([]);
  });

  it('bomItemNoIndex maps the group key back to the row itemNo', () => {
    const rows = buildBomRows([
      { name: 'B', material: 'steel' },
      { name: 'A' },
    ]);
    const idx = bomItemNoIndex(rows);
    expect(idx.get(bomGroupKey({ name: 'A' }))).toBe(1);
    expect(idx.get(bomGroupKey({ name: 'B', material: 'steel' }))).toBe(2);
  });
});

// ─── placeBalloons ─────────────────────────────────────────────────────────

const BOX = { x: 100, y: 60, w: 200, h: 150 };

function anchorsAt(
  positions: ReadonlyArray<{ x: number; y: number }>,
): BalloonAnchor[] {
  return positions.map((p, i) => ({ id: `p${i + 1}`, itemNo: i + 1, anchor: p }));
}

function pairwiseMinDistance(pts: ReadonlyArray<{ x: number; y: number }>): number {
  let min = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
  }
  return min;
}

describe('placeBalloons — ring placement + collision avoidance', () => {
  it('returns one balloon per anchor, preserving itemNo + anchor', () => {
    const anchors = anchorsAt([
      { x: 150, y: 100 },
      { x: 250, y: 150 },
    ]);
    const balloons = placeBalloons({ anchors, box: BOX });
    expect(balloons).toHaveLength(2);
    const byId = new Map(balloons.map((b) => [b.id, b]));
    expect(byId.get('balloon-p1')!.itemNo).toBe(1);
    expect(byId.get('balloon-p1')!.anchor).toEqual({ x: 150, y: 100 });
    expect(byId.get('balloon-p2')!.itemNo).toBe(2);
  });

  it('balloon centres sit on the ring rectangle OUTSIDE the viewport box', () => {
    const anchors = anchorsAt([
      { x: 120, y: 80 },
      { x: 280, y: 190 },
      { x: 200, y: 135 },
    ]);
    const standoff = 10;
    const balloons = placeBalloons({ anchors, box: BOX, standoff });
    const ring = {
      x: BOX.x - standoff, y: BOX.y - standoff,
      w: BOX.w + 2 * standoff, h: BOX.h + 2 * standoff,
    };
    for (const b of balloons) {
      // Outside (or on the boundary of) the viewport box…
      const insideBox =
        b.center.x > BOX.x && b.center.x < BOX.x + BOX.w
        && b.center.y > BOX.y && b.center.y < BOX.y + BOX.h;
      expect(insideBox).toBe(false);
      // …and exactly on the ring rectangle's boundary.
      const onV =
        (Math.abs(b.center.x - ring.x) < 1e-6 || Math.abs(b.center.x - (ring.x + ring.w)) < 1e-6)
        && b.center.y >= ring.y - 1e-6 && b.center.y <= ring.y + ring.h + 1e-6;
      const onH =
        (Math.abs(b.center.y - ring.y) < 1e-6 || Math.abs(b.center.y - (ring.y + ring.h)) < 1e-6)
        && b.center.x >= ring.x - 1e-6 && b.center.x <= ring.x + ring.w + 1e-6;
      expect(onV || onH).toBe(true);
    }
  });

  it('clustered anchors (all at the same point) → no two balloons overlap', () => {
    const radius = 4;
    const anchors = anchorsAt(
      Array.from({ length: 10 }, () => ({ x: 200, y: 135 })),
    );
    const balloons = placeBalloons({ anchors, box: BOX, radius });
    expect(balloons).toHaveLength(10);
    const minDist = pairwiseMinDistance(balloons.map((b) => b.center));
    expect(minDist).toBeGreaterThanOrEqual(2 * radius);
  });

  it('anchors crowded into one corner → spacing still ≥ 2·radius', () => {
    const radius = 4;
    const anchors = anchorsAt(
      Array.from({ length: 8 }, (_, i) => ({
        x: BOX.x + 2 + i * 0.5,
        y: BOX.y + 2 + i * 0.25,
      })),
    );
    const balloons = placeBalloons({ anchors, box: BOX, radius });
    const minDist = pairwiseMinDistance(balloons.map((b) => b.center));
    expect(minDist).toBeGreaterThanOrEqual(2 * radius);
  });

  it('placement is deterministic (same input → same output)', () => {
    const anchors = anchorsAt([
      { x: 150, y: 100 },
      { x: 150, y: 100 },
      { x: 260, y: 180 },
    ]);
    const a = placeBalloons({ anchors, box: BOX });
    const b = placeBalloons({ anchors, box: BOX });
    expect(a).toEqual(b);
  });

  it('degenerate anchor at the exact box centre still places a balloon', () => {
    const balloons = placeBalloons({
      anchors: anchorsAt([{ x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 }]),
      box: BOX,
    });
    expect(balloons).toHaveLength(1);
    expect(Number.isFinite(balloons[0].center.x)).toBe(true);
    expect(Number.isFinite(balloons[0].center.y)).toBe(true);
  });

  it('empty anchors → empty result', () => {
    expect(placeBalloons({ anchors: [], box: BOX })).toEqual([]);
  });

  it('invalid box throws', () => {
    expect(() =>
      placeBalloons({ anchors: anchorsAt([{ x: 0, y: 0 }]), box: { x: 0, y: 0, w: 0, h: 10 } }),
    ).toThrow(BomBalloonError);
  });

  it('duplicate anchor ids throw', () => {
    const dup: BalloonAnchor[] = [
      { id: 'same', itemNo: 1, anchor: { x: 110, y: 70 } },
      { id: 'same', itemNo: 2, anchor: { x: 120, y: 80 } },
    ];
    expect(() => placeBalloons({ anchors: dup, box: BOX })).toThrow(/duplicate anchor id/);
  });

  it('physically impossible balloon count throws', () => {
    const tiny = { x: 0, y: 0, w: 10, h: 10 };
    const many = anchorsAt(
      Array.from({ length: 50 }, (_, i) => ({ x: (i % 10) + 0.5, y: 5 })),
    );
    expect(() =>
      placeBalloons({ anchors: many, box: tiny, radius: 4, standoff: 2 }),
    ).toThrow(BomBalloonError);
  });
});
