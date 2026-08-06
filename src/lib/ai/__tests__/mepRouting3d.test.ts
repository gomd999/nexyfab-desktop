import { describe, expect, it } from 'vitest';
import { planMepPenetrationSleeves, routeMepOrthogonal3d } from '../mepRouting3d';

describe('bounded 3D MEP routing and penetrations', () => {
  it('routes orthogonally around a clearance obstacle', () => {
    const result = routeMepOrthogonal3d({ id: 'duct', system: 'supply_air', startMm: [0, 0, 0], endMm: [4000, 0, 0], clearanceMm: 100, gridMm: 500, obstacles: [{ id: 'beam', minMm: [1500, -500, -500], maxMm: [2500, 500, 500] }] });
    expect(result.status).toBe('routed'); expect(result.pathMm.length).toBeGreaterThan(2); expect(result.lengthMm).toBeGreaterThan(4000);
    expect(result.pathMm.every(point => !(point[0] >= 1400 && point[0] <= 2600 && point[1] >= -600 && point[1] <= 600 && point[2] >= -600 && point[2] <= 600))).toBe(true);
  });
  it('keeps gravity drainage not_run until a sloped solver is used', () => expect(routeMepOrthogonal3d({ id: 'drain', system: 'drain', startMm: [0, 0, 100], endMm: [1000, 0, 0], clearanceMm: 0, gridMm: 100, obstacles: [] }).status).toBe('not_run'));
  it('cannot tunnel through an obstacle thinner than the routing grid', () => {
    const result = routeMepOrthogonal3d({ id: 'cable', system: 'electrical', startMm: [0, 0, 0], endMm: [2000, 0, 0], clearanceMm: 0, gridMm: 500, obstacles: [{ id: 'thin-wall', minMm: [740, -100, -100], maxMm: [760, 100, 100] }] });
    expect(result.status).toBe('routed'); expect(result.lengthMm).toBeGreaterThan(2000);
  });
  it('creates measured sleeves and blocks unapproved structural penetrations', () => {
    const passed = planMepPenetrationSleeves('pipe', [[0, 0, 0], [4000, 0, 0]], 40, 10, [{ id: 'wall', kind: 'wall', minMm: [1900, -100, -100], maxMm: [2100, 100, 100], penetrationAllowed: true }]);
    expect(passed.sleeves[0]).toMatchObject({ centerMm: [2000, 0, 0], axis: [1, 0, 0], insideDiameterMm: 60 }); expect(passed.sleeves[0]!.lengthMm).toBeCloseTo(200, 9);
    const blocked = planMepPenetrationSleeves('pipe', [[0, 0, 0], [4000, 0, 0]], 40, 10, [{ id: 'beam', kind: 'structure', minMm: [1900, -100, -100], maxMm: [2100, 100, 100], penetrationAllowed: true }]);
    expect(blocked).toMatchObject({ status: 'blocked', blockers: [{ hostId: 'beam', code: 'STRUCTURAL_APPROVAL_REQUIRED' }] });
  });
});
