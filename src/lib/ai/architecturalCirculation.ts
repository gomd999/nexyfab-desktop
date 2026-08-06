type V2 = [number, number];
export interface ArchitectureStair { id: string; fromStoreyId: string; toStoreyId: string; widthMm: number; totalRiseMm: number; riserMm: number; treadMm: number; riserCount: number; flightCount: number; landingDepthMm: number; headroomMm: number }
export interface ArchitectureCorridor { id: string; storeyId: string; pathMm: V2[]; clearWidthMm: number; clearHeightMm: number }
export interface ArchitectureBalcony { id: string; storeyId: string; boundaryMm: V2[]; accessOpeningId: string; railingHeightMm: number; drainageSlopePercent: number }
export interface ArchitectureRamp { id: string; fromStoreyId: string; toStoreyId: string; pathMm: V2[]; clearWidthMm: number; riseMm: number; landingLengthMm: number }
export interface ArchitecturalCirculationModel { schema: 'nexyfab.architecture-circulation.v1'; stairs: ArchitectureStair[]; corridors: ArchitectureCorridor[]; balconies: ArchitectureBalcony[]; ramps: ArchitectureRamp[] }
export interface CirculationRules { maximumRiserMm: number; minimumTreadMm: number; minimumStairWidthMm: number; minimumHeadroomMm: number; minimumCorridorWidthMm: number; minimumCorridorHeightMm: number; minimumRailingHeightMm: number; maximumRampSlopePercent: number; minimumRampWidthMm: number }
export interface CirculationVerification { status: 'passed' | 'failed' | 'not_run'; failures: Array<{ objectId: string; code: string; measured?: number; required?: number }>; method: 'governed_semantic_dimensions' }

const pathLength = (path: V2[]) => path.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - path[index]![0], point[1] - path[index]![1]), 0);
export function verifyArchitecturalCirculation(model: ArchitecturalCirculationModel, rules?: CirculationRules): CirculationVerification {
  if (!rules) return { status: 'not_run', failures: [{ objectId: 'project', code: 'GOVERNING_RULES_MISSING' }], method: 'governed_semantic_dimensions' };
  const failures: CirculationVerification['failures'] = [];
  for (const stair of model.stairs) {
    if (![stair.widthMm, stair.totalRiseMm, stair.riserMm, stair.treadMm, stair.landingDepthMm, stair.headroomMm].every(value => value > 0 && Number.isFinite(value)) || !Number.isSafeInteger(stair.riserCount) || stair.riserCount < 1 || !Number.isSafeInteger(stair.flightCount) || stair.flightCount < 1) failures.push({ objectId: stair.id, code: 'INVALID_STAIR_GEOMETRY' });
    if (Math.abs(stair.riserCount * stair.riserMm - stair.totalRiseMm) > Math.max(2, stair.totalRiseMm * 0.005)) failures.push({ objectId: stair.id, code: 'STAIR_RISE_INCONSISTENT' });
    if (stair.riserMm > rules.maximumRiserMm) failures.push({ objectId: stair.id, code: 'RISER_TOO_HIGH', measured: stair.riserMm, required: rules.maximumRiserMm });
    if (stair.treadMm < rules.minimumTreadMm) failures.push({ objectId: stair.id, code: 'TREAD_TOO_SHALLOW', measured: stair.treadMm, required: rules.minimumTreadMm });
    if (stair.widthMm < rules.minimumStairWidthMm) failures.push({ objectId: stair.id, code: 'STAIR_TOO_NARROW', measured: stair.widthMm, required: rules.minimumStairWidthMm });
    if (stair.headroomMm < rules.minimumHeadroomMm) failures.push({ objectId: stair.id, code: 'HEADROOM_TOO_LOW', measured: stair.headroomMm, required: rules.minimumHeadroomMm });
  }
  for (const corridor of model.corridors) {
    if (corridor.pathMm.length < 2 || !(pathLength(corridor.pathMm) > 0)) failures.push({ objectId: corridor.id, code: 'INVALID_CORRIDOR_PATH' });
    if (corridor.clearWidthMm < rules.minimumCorridorWidthMm) failures.push({ objectId: corridor.id, code: 'CORRIDOR_TOO_NARROW', measured: corridor.clearWidthMm, required: rules.minimumCorridorWidthMm });
    if (corridor.clearHeightMm < rules.minimumCorridorHeightMm) failures.push({ objectId: corridor.id, code: 'CORRIDOR_TOO_LOW', measured: corridor.clearHeightMm, required: rules.minimumCorridorHeightMm });
  }
  for (const balcony of model.balconies) {
    if (balcony.boundaryMm.length < 3 || balcony.drainageSlopePercent <= 0 || !Number.isFinite(balcony.drainageSlopePercent)) failures.push({ objectId: balcony.id, code: 'INVALID_BALCONY_GEOMETRY' });
    if (balcony.railingHeightMm < rules.minimumRailingHeightMm) failures.push({ objectId: balcony.id, code: 'RAILING_TOO_LOW', measured: balcony.railingHeightMm, required: rules.minimumRailingHeightMm });
  }
  for (const ramp of model.ramps) {
    const run = pathLength(ramp.pathMm), slope = run > 0 ? Math.abs(ramp.riseMm) / run * 100 : Number.POSITIVE_INFINITY;
    if (ramp.pathMm.length < 2 || !Number.isFinite(slope)) failures.push({ objectId: ramp.id, code: 'INVALID_RAMP_PATH' });
    if (slope > rules.maximumRampSlopePercent) failures.push({ objectId: ramp.id, code: 'RAMP_TOO_STEEP', measured: slope, required: rules.maximumRampSlopePercent });
    if (ramp.clearWidthMm < rules.minimumRampWidthMm) failures.push({ objectId: ramp.id, code: 'RAMP_TOO_NARROW', measured: ramp.clearWidthMm, required: rules.minimumRampWidthMm });
  }
  return { status: failures.length ? 'failed' : 'passed', failures, method: 'governed_semantic_dimensions' };
}

export interface CurvedFacadePanel { index: number; startAngleDeg: number; endAngleDeg: number; centerAngleDeg: number; chordWidthMm: number }
export function panelizeCurvedFacade(radiusMm: number, startAngleDeg: number, endAngleDeg: number, maximumPanelWidthMm: number): CurvedFacadePanel[] {
  if (!(radiusMm > 0) || !(maximumPanelWidthMm > 0) || ![radiusMm, startAngleDeg, endAngleDeg, maximumPanelWidthMm].every(Number.isFinite) || startAngleDeg === endAngleDeg) throw new Error('Curved facade inputs must be finite, positive, and have a non-zero sweep.');
  const sweep = endAngleDeg - startAngleDeg, arcLength = Math.abs(sweep) * Math.PI / 180 * radiusMm, count = Math.ceil(arcLength / maximumPanelWidthMm), step = sweep / count;
  return Array.from({ length: count }, (_, index) => { const start = startAngleDeg + step * index, end = start + step, chord = 2 * radiusMm * Math.sin(Math.abs(step) * Math.PI / 360); return { index, startAngleDeg: start, endAngleDeg: end, centerAngleDeg: (start + end) / 2, chordWidthMm: chord }; });
}
