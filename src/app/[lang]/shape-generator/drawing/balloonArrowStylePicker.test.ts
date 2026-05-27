import { describe, it, expect } from 'vitest';
import {
  chooseArrowStyle,
  buildLeader,
  findCrossingLeaders,
  arrowHeadPolygon,
  validateBulk,
  summarize,
  type Balloon,
} from './balloonArrowStylePicker';

function balloon(id: string, x: number, y: number, target: Balloon['target']['type'], tx: number, ty: number, isRef: boolean = false): Balloon {
  return {
    id,
    position: { x, y },
    itemNumber: 1,
    target: { type: target, point: { x: tx, y: ty } },
    ...(isRef ? { isReference: true } : {}),
  };
}

describe('chooseArrowStyle', () => {
  it('edge → solid', () => {
    expect(chooseArrowStyle(balloon('b1', 0, 0, 'edge', 10, 0))).toBe('solid');
  });

  it('face → dot', () => {
    expect(chooseArrowStyle(balloon('b1', 0, 0, 'face', 10, 0))).toBe('dot');
  });

  it('reference → open', () => {
    expect(chooseArrowStyle(balloon('b1', 0, 0, 'reference', 10, 0, true))).toBe('open');
  });

  it('isReference overrides target type', () => {
    expect(chooseArrowStyle(balloon('b1', 0, 0, 'edge', 10, 0, true))).toBe('open');
  });
});

describe('buildLeader', () => {
  it('polyline from balloon to tip', () => {
    const leader = buildLeader(balloon('b1', 0, 0, 'edge', 10, 0));
    expect(leader.polyline).toHaveLength(2);
    expect(leader.tipPosition).toEqual({ x: 10, y: 0 });
  });

  it('tipDirection normalised', () => {
    const leader = buildLeader(balloon('b1', 0, 0, 'edge', 3, 4));
    expect(Math.hypot(leader.tipDirection.x, leader.tipDirection.y)).toBeCloseTo(1, 5);
  });

  it('style applied from target type', () => {
    expect(buildLeader(balloon('b1', 0, 0, 'face', 10, 0)).style).toBe('dot');
  });
});

describe('findCrossingLeaders', () => {
  it('non-crossing → empty', () => {
    const leaders = [
      buildLeader(balloon('b1', 0, 0, 'edge', 100, 0)),
      buildLeader(balloon('b2', 0, 50, 'edge', 100, 50)),
    ];
    expect(findCrossingLeaders(leaders)).toEqual([]);
  });

  it('crossing leaders detected', () => {
    const leaders = [
      buildLeader(balloon('b1', 0, 0, 'edge', 10, 10)),
      buildLeader(balloon('b2', 10, 0, 'edge', 0, 10)),
    ];
    expect(findCrossingLeaders(leaders)).toHaveLength(1);
  });
});

describe('arrowHeadPolygon', () => {
  it('solid produces triangle', () => {
    const leader = buildLeader(balloon('b1', 0, 0, 'edge', 10, 0));
    const head = arrowHeadPolygon(leader);
    expect(head.style).toBe('solid');
    expect(head.vertices).toHaveLength(3);
    expect(head.filled).toBe(true);
  });

  it('dot produces circle samples', () => {
    const leader = buildLeader(balloon('b1', 0, 0, 'face', 10, 0));
    const head = arrowHeadPolygon(leader);
    expect(head.style).toBe('dot');
    expect(head.vertices.length).toBeGreaterThan(4);
  });

  it('open uses triangle but unfilled', () => {
    const leader = buildLeader(balloon('b1', 0, 0, 'reference', 10, 0, true));
    const head = arrowHeadPolygon(leader);
    expect(head.style).toBe('open');
    expect(head.filled).toBe(false);
  });
});

describe('validateBulk', () => {
  it('counts styles', () => {
    const balloons = [
      balloon('b1', 0, 0, 'edge', 10, 0),
      balloon('b2', 0, 0, 'face', 10, 10),
    ];
    const r = validateBulk(balloons);
    expect(r.styleCounts.solid).toBe(1);
    expect(r.styleCounts.dot).toBe(1);
  });

  it('reports conflicts', () => {
    const balloons = [
      balloon('b1', 0, 0, 'edge', 10, 10),
      balloon('b2', 10, 0, 'edge', 0, 10),
    ];
    expect(validateBulk(balloons).conflicts).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const balloons = [balloon('b1', 0, 0, 'edge', 10, 0), balloon('b2', 0, 0, 'face', 5, 5)];
    const r = validateBulk(balloons);
    const s = summarize(r);
    expect(s.balloonCount).toBe(2);
  });
});
