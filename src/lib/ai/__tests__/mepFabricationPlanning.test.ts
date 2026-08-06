import { describe, expect, it } from 'vitest';
import { planOrthogonalMepFittings, serviceOpeningsFromSleeves } from '../mepFabricationPlanning';

describe('MEP fabrication fittings and service openings', () => {
  it('creates tangent-controlled elbows on an orthogonal route', () => {
    const result = planOrthogonalMepFittings([[0, 0, 0], [1000, 0, 0], [1000, 1000, 0]], 100, 300);
    expect(result).toMatchObject({ status: 'passed', elbows: [{ tangentInMm: [700, 0, 0], bendRadiusMm: 300, angleDeg: 90 }] }); expect(result.elbows[0]!.tangentOutMm[1]).toBeCloseTo(300, 9);
  });
  it('blocks bends without enough straight tangent length', () => expect(planOrthogonalMepFittings([[0, 0, 0], [200, 0, 0], [200, 1000, 0]], 100, 300).failures[0]).toMatchObject({ code: 'INSUFFICIENT_TANGENT_LENGTH' }));
  it('plans the true 3D bend angle for uniformly sloped drainage legs', () => {
    const result = planOrthogonalMepFittings([[0, 0, 1000], [1000, 0, 980], [1000, 1000, 960]], 40, 120);
    expect(result.status).toBe('passed'); expect(result.elbows[0]!.angleDeg).toBeCloseTo(89.977, 2);
  });
  it('derives a traceable building opening from an approved sleeve', () => {
    const openings = serviceOpeningsFromSleeves([{ id: 'sleeve:1', routeId: 'pipe', hostId: 'wall', centerMm: [100, 0, 500], axis: [1, 0, 0], lengthMm: 200, insideDiameterMm: 60, approvalId: 'approval-1' }], 3, 10);
    expect(openings[0]).toMatchObject({ sourceSleeveId: 'sleeve:1', hostId: 'wall', cutDiameterMm: 66, depthMm: 200, firestopAnnulusMm: 10, structuralApprovalId: 'approval-1' });
  });
});
