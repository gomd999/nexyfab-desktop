import { describe, it, expect } from 'vitest';
import { pathLengthStraight, samplePath, withBendArcs, type RoutingPath } from './routingPath';
import { detectFittings, STANDARD_PIPE_FITTINGS, nearestStandardFitting } from './routingFittings';
import { validateBendRadius, validateClearance, validateInterRouteInterference, type Obstacle } from './routingValidate';

const path: RoutingPath = {
  id: 'p1',
  kind: 'pipe',
  diameterMm: 15,
  defaultBendRadiusMm: 30,
  points: [
    { position: [0, 0, 0] },
    { position: [100, 0, 0] },
    { position: [100, 100, 0] },
    { position: [100, 100, 50] },
  ],
};

describe('routingPath', () => {
  it('pathLengthStraight sums segments', () => {
    expect(pathLengthStraight(path)).toBeCloseTo(250, 0);
  });

  it('samplePath produces sample chain', () => {
    const s = samplePath(path, 20);
    expect(s.length).toBeGreaterThan(10);
    expect(s[0]!.s).toBe(0);
  });

  it('withBendArcs adds arc midpoints at corners', () => {
    const adjusted = withBendArcs(path, 4);
    expect(adjusted.length).toBeGreaterThan(path.points.length);
  });

  it('empty path returns empty samples', () => {
    expect(samplePath({ ...path, points: [] }, 10)).toEqual([]);
  });
});

describe('routingFittings', () => {
  it('detects elbows at corners', () => {
    const fittings = detectFittings(path);
    const elbows = fittings.filter(f => f.kind === 'elbow-90' || f.kind === 'elbow-45');
    expect(elbows.length).toBeGreaterThan(0);
  });

  it('places end caps at unattached ends', () => {
    const fittings = detectFittings(path);
    expect(fittings.filter(f => f.kind === 'end-cap')).toHaveLength(2);
  });

  it('STANDARD_PIPE_FITTINGS has 1/2" elbow', () => {
    expect(STANDARD_PIPE_FITTINGS.some(f => f.kind === 'elbow-90' && f.diameterMm === 15)).toBe(true);
  });

  it('nearestStandardFitting picks closest diameter', () => {
    const r = nearestStandardFitting('elbow-90', 18);
    expect(r?.diameterMm).toBe(20);
  });

  it('returns null when no standard matches the kind', () => {
    const r = nearestStandardFitting('cross', 15);
    expect(r).toBeNull();
  });
});

describe('routingValidate', () => {
  it('flags too-short path', () => {
    const issues = validateBendRadius({ ...path, points: [] });
    expect(issues.some(i => i.code === 'PATH_TOO_SHORT')).toBe(true);
  });

  it('flags bend radius below pipe minimum', () => {
    const tight: RoutingPath = {
      ...path,
      defaultBendRadiusMm: 5, // below 15 × 1.5 = 22.5
    };
    const issues = validateBendRadius(tight);
    expect(issues.some(i => i.code === 'BEND_TOO_TIGHT')).toBe(true);
  });

  it('does not flag straight runs', () => {
    const straight: RoutingPath = {
      ...path,
      points: [{ position: [0, 0, 0] }, { position: [100, 0, 0] }],
    };
    const issues = validateBendRadius(straight);
    expect(issues.filter(i => i.code === 'BEND_TOO_TIGHT')).toHaveLength(0);
  });

  it('clearance check flags too-close obstacles', () => {
    const obs: Obstacle = {
      id: 'wall',
      min: [40, -5, -5], max: [60, 5, 5],
      clearanceMm: 20,
    };
    const issues = validateClearance(path, [obs]);
    expect(issues.some(i => i.code === 'CLEARANCE_VIOLATION')).toBe(true);
  });

  it('inter-route interference flags close paths', () => {
    const p2: RoutingPath = {
      ...path, id: 'p2',
      points: [{ position: [0, 1, 0] }, { position: [100, 1, 0] }],
    };
    const issues = validateInterRouteInterference([path, p2], 5);
    expect(issues.some(i => i.code === 'INTER_ROUTE_INTERFERENCE')).toBe(true);
  });
});
