export const MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA =
  'nexyfab.mechanical-load-support-contract.v1' as const;

export type MechanicalLoadSupportCoordinateFrame = 'global_cartesian';
export type MechanicalLoadSupportSourceKind = 'user_input' | 'imported' | 'derived';

export interface MechanicalLoadSupportProvenanceV1 {
  sourceId: string;
  sourceKind: MechanicalLoadSupportSourceKind;
  sourceRef: string;
  capturedAt: string;
  revisionSha256: string;
}

export interface MechanicalPointMmV1 {
  x: number;
  y: number;
  z: number;
}

export interface MechanicalForceLoadV1 {
  id: string;
  kind: 'force';
  locationMm: MechanicalPointMmV1;
  vectorN: MechanicalPointMmV1;
  coordinateFrame: MechanicalLoadSupportCoordinateFrame;
  provenance: MechanicalLoadSupportProvenanceV1;
}

export interface MechanicalMomentLoadV1 {
  id: string;
  kind: 'moment';
  locationMm: MechanicalPointMmV1;
  momentNmm: MechanicalPointMmV1;
  coordinateFrame: MechanicalLoadSupportCoordinateFrame;
  provenance: MechanicalLoadSupportProvenanceV1;
}

export type MechanicalLoadV1 = MechanicalForceLoadV1 | MechanicalMomentLoadV1;

export interface MechanicalSupportV1 {
  id: string;
  kind: 'fixed' | 'pinned' | 'roller';
  locationMm: MechanicalPointMmV1;
  constrainedTranslations: readonly [boolean, boolean, boolean];
  constrainedRotations: readonly [boolean, boolean, boolean];
  coordinateFrame: MechanicalLoadSupportCoordinateFrame;
  provenance: MechanicalLoadSupportProvenanceV1;
}

export interface MechanicalLoadSupportModelV1 {
  schema: typeof MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA;
  units: 'N-mm-s';
  coordinateFrame: MechanicalLoadSupportCoordinateFrame;
  coordinateSystemId: string;
  revisionSha256: string;
  loads: readonly MechanicalLoadV1[];
  supports: readonly MechanicalSupportV1[];
  solverStatus: 'NOT_RUN';
}

export interface MechanicalLoadSupportValidationResult {
  valid: boolean;
  issues: string[];
}

export interface MechanicalLoadSupportEligibility {
  schema: typeof MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA;
  status: 'HOLD';
  solverStatus: 'NOT_RUN';
  eligible: false;
  blockers: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_COORDINATE_MM = 1_000_000_000;
const finiteBounded = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM;

function validPoint(point: unknown): point is MechanicalPointMmV1 {
  return Boolean(point && typeof point === 'object'
    && finiteBounded((point as MechanicalPointMmV1).x)
    && finiteBounded((point as MechanicalPointMmV1).y)
    && finiteBounded((point as MechanicalPointMmV1).z));
}

function validProvenance(
  provenance: unknown,
  revisionSha256: string,
): provenance is MechanicalLoadSupportProvenanceV1 {
  if (!provenance || typeof provenance !== 'object') return false;
  const value = provenance as MechanicalLoadSupportProvenanceV1;
  return typeof value.sourceId === 'string' && value.sourceId.trim().length > 0
    && (value.sourceKind === 'user_input' || value.sourceKind === 'imported' || value.sourceKind === 'derived')
    && typeof value.sourceRef === 'string' && value.sourceRef.trim().length > 0
    && typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt))
    && value.revisionSha256 === revisionSha256 && SHA256.test(value.revisionSha256);
}

