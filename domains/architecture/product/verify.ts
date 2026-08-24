import { createHash } from 'node:crypto';
import {
  validateBuildingProductContract,
  type BuildingDoor,
  type BuildingEgressRoute,
  type BuildingLevel,
  type BuildingPoint,
  type BuildingProductContract,
  type BuildingRevision,
  type BuildingWall,
  type BuildingWindow,
} from './contract';
import { verifyEgressRoutes, type EgressRouteInput } from '../../../src/lib/assembly/egressRouteVerification';
import { verifySpaceBoundaryClosure, type BoundarySegment2 } from '../../../src/lib/assembly/spaceBoundaryClosure';

export const BUILDING_PRODUCT_CHECK_RECEIPT_SCHEMA = 'nexyfab.building.check-receipt.v1' as const;
export type BuildingCheckStatus = 'PASS' | 'FAIL' | 'HOLD' | 'NOT_RUN' | 'STALE';
export type BuildingCheckId =
  | 'surveyed-host' | 'level-grid' | 'space-closure' | 'opening-integrity'
  | 'stairs-egress-accessibility' | 'envelope-continuity' | 'upstream-coordination'
  | 'drawing-schedule-quantity-consistency' | 'ifc-roundtrip' | 'code-authority' | 'independent-review';
export const BUILDING_CHECK_IDS: readonly BuildingCheckId[] = [
  'surveyed-host', 'level-grid', 'space-closure', 'opening-integrity',
  'stairs-egress-accessibility', 'envelope-continuity', 'upstream-coordination',
  'drawing-schedule-quantity-consistency', 'ifc-roundtrip', 'code-authority', 'independent-review',
];

