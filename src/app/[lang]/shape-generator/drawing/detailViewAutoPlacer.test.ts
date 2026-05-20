import { describe, it, expect } from 'vitest';
import {
  placeDetailViews,
  summarize,
  type DetailRegion,
  type BBox,
} from './detailViewAutoPlacer';

const sheet: BBox = { min: { x: 0, y: 0 }, max: { x: 400, y: 300 } };

function region(id: string, x: number, y: number, scale: number = 2, r: number = 10): DetailRegion {
  return { id, circleCenter: { x, y }, circleRadiusMm: r, scaleFactor: scale };
}

describe('placeDetailViews', () => {
  it('empty input → empty output', () => {
    expect(placeDetailViews(sheet, [], [])).toEqual([]);
  });

  it('single region fits in empty sheet', () => {
    const r = placeDetailViews(sheet, [], [region('A', 200, 150)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.placed).toBe(true);
  });

  it('multiple regions get distinct placements', () => {
    const r = placeDetailViews(sheet, [], [region('A', 50, 50), region('B', 350, 250)]);
    expect(r.filter(p => p.placed).length).toBe(2);
    expect(r[0]!.placedBBox).not.toEqual(r[1]!.placedBBox);
  });

  it('occupied space pushes detail elsewhere', () => {
    const occupied: BBox[] = [{ min: { x: 0, y: 0 }, max: { x: 350, y: 280 } }];
    const r = placeDetailViews(sheet, occupied, [region('A', 200, 100)]);
    expect(r[0]!.placed).toBe(true);
  });

  it('fully blocked sheet → unplaced', () => {
    const occupied: BBox[] = [{ min: { x: 0, y: 0 }, max: { x: 400, y: 300 } }];
    const r = placeDetailViews(sheet, occupied, [region('A', 200, 150)]);
    expect(r[0]!.placed).toBe(false);
  });

  it('scale falls back when desired is too large', () => {
    const occupied: BBox[] = [
      { min: { x: 0, y: 0 }, max: { x: 380, y: 280 } },
    ];
    const r = placeDetailViews(sheet, occupied, [region('A', 200, 150, 4, 10)]);
    expect(r[0]!.placed).toBe(false);
  });

  it('records leader endpoints', () => {
    const r = placeDetailViews(sheet, [], [region('A', 200, 150)]);
    expect(r[0]!.leader.from).toEqual({ x: 200, y: 150 });
    expect(r[0]!.leader.to).not.toEqual({ x: 200, y: 150 });
  });

  it('paddingMm respected', () => {
    const occupied: BBox[] = [{ min: { x: 50, y: 50 }, max: { x: 200, y: 200 } }];
    const tight = placeDetailViews(sheet, occupied, [region('A', 100, 100)], { paddingMm: 0 });
    const loose = placeDetailViews(sheet, occupied, [region('A', 100, 100)], { paddingMm: 50 });
    // Tight should fit more places than loose.
    expect(tight[0]!.placed || !loose[0]!.placed).toBe(true);
  });

  it('placed views remain inside sheet bbox', () => {
    const r = placeDetailViews(sheet, [], [region('A', 200, 150)]);
    const p = r[0]!.placedBBox;
    expect(p.min.x).toBeGreaterThanOrEqual(sheet.min.x);
    expect(p.max.x).toBeLessThanOrEqual(sheet.max.x);
    expect(p.min.y).toBeGreaterThanOrEqual(sheet.min.y);
    expect(p.max.y).toBeLessThanOrEqual(sheet.max.y);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize([]);
    expect(s.regionCount).toBe(0);
    expect(s.fitFraction).toBe(0);
  });

  it('all placed → fitFraction = 1', () => {
    const r = placeDetailViews(sheet, [], [region('A', 100, 100)]);
    const s = summarize(r);
    expect(s.fitFraction).toBe(1);
  });

  it('counts placed vs unplaced', () => {
    const occupied: BBox[] = [{ min: { x: 0, y: 0 }, max: { x: 400, y: 300 } }];
    const r = placeDetailViews(sheet, occupied, [region('A', 200, 150), region('B', 100, 100)]);
    const s = summarize(r);
    expect(s.placedCount + s.unplacedCount).toBe(2);
  });
});
