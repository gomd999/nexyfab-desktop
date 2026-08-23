import { createHash } from 'node:crypto';

export const SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA =
  'nexyfab.sheet-metal-flat-pattern-release.v1' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const EPSILON = 1e-8;

export interface SheetMetalFlatPatternSourceBindingV1 {
  brepPath: string;
  brepBytes: number;
  brepSha256: string;
  contentHash: string;
  revision: number;
}

export interface SheetMetalFlatPatternParametersV1 {
  units: 'mm';
  thicknessMm: number;
  materialId: string;
  kFactor: number;
  bendRadiusMm: number;
  neutralAxisConvention: 'inner_radius_plus_k_factor_times_thickness';
}

export interface SheetMetalFlatPatternBendV1 {
  id: string;
  angleDeg: number;
  innerRadiusMm: number;
  positionMm: number;
  neutralAxisRadiusMm: number;
  bendAllowanceMm: number;
  bendDeductionMm: number;
}

export interface SheetMetalFlatPatternPointV1 {
  xMm: number;
  yMm: number;
}

export interface SheetMetalFlatPatternOutlineSegmentV1 {
  id: string;
  start: SheetMetalFlatPatternPointV1;
  end: SheetMetalFlatPatternPointV1;
}

export interface SheetMetalFlatPatternHoleV1 {
  id: string;
  center: SheetMetalFlatPatternPointV1;
  radiusMm: number;
}

export interface SheetMetalFlatPatternBendLineV1 {
  id: string;
  bendId: string;
  start: SheetMetalFlatPatternPointV1;
  end: SheetMetalFlatPatternPointV1;
}

export interface SheetMetalFlatPatternOutputV1 {
  format: 'dxf' | 'svg' | 'json';
  revision: number;
  content: string;
  bytes: number;
  sha256: string;
}

export interface SheetMetalFlatPatternReleaseInputV1 {
  schema: typeof SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA;
  revision: number;
  source: SheetMetalFlatPatternSourceBindingV1;
  parameters: SheetMetalFlatPatternParametersV1;
  bends: readonly SheetMetalFlatPatternBendV1[];
  outline: readonly SheetMetalFlatPatternOutlineSegmentV1[];
  holes: readonly SheetMetalFlatPatternHoleV1[];
  bendLines: readonly SheetMetalFlatPatternBendLineV1[];
  output: SheetMetalFlatPatternOutputV1;
}

export interface SheetMetalFlatPatternParserReadbackV1 {
  parserId: 'nexyfab.sheet-metal-flat-pattern-independent-parser.v1';
  parserSourceSha256: string;
  sourceBrepSha256: string;
  sourceContentHash: string;
  sourceRevision: number;
  outputSha256: string;
  outlineIds: readonly string[];
  holeIds: readonly string[];
  bendLineIds: readonly string[];
  bendIds: readonly string[];
  verificationSha256: string;
}

export interface SheetMetalFlatPatternValidationResult {
  valid: boolean;
  issues: string[];
}

export interface SheetMetalFlatPatternReleaseAssessment {
  schema: typeof SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA;
  releaseReady: false;
  status: 'HOLD';
  parserVerified: boolean;
  blockers: string[];
  holdBoundary: readonly string[];
}

const holdBoundary = [
  'press_brake_and_tooling_not_run',
  'material_lot_not_verified',
  'manufacturing_receipt_not_available',
] as const;

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bounded = (value: unknown): value is number => finite(value) && Math.abs(value) <= 1_000_000_000;
const point = (value: unknown): value is SheetMetalFlatPatternPointV1 => Boolean(value && typeof value === 'object'
  && bounded((value as SheetMetalFlatPatternPointV1).xMm)
  && bounded((value as SheetMetalFlatPatternPointV1).yMm));
const distance = (a: SheetMetalFlatPatternPointV1, b: SheetMetalFlatPatternPointV1): number => Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
const pointToSegmentDistance = (value: SheetMetalFlatPatternPointV1, start: SheetMetalFlatPatternPointV1, end: SheetMetalFlatPatternPointV1): number => {
  const dx = end.xMm - start.xMm; const dy = end.yMm - start.yMm;
  const denominator = dx * dx + dy * dy;
  if (denominator <= EPSILON * EPSILON) return distance(value, start);
  const ratio = Math.max(0, Math.min(1, ((value.xMm - start.xMm) * dx + (value.yMm - start.yMm) * dy) / denominator));
  return Math.hypot(value.xMm - (start.xMm + ratio * dx), value.yMm - (start.yMm + ratio * dy));
};
const equal = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(EPSILON, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);

function orientation(a: SheetMetalFlatPatternPointV1, b: SheetMetalFlatPatternPointV1, c: SheetMetalFlatPatternPointV1): number {
  return (b.xMm - a.xMm) * (c.yMm - a.yMm) - (b.yMm - a.yMm) * (c.xMm - a.xMm);
}