export interface BuildingCheckReceipt {
  schema: typeof BUILDING_PRODUCT_CHECK_RECEIPT_SCHEMA;
  checkId: BuildingCheckId;
  status: BuildingCheckStatus;
  sourceRevision: BuildingRevision;
  modelSha256: string;
  coordinateAuthoritySha256: string;
  resultSha256: string;
  validatorId: string;
  validatorVersion: string;
  reviewerId: string;
  reason: string;
  issuedAt: string;
}
export interface BuildingExternalEvidence {
  status: BuildingCheckStatus;
  sourceRevision: BuildingRevision;
  modelSha256: string;
  coordinateAuthoritySha256: string;
  resultSha256: string;
  validatorId: string;
  validatorVersion: string;
  reviewerId: string;
  reason: string;
}
export interface BuildingVerificationOptions {
  externalEvidence?: Partial<Record<BuildingCheckId, BuildingExternalEvidence>>;
  now?: string;
}
export interface BuildingAxisEvidence {
  axis: 'coordinates' | 'spatial-semantics' | 'hosted-elements' | 'code-safety' | 'quantity-consistency' | 'drawing-consistency' | 'ifc-roundtrip';
  status: BuildingCheckStatus;
  sourceRevision: string;
  caseCount: 1;
  accuracyBasisPoints: number;
  coverageBasisPoints: number;
  falseVerificationCount: 0;
  artifactSha256: string;
}
export interface BuildingVerificationResult {
  status: 'PASS' | 'HOLD' | 'FAIL';
  currentRevisionVerified: boolean;
  productReceiptPromotionReady: false;
  sourceRevision: BuildingRevision | null;
  modelSha256: string | null;
  coordinateAuthoritySha256: string | null;
  receipts: BuildingCheckReceipt[];
  axisEvidence: BuildingAxisEvidence[];
  blockers: string[];
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RECEIPT_KEYS = ['schema', 'checkId', 'status', 'sourceRevision', 'modelSha256', 'coordinateAuthoritySha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'reason', 'issuedAt'] as const;
const EVIDENCE_KEYS = ['status', 'sourceRevision', 'modelSha256', 'coordinateAuthoritySha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'reason'] as const;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : record(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const sha256 = (v: unknown) => createHash('sha256').update(canonical(v), 'utf8').digest('hex');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sameRevision = (a: unknown, b: BuildingRevision) => record(a) && a.id === b.id && a.sha256 === b.sha256;
const unique = (items: string[]) => [...new Set(items)];

export function hashBuildingCoordinateAuthority(contract: BuildingProductContract): string {
  const site = contract.siteAuthority;
  return sha256({ sourceRevision: site.sourceRevision, contentSha256: site.contentSha256, coordinateReferenceSystem: site.coordinateReferenceSystem, horizontalDatum: site.horizontalDatum, verticalDatum: site.verticalDatum, epoch: site.epoch, projectNorthDeg: site.projectNorthDeg, siteBoundary: site.siteBoundary });
}

function validEvidence(value: unknown): value is BuildingExternalEvidence {
  if (!record(value) || !exact(value, EVIDENCE_KEYS)) return false;
  return ['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(String(value.status))
    && record(value.sourceRevision) && ID.test(String(value.sourceRevision.id)) && SHA.test(String(value.sourceRevision.sha256))
    && SHA.test(String(value.modelSha256)) && SHA.test(String(value.coordinateAuthoritySha256)) && SHA.test(String(value.resultSha256))
    && ID.test(String(value.validatorId)) && ID.test(String(value.validatorVersion)) && ID.test(String(value.reviewerId))
    && typeof value.reason === 'string' && value.reason.length <= 256;
}

export function validateBuildingCheckReceipt(value: unknown): string[] {
  if (!record(value) || !exact(value, RECEIPT_KEYS)) return ['receipt:keys_invalid'];
  const r = value as unknown as BuildingCheckReceipt;
  const issues: string[] = [];
  if (r.schema !== BUILDING_PRODUCT_CHECK_RECEIPT_SCHEMA) issues.push('receipt:schema_invalid');
  if (!BUILDING_CHECK_IDS.includes(r.checkId)) issues.push('receipt:check_id_invalid');
  if (!record(r.sourceRevision) || !ID.test(r.sourceRevision.id) || !SHA.test(r.sourceRevision.sha256)) issues.push('receipt:revision_invalid');
  if (!SHA.test(r.modelSha256)) issues.push('receipt:model_hash_invalid');
  if (!SHA.test(r.coordinateAuthoritySha256)) issues.push('receipt:coordinate_hash_invalid');
  if (!SHA.test(r.resultSha256)) issues.push('receipt:result_hash_invalid');
  if (!ID.test(r.validatorId) || !ID.test(r.validatorVersion) || !ID.test(r.reviewerId)) issues.push('receipt:validator_invalid');
  if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(r.status)) issues.push('receipt:status_invalid');
  if (typeof r.reason !== 'string' || r.reason.length > 256) issues.push('receipt:reason_invalid');
  if (typeof r.issuedAt !== 'string' || !ISO.test(r.issuedAt) || Number.isNaN(Date.parse(r.issuedAt))) issues.push('receipt:issued_at_invalid');
  if (r.status === 'PASS' && r.reviewerId === 'none') issues.push('receipt:pass_review_required');
  return unique(issues);
}

const point = (v: unknown): v is BuildingPoint => record(v) && finite(v.x) && finite(v.y);
const distance = (a: BuildingPoint, b: BuildingPoint) => Math.hypot(a.x - b.x, a.y - b.y);
function polygonArea(points: BuildingPoint[]): number {
  let area = 0; for (let i = 0; i < points.length - 1; i++) area += points[i]!.x * points[i + 1]!.y - points[i + 1]!.x * points[i]!.y; return Math.abs(area) / 2;
}
function closure(contract: BuildingProductContract): { status: BuildingCheckStatus; reason: string; resultSha256: string } {
  const results = contract.spaces.map(space => {
    const p = space.boundary;
    const segments: BoundarySegment2[] = p.slice(0, -1).map((start, i) => ({ id: `${space.id}:edge:${i}`, start, end: p[i + 1]! }));
    const result = verifySpaceBoundaryClosure({ segments, snapToleranceMm: 0.1, minimumAreaMm2: 1 });
    const declared = space.areaM2, computed = polygonArea(p) / 1e6;
    const areaOk = Math.abs(declared - computed) <= Math.max(0.01, computed * 0.005);
    return { id: space.id, closed: result.closed, areaOk, computed, declared, reason: !result.closed ? `space_boundary_${result.issues[0]?.code ?? 'invalid'}` : !areaOk ? 'space_declared_area_mismatch' : '' };
  });
  const passed = results.length > 0 && results.every(r => r.closed && r.areaOk);
  return { status: passed ? 'PASS' : 'FAIL', reason: results.find(r => r.reason)?.reason ?? '', resultSha256: sha256(results) };
}
function levelGrid(contract: BuildingProductContract): { status: BuildingCheckStatus; reason: string; resultSha256: string } {
  const levels = [...contract.levels].sort((a, b) => a.elevationMm - b.elevationMm);
  const badLevel = levels.find((level, i) => !finite(level.elevationMm) || !finite(level.heightMm) || level.heightMm <= 0 || (i > 0 && level.elevationMm <= levels[i - 1]!.elevationMm));
  const badGrid = contract.grids.find(grid => distance(grid.start, grid.end) <= 0 || !['X', 'Y'].includes(grid.axis));
  return { status: !badLevel && !badGrid ? 'PASS' : 'FAIL', reason: badLevel ? `level_invalid:${badLevel.id}` : badGrid ? `grid_invalid:${badGrid.id}` : '', resultSha256: sha256({ levels, grids: contract.grids }) };
}
function openingIntegrity(contract: BuildingProductContract): { status: BuildingCheckStatus; reason: string; resultSha256: string } {
  const walls = new Map(contract.walls.map(w => [w.id, w]));
  const openings = [...contract.doors, ...contract.windows];
  const intervals: Array<{ id: string; wall: string; a: number; b: number; low: number; high: number }> = [];
  for (const opening of openings) {
    const wall = walls.get(opening.hostWallId); const start = wall?.start; const end = wall?.end;
    if (!wall || !start || !end || opening.levelId !== wall.levelId) return { status: 'FAIL', reason: `opening_host_invalid:${opening.id}`, resultSha256: sha256(openings) };
    const length = distance(start, end); if (!(length > 0)) return { status: 'FAIL', reason: `opening_wall_zero:${opening.id}`, resultSha256: sha256(openings) };
    const ux = (end.x - start.x) / length, uy = (end.y - start.y) / length;
    const along = (opening.center.x - start.x) * ux + (opening.center.y - start.y) * uy;
    const normal = Math.abs((opening.center.x - start.x) * uy - (opening.center.y - start.y) * ux);
    const width = opening.widthMm, top = opening.sillMm + opening.heightMm;
    if (normal > Math.max(1, wall.thicknessMm / 2) || along - width / 2 < -0.1 || along + width / 2 > length + 0.1 || opening.sillMm < 0 || top > wall.heightMm) return { status: 'FAIL', reason: `opening_range_or_vertical_fit:${opening.id}`, resultSha256: sha256(openings) };
    intervals.push({ id: opening.id, wall: wall.id, a: along - width / 2, b: along + width / 2, low: opening.sillMm, high: top });
  }
  for (let i = 0; i < intervals.length; i++) for (let j = i + 1; j < intervals.length; j++) {
    const a = intervals[i]!, b = intervals[j]!;
    if (a.wall === b.wall && a.a < b.b && b.a < a.b && a.low < b.high && b.low < a.high) return { status: 'FAIL', reason: `opening_overlap:${a.id}:${b.id}`, resultSha256: sha256(intervals) };
  }
  return { status: 'PASS', reason: '', resultSha256: sha256(intervals) };
}
function deriveEgress(contract: BuildingProductContract): EgressRouteInput {
  const nodes: EgressRouteInput['nodes'] = [], edges: EgressRouteInput['edges'] = [], origins: string[] = [], exits: string[] = [];
  for (const route of contract.egressRoutes) {
    const ids = route.path.map((_, i) => `${route.id}:node:${i}`);
    route.path.forEach((p, i) => nodes.push({ id: ids[i]!, point: p, kind: i === 0 ? 'origin' : i === route.path.length - 1 ? 'exit' : 'junction' }));
    origins.push(ids[0]!); exits.push(ids.at(-1)!);
    for (let i = 0; i < ids.length - 1; i++) edges.push({ id: `${route.id}:edge:${i}`, from: ids[i]!, to: ids[i + 1]!, clearWidthMm: contract.requirements.egress.minClearWidthMm });
  }
  const required = Math.max(1, ...contract.requirements.egress.exitsByLevel.map(item => item.requiredCount));
  return { nodes, edges, originNodeIds: origins, exitNodeIds: exits, maximumTravelDistanceMm: contract.requirements.egress.maxTravelDistanceM * 1000, minimumClearWidthMm: contract.requirements.egress.minClearWidthMm, minimumIndependentExits: required };
}
function pointInPolygon(pointValue: BuildingPoint, polygon: BuildingPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > pointValue.y) !== (b.y > pointValue.y)
      && pointValue.x < (b.x - a.x) * (pointValue.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function stairsEgressAccessibility(contract: BuildingProductContract): { status: BuildingCheckStatus; reason: string; resultSha256: string } {
  const levels = new Map(contract.levels.map(level => [level.id, level]));
  const governedWidth = Math.max(contract.requirements.accessibility.minClearWidthMm, contract.requirements.egress.minClearWidthMm);
  const stair = contract.stairs.find(item => !levels.has(item.fromLevelId) || !levels.has(item.toLevelId) || item.fromLevelId === item.toLevelId || item.widthMm < governedWidth || !(item.riserMm > 0) || !(item.treadMm > 0) || item.landingCount < 1);
  if (stair) return { status: 'FAIL', reason: `stair_threshold_or_level:${stair.id}`, resultSha256: sha256(contract.stairs) };
  const door = contract.doors.find(item => item.widthMm < governedWidth || item.sillMm > contract.requirements.accessibility.maxLevelChangeMm);
  if (door) return { status: 'FAIL', reason: `accessibility_door_threshold:${door.id}`, resultSha256: sha256(contract.doors) };
  const spaces = new Map(contract.spaces.map(space => [space.id, space]));
  const doors = new Map(contract.doors.map(item => [item.id, item]));
  for (const route of contract.egressRoutes) {
    const origin = spaces.get(route.fromSpaceId), exit = doors.get(route.exitDoorId);
    const first = route.path[0], last = route.path.at(-1);
    if (!origin || !exit || origin.levelId !== route.levelId || exit.levelId !== route.levelId
      || !first || !last || !pointInPolygon(first, origin.boundary) || distance(last, exit.center) > 0.1) {
      return { status: 'FAIL', reason: `egress_route_binding:${route.id}`, resultSha256: sha256(route) };
    }
  }
  for (const requirement of contract.requirements.egress.exitsByLevel) {
    const count = new Set(contract.egressRoutes.filter(route => route.levelId === requirement.levelId).map(route => route.exitDoorId)).size;
    if (count < requirement.requiredCount) return { status: 'FAIL', reason: `egress_declared_exit_count:${requirement.levelId}`, resultSha256: sha256({ routes: contract.egressRoutes, requirement }) };
  }
  const input = deriveEgress(contract);
  let result; try { result = verifyEgressRoutes({ ...input, maximumTravelDistanceMm: contract.requirements.egress.maxTravelDistanceM * 1000, minimumClearWidthMm: contract.requirements.egress.minClearWidthMm, minimumIndependentExits: Math.max(1, ...contract.requirements.egress.exitsByLevel.map(item => item.requiredCount)) }); } catch { return { status: 'FAIL', reason: 'egress_input_invalid', resultSha256: sha256(input) }; }
  return { status: result.passed ? 'PASS' : 'FAIL', reason: result.passed ? '' : `egress_${result.failures.join('|')}`, resultSha256: sha256(result) };
}
function externalOrNotRun(options: BuildingVerificationOptions, id: BuildingCheckId): { status: BuildingCheckStatus; reason: string; resultSha256: string; evidence?: BuildingExternalEvidence } {
  const candidate = options.externalEvidence?.[id];
  if (!candidate) return { status: 'NOT_RUN', reason: `${id}_authority_not_run`, resultSha256: sha256(`${id}:not-run`) };
  if (!validEvidence(candidate)) return { status: 'HOLD', reason: `${id}_evidence_invalid`, resultSha256: sha256(`${id}:invalid-evidence`) };
  return { status: candidate.status, reason: candidate.reason, resultSha256: candidate.resultSha256, evidence: candidate };
}
function makeReceipt(id: BuildingCheckId, contract: BuildingProductContract, options: BuildingVerificationOptions, derived: { status: BuildingCheckStatus; reason: string; resultSha256: string; evidence?: BuildingExternalEvidence }): BuildingCheckReceipt {
  const coordinate = hashBuildingCoordinateAuthority(contract), evidence = derived.evidence;
  const base = { schema: BUILDING_PRODUCT_CHECK_RECEIPT_SCHEMA, checkId: id, status: evidence?.status ?? derived.status, sourceRevision: evidence?.sourceRevision ?? contract.identity.revision, modelSha256: evidence?.modelSha256 ?? contract.identity.contentSha256, coordinateAuthoritySha256: evidence?.coordinateAuthoritySha256 ?? coordinate, resultSha256: evidence?.resultSha256 ?? derived.resultSha256, validatorId: evidence?.validatorId ?? 'precision-cad.building', validatorVersion: evidence?.validatorVersion ?? 'v1', reviewerId: evidence?.reviewerId ?? 'precision-cad.validator', reason: evidence?.reason ?? derived.reason, issuedAt: options.now ?? '2026-08-24T00:00:00.000Z' };
  const stale = !sameRevision(base.sourceRevision, contract.identity.revision) || base.modelSha256 !== contract.identity.contentSha256 || base.coordinateAuthoritySha256 !== coordinate || (base.status === 'PASS' && base.reviewerId === 'none');
  return { ...base, status: stale ? 'STALE' : base.status, reason: stale ? 'receipt_revision_model_or_coordinate_mismatch' : base.reason };
}
function axisEvidence(axis: BuildingAxisEvidence['axis'], receipts: BuildingCheckReceipt[], revision: string): BuildingAxisEvidence {
  const status: BuildingCheckStatus = receipts.some(r => r.status === 'FAIL') ? 'FAIL' : receipts.some(r => r.status === 'STALE') ? 'STALE' : receipts.some(r => r.status === 'HOLD') ? 'HOLD' : receipts.some(r => r.status === 'NOT_RUN') ? 'NOT_RUN' : 'PASS';
  return { axis, status, sourceRevision: revision, caseCount: 1, accuracyBasisPoints: status === 'PASS' ? 10_000 : 0, coverageBasisPoints: status === 'PASS' ? 10_000 : 0, falseVerificationCount: 0, artifactSha256: sha256(receipts.map(r => r.resultSha256)) };
}

export function verifyBuildingProduct(contractInput: unknown, options: BuildingVerificationOptions = {}): BuildingVerificationResult {
  const contractIssues = validateBuildingProductContract(contractInput);
  if (contractIssues.length) return { status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false, sourceRevision: null, modelSha256: null, coordinateAuthoritySha256: null, receipts: [], axisEvidence: [], blockers: contractIssues.map(issue => `contract:${issue}`) };
  const contract = contractInput as BuildingProductContract, coordinate = hashBuildingCoordinateAuthority(contract);
  const checks: Record<BuildingCheckId, { status: BuildingCheckStatus; reason: string; resultSha256: string; evidence?: BuildingExternalEvidence }> = {
    'surveyed-host': externalOrNotRun(options, 'surveyed-host'),
    'level-grid': levelGrid(contract),
    'space-closure': closure(contract),
    'opening-integrity': openingIntegrity(contract),
    'stairs-egress-accessibility': stairsEgressAccessibility(contract),
    'envelope-continuity': externalOrNotRun(options, 'envelope-continuity'),
    'upstream-coordination': externalOrNotRun(options, 'upstream-coordination'),
    'drawing-schedule-quantity-consistency': externalOrNotRun(options, 'drawing-schedule-quantity-consistency'),
    'ifc-roundtrip': externalOrNotRun(options, 'ifc-roundtrip'),
    'code-authority': externalOrNotRun(options, 'code-authority'),
    'independent-review': externalOrNotRun(options, 'independent-review'),
  };
  const receipts = BUILDING_CHECK_IDS.map(id => makeReceipt(id, contract, options, checks[id]));
  const blockers = unique(receipts.flatMap(receipt => { const issues = validateBuildingCheckReceipt(receipt); if (issues.length) return issues.map(issue => `receipt_invalid:${receipt.checkId}:${issue}`); return receipt.status === 'PASS' ? [] : [`check_${receipt.status.toLowerCase()}:${receipt.checkId}${receipt.reason ? `:${receipt.reason}` : ''}`]; }));
  const by = (ids: BuildingCheckId[]) => receipts.filter(r => ids.includes(r.checkId));
  const axes = [
    axisEvidence('coordinates', by(['surveyed-host']), contract.identity.revision.id),
    axisEvidence('spatial-semantics', by(['level-grid', 'space-closure']), contract.identity.revision.id),
    axisEvidence('hosted-elements', by(['opening-integrity', 'envelope-continuity', 'upstream-coordination']), contract.identity.revision.id),
    axisEvidence('code-safety', by(['stairs-egress-accessibility', 'code-authority']), contract.identity.revision.id),
    axisEvidence('quantity-consistency', by(['drawing-schedule-quantity-consistency']), contract.identity.revision.id),
    axisEvidence('drawing-consistency', by(['drawing-schedule-quantity-consistency']), contract.identity.revision.id),
    axisEvidence('ifc-roundtrip', by(['ifc-roundtrip']), contract.identity.revision.id),
  ];
  const currentRevisionVerified = blockers.length === 0 && axes.every(axis => axis.status === 'PASS');
  return { status: currentRevisionVerified ? 'PASS' : blockers.some(blocker => blocker.startsWith('check_fail')) ? 'FAIL' : 'HOLD', currentRevisionVerified, productReceiptPromotionReady: false, sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256, coordinateAuthoritySha256: coordinate, receipts, axisEvidence: axes, blockers };
}
