import type { ExportedIfcServiceOpening } from '@/lib/brep-bridge/ifcServiceOpeningExport';
import { snapshotIfcOpeningRelationships, verifyIfcOpeningRelationshipRoundtrip } from './ifcOpeningRelationshipEvidence';

type V3 = [number, number, number];
export interface ReimportedIfcServiceOpeningMeasurement { openingGuid: string; centerMm: V3; axis: V3; cutDiameterMm: number; depthMm: number }
export interface IfcServiceOpeningGateTolerance { linearMm: number; angularDeg: number }
export interface IfcServiceOpeningGateResult {
  status: 'pass' | 'fail' | 'not_run';
  releaseReady: boolean;
  checks: { geometry: boolean; axis: boolean; hostRelations: boolean; relationshipRoundtrip: boolean };
  errors: string[];
}

const distance = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const normalizedDot = (a: V3, b: V3) => { const divisor = Math.hypot(...a) * Math.hypot(...b); return divisor > 0 ? (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / divisor : Number.NaN; };

export function verifyIfcServiceOpeningRelease(input: { expected: readonly ExportedIfcServiceOpening[]; exportedIfc: string; reimportedIfc?: string; measurements?: readonly ReimportedIfcServiceOpeningMeasurement[]; tolerance?: Partial<IfcServiceOpeningGateTolerance> }): IfcServiceOpeningGateResult {
  if (!input.reimportedIfc || !input.measurements) return { status: 'not_run', releaseReady: false, checks: { geometry: false, axis: false, hostRelations: false, relationshipRoundtrip: false }, errors: ['ifc_reimport_evidence_missing'] };
  const tolerance = { linearMm: input.tolerance?.linearMm ?? 0.1, angularDeg: input.tolerance?.angularDeg ?? 0.1 };
  if (!(tolerance.linearMm >= 0) || !(tolerance.angularDeg >= 0 && tolerance.angularDeg < 90)) throw new Error('invalid_ifc_opening_tolerance');
  const errors: string[] = [];
  const measured = new Map(input.measurements.map(item => [item.openingGuid, item]));
  if (measured.size !== input.measurements.length) errors.push('duplicate_reimported_opening_guid');
  if (input.measurements.length !== input.expected.length) errors.push(`opening_count:${input.measurements.length}/${input.expected.length}`);
  let geometry = true, axis = true;
  const axisLimit = Math.cos(tolerance.angularDeg * Math.PI / 180);
  for (const expected of input.expected) {
    const actual = measured.get(expected.openingGuid);
    if (!actual) { geometry = false; axis = false; errors.push(`opening_missing:${expected.openingGuid}`); continue; }
    const finite = [...actual.centerMm, ...actual.axis, actual.cutDiameterMm, actual.depthMm].every(Number.isFinite);
    if (!finite || distance(expected.centerMm, actual.centerMm) > tolerance.linearMm || Math.abs(expected.cutDiameterMm - actual.cutDiameterMm) > tolerance.linearMm || Math.abs(expected.depthMm - actual.depthMm) > tolerance.linearMm) { geometry = false; errors.push(`opening_geometry_mismatch:${expected.openingGuid}`); }
    if (!finite || normalizedDot(expected.axis, actual.axis) < axisLimit) { axis = false; errors.push(`opening_axis_mismatch:${expected.openingGuid}`); }
  }
  const relationships = snapshotIfcOpeningRelationships(input.reimportedIfc);
  let hostRelations = relationships.errors.length === 0;
  for (const expected of input.expected) {
    if (!relationships.voids.some(item => item.relationGuid === expected.voidRelationGuid && item.openingGuid === expected.openingGuid && item.hostGuid === expected.hostGuid)) { hostRelations = false; errors.push(`opening_host_relation_mismatch:${expected.openingGuid}`); }
    if (expected.fillRelationGuid && !relationships.fills.some(item => item.relationGuid === expected.fillRelationGuid && item.openingGuid === expected.openingGuid)) { hostRelations = false; errors.push(`opening_fill_relation_mismatch:${expected.openingGuid}`); }
  }
  if (relationships.errors.length) errors.push(...relationships.errors.map(error => `reimport:${error}`));
  const relationshipRoundtrip = verifyIfcOpeningRelationshipRoundtrip(input.exportedIfc, input.reimportedIfc);
  if (!relationshipRoundtrip.passed) errors.push(...relationshipRoundtrip.errors.map(error => `roundtrip:${error}`));
  const checks = { geometry, axis, hostRelations, relationshipRoundtrip: relationshipRoundtrip.passed };
  const releaseReady = Object.values(checks).every(Boolean) && errors.length === 0;
  return { status: releaseReady ? 'pass' : 'fail', releaseReady, checks, errors };
}