function onSegment(a: SheetMetalFlatPatternPointV1, b: SheetMetalFlatPatternPointV1, c: SheetMetalFlatPatternPointV1): boolean {
  return Math.min(a.xMm, c.xMm) - EPSILON <= b.xMm && b.xMm <= Math.max(a.xMm, c.xMm) + EPSILON
    && Math.min(a.yMm, c.yMm) - EPSILON <= b.yMm && b.yMm <= Math.max(a.yMm, c.yMm) + EPSILON;
}

function intersects(
  a: SheetMetalFlatPatternPointV1,
  b: SheetMetalFlatPatternPointV1,
  c: SheetMetalFlatPatternPointV1,
  d: SheetMetalFlatPatternPointV1,
): boolean {
  const ab = orientation(a, b, c), ab2 = orientation(a, b, d), cd = orientation(c, d, a), cd2 = orientation(c, d, b);
  if ((ab > EPSILON && ab2 < -EPSILON || ab < -EPSILON && ab2 > EPSILON)
    && (cd > EPSILON && cd2 < -EPSILON || cd < -EPSILON && cd2 > EPSILON)) return true;
  return Math.abs(ab) <= EPSILON && onSegment(a, c, b)
    || Math.abs(ab2) <= EPSILON && onSegment(a, d, b)
    || Math.abs(cd) <= EPSILON && onSegment(c, a, d)
    || Math.abs(cd2) <= EPSILON && onSegment(c, b, d);
}

function pointInPolygon(value: SheetMetalFlatPatternPointV1, vertices: readonly SheetMetalFlatPatternPointV1[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i]!, b = vertices[j]!;
    if ((a.yMm > value.yMm) !== (b.yMm > value.yMm)
      && value.xMm < ((b.xMm - a.xMm) * (value.yMm - a.yMm)) / (b.yMm - a.yMm) + a.xMm) inside = !inside;
  }
  return inside;
}

function ids(values: readonly { id: string }[], label: string, issues: string[], all: Set<string>): void {
  for (const value of values) {
    if (!value || typeof value.id !== 'string' || !value.id.trim() || all.has(value.id)) issues.push(`${label}_id_invalid:${String(value?.id)}`);
    else all.add(value.id);
  }
}

