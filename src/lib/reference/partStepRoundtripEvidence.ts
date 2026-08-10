export interface PartGeometryMeasurement {
  engineIdentity: string;
  role: 'authoring-brep' | 'isolated-step-import';
  unit: 'mm';
  solidCount: number;
  volumeMm3: number;
  surfaceAreaMm2?: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  centroidMm?: [number, number, number];
  faceCount?: number;
  edgeCount?: number;
  validSolid: boolean;
  watertight: boolean;
}

export interface PartStepRoundtripEvidenceV1 {
  schema: 'nexyfab.part-step-roundtrip-evidence.v1';
  status: 'pass' | 'fail';
  source: PartGeometryMeasurement;
  roundtrip: PartGeometryMeasurement;
  tolerances: { volumeRelative: number; surfaceAreaRelative: number; bboxAbsoluteMm: number; centroidAbsoluteMm: number };
  comparisons: Array<{ metric: string; delta: number; tolerance: number; passed: boolean }>;
  blockers: string[];
}

const finite = (value: number) => Number.isFinite(value);
const relativeDelta = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

function measurementIssues(value: PartGeometryMeasurement, expectedRole: PartGeometryMeasurement['role']): string[] {
  const issues: string[] = [];
  if (value.role !== expectedRole) issues.push(`role-mismatch:${expectedRole}`);
  if (!value.engineIdentity.trim()) issues.push(`engine-identity-missing:${expectedRole}`);
  if (value.unit !== 'mm') issues.push(`unit-not-mm:${expectedRole}`);
  if (!Number.isInteger(value.solidCount) || value.solidCount < 1) issues.push(`solid-count-invalid:${expectedRole}`);
  if (!finite(value.volumeMm3) || value.volumeMm3 <= 0) issues.push(`volume-invalid:${expectedRole}`);
  if (!value.bbox.min.every(finite) || !value.bbox.max.every(finite)) issues.push(`bbox-invalid:${expectedRole}`);
  if (!value.validSolid) issues.push(`brep-invalid:${expectedRole}`);
  if (!value.watertight) issues.push(`not-watertight:${expectedRole}`);
  return issues;
}

export function comparePartStepRoundtrip(
  source: PartGeometryMeasurement,
  roundtrip: PartGeometryMeasurement,
  tolerances: PartStepRoundtripEvidenceV1['tolerances'] = {
    volumeRelative: 0.001,
    surfaceAreaRelative: 0.001,
    bboxAbsoluteMm: 0.01,
    centroidAbsoluteMm: 0.01,
  },
): PartStepRoundtripEvidenceV1 {
  const blockers = [
    ...measurementIssues(source, 'authoring-brep'),
    ...measurementIssues(roundtrip, 'isolated-step-import'),
  ];
  if (source.engineIdentity === roundtrip.engineIdentity) blockers.push('verifier-not-isolated');
  const comparisons: PartStepRoundtripEvidenceV1['comparisons'] = [];
  const add = (metric: string, delta: number, tolerance: number) => {
    const passed = finite(delta) && delta <= tolerance;
    comparisons.push({ metric, delta, tolerance, passed });
    if (!passed) blockers.push(`${metric}-outside-tolerance`);
  };
  add('solidCount', Math.abs(source.solidCount - roundtrip.solidCount), 0);
  add('volumeRelative', relativeDelta(source.volumeMm3, roundtrip.volumeMm3), tolerances.volumeRelative);
  if (source.surfaceAreaMm2 !== undefined && roundtrip.surfaceAreaMm2 !== undefined) {
    add('surfaceAreaRelative', relativeDelta(source.surfaceAreaMm2, roundtrip.surfaceAreaMm2), tolerances.surfaceAreaRelative);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    add(`bbox.min.${axis}`, Math.abs(source.bbox.min[axis]! - roundtrip.bbox.min[axis]!), tolerances.bboxAbsoluteMm);
    add(`bbox.max.${axis}`, Math.abs(source.bbox.max[axis]! - roundtrip.bbox.max[axis]!), tolerances.bboxAbsoluteMm);
  }
  if (source.centroidMm && roundtrip.centroidMm) {
    for (let axis = 0; axis < 3; axis += 1) add(`centroid.${axis}`, Math.abs(source.centroidMm[axis]! - roundtrip.centroidMm[axis]!), tolerances.centroidAbsoluteMm);
  }
  if (source.faceCount !== undefined && roundtrip.faceCount !== undefined) add('faceCount', Math.abs(source.faceCount - roundtrip.faceCount), 0);
  if (source.edgeCount !== undefined && roundtrip.edgeCount !== undefined) add('edgeCount', Math.abs(source.edgeCount - roundtrip.edgeCount), 0);
  return {
    schema: 'nexyfab.part-step-roundtrip-evidence.v1',
    status: blockers.length === 0 ? 'pass' : 'fail',
    source,
    roundtrip,
    tolerances,
    comparisons,
    blockers: [...new Set(blockers)],
  };
}