export function validateMechanicalLoadSupportModel(
  model: MechanicalLoadSupportModelV1 | null | undefined,
): MechanicalLoadSupportValidationResult {
  const issues: string[] = [];
  if (!model || typeof model !== 'object') return { valid: false, issues: ['model_missing'] };
  if (model.schema !== MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA) issues.push('schema_invalid');
  if (model.units !== 'N-mm-s') issues.push('canonical_units_required');
  if (model.coordinateFrame !== 'global_cartesian') issues.push('canonical_coordinate_frame_required');
  if (typeof model.coordinateSystemId !== 'string' || !model.coordinateSystemId.trim()) issues.push('coordinate_system_missing');
  if (!SHA256.test(model.revisionSha256)) issues.push('revision_sha256_invalid');
  if (model.solverStatus !== 'NOT_RUN') issues.push('solver_status_must_remain_not_run');
  if (Object.prototype.hasOwnProperty.call(model, 'externalReceipt') || Object.prototype.hasOwnProperty.call(model, 'solverReceipt')) {
    issues.push('external_receipt_forbidden');
  }
  const ids = new Set<string>();
  const loads = Array.isArray(model.loads) ? model.loads : [];
  const supports = Array.isArray(model.supports) ? model.supports : [];
  if (!Array.isArray(model.loads)) issues.push('loads_array_required');
  if (!Array.isArray(model.supports)) issues.push('supports_array_required');
  if (loads.length === 0) issues.push('load_required');
  if (supports.length === 0) issues.push('support_required');
  for (const load of loads) {
    if (!load || typeof load !== 'object') { issues.push('load_invalid'); continue; }
    const value = load as MechanicalLoadV1;
    if (typeof value.id !== 'string' || !value.id.trim() || ids.has(value.id)) issues.push(`load_id_invalid:${String(value.id)}`);
    else ids.add(value.id);
    if (!validPoint(value.locationMm) || value.coordinateFrame !== 'global_cartesian' || !validProvenance(value.provenance, model.revisionSha256)) {
      issues.push(`load_binding_invalid:${String(value.id)}`);
    }
    const vector = value.kind === 'force' ? value.vectorN : value.kind === 'moment' ? value.momentNmm : null;
    if (!vector || !validPoint(vector) || Math.hypot(vector.x, vector.y, vector.z) <= 0) issues.push(`load_vector_invalid:${String(value.id)}`);
  }
  for (const support of supports) {
    if (!support || typeof support !== 'object') { issues.push('support_invalid'); continue; }
    const value = support as MechanicalSupportV1;
    if (typeof value.id !== 'string' || !value.id.trim() || ids.has(value.id)) issues.push(`support_id_invalid:${String(value.id)}`);
    else ids.add(value.id);
    if (!validPoint(value.locationMm) || value.coordinateFrame !== 'global_cartesian' || !validProvenance(value.provenance, model.revisionSha256)) {
      issues.push(`support_binding_invalid:${String(value.id)}`);
    }
    const translations = value.constrainedTranslations;
    const rotations = value.constrainedRotations;
    const validDofTuples = Array.isArray(translations) && translations.length === 3
      && translations.every(axis => typeof axis === 'boolean')
      && Array.isArray(rotations) && rotations.length === 3
      && rotations.every(axis => typeof axis === 'boolean');
    const supportSemanticsValid = validDofTuples && (
      (value.kind === 'fixed' && translations.every(Boolean) && rotations.every(Boolean))
      || (value.kind === 'pinned' && translations.every(Boolean) && rotations.every(axis => !axis))
      || (value.kind === 'roller' && translations.filter(Boolean).length === 1 && rotations.every(axis => !axis))
    );
    if (!supportSemanticsValid) {
      issues.push(`support_constraints_invalid:${String(value.id)}`);
    }
    if (value.kind !== 'fixed' && value.kind !== 'pinned' && value.kind !== 'roller') issues.push(`support_kind_invalid:${String(value.id)}`);
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

/** Canonical input is validated here; no elastic solve or external receipt is implied. */
export function evaluateMechanicalLoadSupportEligibility(
  model: MechanicalLoadSupportModelV1 | null | undefined,
): MechanicalLoadSupportEligibility {
  const validation = validateMechanicalLoadSupportModel(model);
  return {
    schema: MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA,
    status: 'HOLD',
    solverStatus: 'NOT_RUN',
    eligible: false,
    blockers: validation.valid ? ['elastic_solver_not_run', 'external_receipt_not_available'] : validation.issues,
  };
}
