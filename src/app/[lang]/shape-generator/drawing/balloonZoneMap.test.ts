import { describe, it, expect } from 'vitest';
import {
  buildZoneMap,
  balloonsInZone,
  findZoneOfBalloon,
  balloonsNearZone,
  summarize,
  type BalloonPlacement,
} from './balloonZoneMap';

function balloon(id: string, x: number, y: number): BalloonPlacement {
  return { balloonId: id, position: { x, y } };
}

describe('buildZoneMap', () => {
  it('empty input → empty result', () => {
    const r = buildZoneMap([]);
    expect(r.assignments).toEqual([]);
  });

  it('assigns balloon to zone', () => {
    const r = buildZoneMap([balloon('1', 50, 50)]);
    expect(r.assignments[0]!.zone.length).toBeGreaterThan(0);
    expect(r.assignments[0]!.outOfGrid).toBe(false);
  });

  it('out-of-grid balloon flagged', () => {
    const r = buildZoneMap([balloon('1', -100, -100)]);
    expect(r.assignments[0]!.outOfGrid).toBe(true);
    expect(r.outOfGridCount).toBe(1);
  });

  it('byZone aggregates multiple balloons', () => {
    const r = buildZoneMap([
      balloon('a', 50, 50),
      balloon('b', 55, 52),
    ]);
    const zoneCount = r.byZone.size;
    expect(zoneCount).toBeGreaterThanOrEqual(1);
  });

  it('uses configured columns + rows', () => {
    const r = buildZoneMap([balloon('1', 200, 100)], { cols: 10, rows: 5 });
    expect(r.assignments[0]!.column).toBeGreaterThanOrEqual(0);
    expect(r.assignments[0]!.row).toBeGreaterThanOrEqual(0);
  });

  it('top-left zone is A1', () => {
    const r = buildZoneMap([balloon('1', 10, 10)], {
      origin: { x: 0, y: 0 }, widthMm: 100, heightMm: 100, cols: 5, rows: 5,
    });
    expect(r.assignments[0]!.zone).toBe('A1');
  });

  it('out-of-grid not counted in byZone', () => {
    const r = buildZoneMap([balloon('out', -50, -50), balloon('in', 50, 50)]);
    expect(r.byZone.size).toBe(1);
  });
});

describe('balloonsInZone', () => {
  it('returns balloons by zone label', () => {
    const r = buildZoneMap([balloon('1', 10, 10), balloon('2', 12, 12)], {
      cols: 5, rows: 5, widthMm: 100, heightMm: 100,
    });
    const list = balloonsInZone(r, 'A1');
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('empty list for unknown zone', () => {
    const r = buildZoneMap([balloon('1', 50, 50)]);
    expect(balloonsInZone(r, 'XYZ')).toEqual([]);
  });
});

describe('findZoneOfBalloon', () => {
  it('returns zone for known balloon', () => {
    const r = buildZoneMap([balloon('foo', 50, 50)]);
    expect(findZoneOfBalloon(r, 'foo')).not.toBeNull();
  });

  it('returns null for out-of-grid balloon', () => {
    const r = buildZoneMap([balloon('foo', -50, -50)]);
    expect(findZoneOfBalloon(r, 'foo')).toBeNull();
  });

  it('returns null for unknown balloon', () => {
    const r = buildZoneMap([]);
    expect(findZoneOfBalloon(r, 'ghost')).toBeNull();
  });
});

describe('balloonsNearZone', () => {
  it('returns balloons in 3x3 neighborhood', () => {
    const r = buildZoneMap(
      [balloon('a', 10, 10), balloon('b', 30, 30), balloon('c', 90, 90)],
      { cols: 5, rows: 5, widthMm: 100, heightMm: 100 },
    );
    const near = balloonsNearZone(r, 'B2', { cols: 5, rows: 5, widthMm: 100, heightMm: 100 });
    expect(near.length).toBeGreaterThan(0);
  });

  it('returns empty for unparsable zone', () => {
    const r = buildZoneMap([balloon('a', 50, 50)]);
    expect(balloonsNearZone(r, '???')).toEqual([]);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const r = buildZoneMap([]);
    const s = summarize(r);
    expect(s.balloonCount).toBe(0);
  });

  it('reports zones used and max-in-one', () => {
    const r = buildZoneMap([
      balloon('a', 10, 10), balloon('b', 12, 12), balloon('c', 90, 90),
    ], { cols: 5, rows: 5, widthMm: 100, heightMm: 100 });
    const s = summarize(r);
    expect(s.zonesUsed).toBeGreaterThanOrEqual(1);
    expect(s.maxBalloonsInOneZone).toBeGreaterThanOrEqual(1);
  });
});
