import { describe, expect, it } from 'vitest';
import { panelizeCurvedFacade, verifyArchitecturalCirculation, type ArchitecturalCirculationModel, type CirculationRules } from '../architecturalCirculation';

const rules: CirculationRules = { maximumRiserMm: 180, minimumTreadMm: 260, minimumStairWidthMm: 1000, minimumHeadroomMm: 2100, minimumCorridorWidthMm: 1200, minimumCorridorHeightMm: 2100, minimumRailingHeightMm: 1100, maximumRampSlopePercent: 8.33, minimumRampWidthMm: 1200 };
const model: ArchitecturalCirculationModel = { schema: 'nexyfab.architecture-circulation.v1', stairs: [{ id: 'stair', fromStoreyId: 'l1', toStoreyId: 'l2', widthMm: 1200, totalRiseMm: 3060, riserMm: 170, treadMm: 280, riserCount: 18, flightCount: 2, landingDepthMm: 1200, headroomMm: 2200 }], corridors: [{ id: 'corridor', storeyId: 'l1', pathMm: [[0, 0], [5000, 0]], clearWidthMm: 1500, clearHeightMm: 2400 }], balconies: [{ id: 'balcony', storeyId: 'l1', boundaryMm: [[0, 0], [3000, 0], [3000, 1500], [0, 1500]], accessOpeningId: 'door', railingHeightMm: 1200, drainageSlopePercent: 1.5 }], ramps: [{ id: 'ramp', fromStoreyId: 'site', toStoreyId: 'l1', pathMm: [[0, 0], [12000, 0]], clearWidthMm: 1500, riseMm: 800, landingLengthMm: 1500 }] };

describe('governed architectural circulation and curved facade', () => {
  it('passes measured stair, corridor, balcony, and ramp dimensions', () => expect(verifyArchitecturalCirculation(model, rules).status).toBe('passed'));
  it('does not claim a pass without governing rules', () => expect(verifyArchitecturalCirculation(model).status).toBe('not_run'));
  it('reports each unsafe dimension instead of averaging a project score', () => {
    const unsafe = structuredClone(model); unsafe.stairs[0]!.riserMm = 200; unsafe.corridors[0]!.clearWidthMm = 900; unsafe.balconies[0]!.railingHeightMm = 900; unsafe.ramps[0]!.riseMm = 1600;
    const codes = verifyArchitecturalCirculation(unsafe, rules).failures.map(item => item.code);
    expect(codes).toEqual(expect.arrayContaining(['STAIR_RISE_INCONSISTENT', 'RISER_TOO_HIGH', 'CORRIDOR_TOO_NARROW', 'RAILING_TOO_LOW', 'RAMP_TOO_STEEP']));
  });
  it('panelizes an arc within maximum arc width while retaining exact angles', () => {
    const panels = panelizeCurvedFacade(10000, 0, 90, 2000);
    expect(panels).toHaveLength(8); expect(panels[0]!.startAngleDeg).toBe(0); expect(panels.at(-1)!.endAngleDeg).toBe(90);
    expect(panels.every(panel => panel.chordWidthMm <= 2000)).toBe(true);
  });
});