export function validateSheetMetalFlatPatternRelease(
  input: SheetMetalFlatPatternReleaseInputV1 | null | undefined,
): SheetMetalFlatPatternValidationResult {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, issues: ['input_missing'] };
  if (input.schema !== SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA) issues.push('schema_invalid');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) issues.push('revision_invalid');
  const source = input.source;
  if (!source || typeof source !== 'object') issues.push('source_binding_missing');
  else {
    if (typeof source.brepPath !== 'string' || !source.brepPath.trim() || source.brepPath.replaceAll('\\', '/').split('/').includes('..') || source.brepPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source.brepPath)) issues.push('source_brep_path_invalid');
    if (!Number.isSafeInteger(source.brepBytes) || source.brepBytes <= 0) issues.push('source_brep_bytes_invalid');
    if (!SHA256.test(source.brepSha256) || !SHA256.test(source.contentHash)) issues.push('source_hash_invalid');
    if (source.revision !== input.revision) issues.push('stale_source_revision');
  }
  const parameters = input.parameters;
  if (!parameters || parameters.units !== 'mm') issues.push('canonical_units_required');
  if (!parameters || !finite(parameters.thicknessMm) || parameters.thicknessMm <= 0) issues.push('thickness_invalid');
  if (!parameters || typeof parameters.materialId !== 'string' || !parameters.materialId.trim()) issues.push('material_invalid');
  if (!parameters || !finite(parameters.kFactor) || parameters.kFactor < 0 || parameters.kFactor > 1) issues.push('k_factor_invalid');
  if (!parameters || !finite(parameters.bendRadiusMm) || parameters.bendRadiusMm <= 0) issues.push('bend_radius_invalid');
  if (!parameters || parameters.neutralAxisConvention !== 'inner_radius_plus_k_factor_times_thickness') issues.push('neutral_axis_convention_invalid');
  const allIds = new Set<string>();
  const bends = Array.isArray(input.bends) ? input.bends : [];
  const outline = Array.isArray(input.outline) ? input.outline : [];
  const holes = Array.isArray(input.holes) ? input.holes : [];
  const bendLines = Array.isArray(input.bendLines) ? input.bendLines : [];
  if (!Array.isArray(input.bends)) issues.push('bends_array_required');
  if (!Array.isArray(input.outline) || outline.length < 3) issues.push('outline_required');
  if (!Array.isArray(input.holes)) issues.push('holes_array_required');
  if (!Array.isArray(input.bendLines)) issues.push('bend_lines_array_required');
  ids(bends, 'bend', issues, allIds);
  ids(outline, 'outline', issues, allIds);
  ids(holes, 'hole', issues, allIds);
  ids(bendLines, 'bend_line', issues, allIds);
  const thickness = parameters?.thicknessMm ?? Number.NaN;
  for (const bend of bends) {
    if (!bend || typeof bend !== 'object') { issues.push('bend_invalid'); continue; }
    if (!finite(bend.angleDeg) || bend.angleDeg <= 0 || bend.angleDeg >= 180) issues.push(`bend_angle_invalid:${bend.id}`);
    if (!finite(bend.innerRadiusMm) || bend.innerRadiusMm <= 0 || (finite(thickness) && bend.innerRadiusMm < thickness * 0.1)) issues.push(`bend_radius_invalid:${bend.id}`);
    if (finite(parameters?.bendRadiusMm) && !equal(bend.innerRadiusMm, parameters.bendRadiusMm)) issues.push(`bend_radius_parameter_mismatch:${bend.id}`);
    if (!finite(bend.positionMm)) issues.push(`bend_position_invalid:${bend.id}`);
    const expectedNeutral = bend.innerRadiusMm + (parameters?.kFactor ?? Number.NaN) * thickness;
    const theta = (bend.angleDeg * Math.PI) / 180;
    const expectedAllowance = theta * expectedNeutral;
    const expectedDeduction = 2 * (bend.innerRadiusMm + thickness) * Math.tan(theta / 2) - expectedAllowance;
    if (!equal(bend.neutralAxisRadiusMm, expectedNeutral)) issues.push(`neutral_axis_mismatch:${bend.id}`);
    if (!equal(bend.bendAllowanceMm, expectedAllowance)) issues.push(`bend_allowance_mismatch:${bend.id}`);
    if (!equal(bend.bendDeductionMm, expectedDeduction)) issues.push(`bend_deduction_mismatch:${bend.id}`);
  }
  if (outline.length >= 3) {
    if (outline.some(item => !item || typeof item !== 'object')) {
      issues.push('outline_segment_invalid');
    }
    const vertices = outline.filter(item => Boolean(item && typeof item === 'object')).map(item => item.start);
    for (const segment of outline) {
      if (!segment || typeof segment !== 'object' || !point(segment.start) || !point(segment.end) || distance(segment.start, segment.end) <= EPSILON) {
        issues.push(`outline_segment_invalid:${String(segment?.id)}`);
      }
    }
    for (let i = 0; i < outline.length; i += 1) {
      const current = outline[i];
      const next = outline[(i + 1) % outline.length]!;
      if (!current || typeof current !== 'object' || !next || typeof next !== 'object' || !point(current.end) || !point(next.start)) continue;
      if (distance(current.end, next.start) > EPSILON) issues.push(`outline_not_closed:${current.id}`);
      for (let j = i + 1; j < outline.length; j += 1) {
        if (j === i + 1 || (i === 0 && j === outline.length - 1)) continue;
        const other = outline[j];
        if (!other || typeof other !== 'object' || !point(current.start) || !point(other.start) || !point(other.end)) continue;
        if (intersects(current.start, current.end, other.start, other.end)) issues.push('outline_self_intersection');
      }
    }
    for (const hole of holes) {
      if (!hole || typeof hole !== 'object') { issues.push('hole_invalid'); continue; }
      if (!point(hole.center) || !finite(hole.radiusMm) || hole.radiusMm <= 0 || !pointInPolygon(hole.center, vertices)
        || outline.some(segment => point(segment?.start) && point(segment?.end) && pointToSegmentDistance(hole.center, segment.start, segment.end) <= hole.radiusMm + EPSILON)) issues.push(`hole_invalid:${hole.id}`);
    }
    for (let left = 0; left < holes.length; left += 1) {
      for (let right = left + 1; right < holes.length; right += 1) {
        const a = holes[left]; const b = holes[right];
        if (a && b && point(a.center) && point(b.center) && finite(a.radiusMm) && finite(b.radiusMm) && distance(a.center, b.center) <= a.radiusMm + b.radiusMm + EPSILON) issues.push(`hole_overlap:${a.id}:${b.id}`);
      }
    }
  }
  const bendIds = new Set(bends.map(item => item?.id).filter((id): id is string => typeof id === 'string'));
  const representedBends = new Set<string>();
  for (const line of bendLines) {
    if (!line || typeof line !== 'object') { issues.push('bend_line_invalid'); continue; }
    if (!bendIds.has(line.bendId)) issues.push(`bend_line_missing_bend:${line.id}`);
    else if (representedBends.has(line.bendId)) issues.push(`bend_line_duplicate_bend:${line.bendId}`);
    else representedBends.add(line.bendId);
    if (!point(line.start) || !point(line.end) || distance(line.start, line.end) <= EPSILON) issues.push(`bend_line_invalid:${line.id}`);
  }
  for (const bend of bends) if (bend && typeof bend === 'object' && !representedBends.has(bend.id)) issues.push(`bend_missing_from_output:${bend.id}`);
  const output = input.output;
  if (!output || !['dxf', 'svg', 'json'].includes(output.format)) issues.push('output_format_invalid');
  if (!output || output.revision !== input.revision) issues.push('stale_output_revision');
  if (!output || typeof output.content !== 'string' || !Number.isSafeInteger(output.bytes) || output.bytes <= 0 || !SHA256.test(output.sha256)) issues.push('output_binding_invalid');
  else {
    const bytes = Buffer.byteLength(output.content, 'utf8');
    if (bytes !== output.bytes) issues.push('output_bytes_mismatch');
    if (sha256(output.content) !== output.sha256) issues.push('output_hash_mismatch');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function verifySheetMetalFlatPatternReadback(
  input: SheetMetalFlatPatternReleaseInputV1,
  readback: SheetMetalFlatPatternParserReadbackV1 | null | undefined,
): MechanicalLoadReadbackResult {
  const issues = validateSheetMetalFlatPatternRelease(input).issues;
  if (!readback) issues.push('parser_readback_missing');
  else {
    if (readback.parserId !== 'nexyfab.sheet-metal-flat-pattern-independent-parser.v1' || !SHA256.test(readback.parserSourceSha256)) issues.push('parser_identity_invalid');
    if (readback.sourceBrepSha256 !== input.source.brepSha256 || readback.sourceContentHash !== input.source.contentHash) issues.push('readback_source_hash_mismatch');
    if (readback.sourceRevision !== input.revision) issues.push('readback_source_revision_mismatch');
    if (readback.outputSha256 !== input.output.sha256) issues.push('readback_output_hash_mismatch');
    const parsedIds = (value: unknown): string[] => Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value].sort() : [];
    if (JSON.stringify(parsedIds(readback.outlineIds)) !== JSON.stringify(input.outline.map(item => item?.id).filter((id): id is string => typeof id === 'string').sort())) issues.push('readback_outline_identity_mismatch');
    if (JSON.stringify(parsedIds(readback.holeIds)) !== JSON.stringify(input.holes.map(item => item?.id).filter((id): id is string => typeof id === 'string').sort())) issues.push('readback_hole_identity_mismatch');
    if (JSON.stringify(parsedIds(readback.bendLineIds)) !== JSON.stringify(input.bendLines.map(item => item?.id).filter((id): id is string => typeof id === 'string').sort())) issues.push('readback_bend_line_identity_mismatch');
    if (JSON.stringify(parsedIds(readback.bendIds)) !== JSON.stringify(input.bends.map(item => item?.id).filter((id): id is string => typeof id === 'string').sort())) issues.push('readback_bend_identity_mismatch');
    if (!SHA256.test(readback.verificationSha256) || readback.verificationSha256 !== sheetMetalFlatPatternReadbackVerificationSha256(readback)) issues.push('readback_verification_hash_mismatch');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function sheetMetalFlatPatternReadbackVerificationSha256(
  readback: Omit<SheetMetalFlatPatternParserReadbackV1, 'verificationSha256'> | SheetMetalFlatPatternParserReadbackV1,
): string {
  return sha256(JSON.stringify({
    parserId: readback.parserId,
    parserSourceSha256: readback.parserSourceSha256,
    sourceBrepSha256: readback.sourceBrepSha256,
    sourceContentHash: readback.sourceContentHash,
    sourceRevision: readback.sourceRevision,
    outputSha256: readback.outputSha256,
    outlineIds: [...readback.outlineIds].sort(),
    holeIds: [...readback.holeIds].sort(),
    bendLineIds: [...readback.bendLineIds].sort(),
    bendIds: [...readback.bendIds].sort(),
  }));
}

export interface MechanicalLoadReadbackResult {
  valid: boolean;
  issues: string[];
}

export function assessSheetMetalFlatPatternRelease(
  input: SheetMetalFlatPatternReleaseInputV1 | null | undefined,
  readback?: SheetMetalFlatPatternParserReadbackV1 | null,
): SheetMetalFlatPatternReleaseAssessment {
  const validation = input ? validateSheetMetalFlatPatternRelease(input) : { valid: false, issues: ['input_missing'] };
  const parser = input ? verifySheetMetalFlatPatternReadback(input, readback) : { valid: false, issues: ['input_missing'] };
  const blockers = [...new Set([...validation.issues, ...parser.issues, ...holdBoundary])];
  return {
    schema: SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA,
    releaseReady: false,
    status: 'HOLD',
    parserVerified: parser.valid,
    blockers,
    holdBoundary,
  };
}
