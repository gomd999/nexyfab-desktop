import { createHash } from 'node:crypto';
import {
  verifyDoorSwingClearance,
  type DoorSwingClearanceInput,
} from '../../../src/lib/assembly/doorSwingClearance';
import {
  verifyEgressRoutes,
  type EgressRouteInput,
} from '../../../src/lib/assembly/egressRouteVerification';
import {
  verifySpaceBoundaryClosure,
  type BoundarySegment2,
} from '../../../src/lib/assembly/spaceBoundaryClosure';
import {
  validateInteriorProductContract,
  type InteriorObject,
  type InteriorPoint,
  type InteriorProductContract,
} from './contract';

export const INTERIOR_PRODUCT_CHECK_RECEIPT_SCHEMA = 'nexyfab.interior.check-receipt.v1' as const;

export type InteriorCheckStatus = 'PASS' | 'FAIL' | 'HOLD' | 'NOT_RUN' | 'STALE';
export type InteriorCheckId =
  | 'surveyed-host'
  | 'space-closure'
  | 'circulation-egress-accessibility'
  | 'door-swing'
  | 'ffe-clearance'
  | 'ceiling-mep-clash'
  | 'maintenance-access'
  | 'finish-thickness'
  | 'millwork-dimensions'
  | 'millwork-catalog'
  | 'photometric'
  | 'acoustic'
  | 'drawing-schedule-quantity-consistency'
  | 'ifc-roundtrip'
  | 'code-authority'
  | 'independent-review';

export const INTERIOR_CHECK_IDS: readonly InteriorCheckId[] = [
  'surveyed-host', 'space-closure', 'circulation-egress-accessibility', 'door-swing',
  'ffe-clearance', 'ceiling-mep-clash', 'maintenance-access', 'finish-thickness',
  'millwork-dimensions', 'millwork-catalog', 'photometric', 'acoustic',
  'drawing-schedule-quantity-consistency', 'ifc-roundtrip', 'code-authority', 'independent-review',
];

export interface InteriorCheckReceipt {
  schema: typeof INTERIOR_PRODUCT_CHECK_RECEIPT_SCHEMA;
  checkId: InteriorCheckId;
  status: InteriorCheckStatus;
  sourceRevision: string;
  modelSha256: string;
  coordinateFrameSha256: string;
  resultSha256: string;
  validatorId: string;
  validatorVersion: string;
  reviewerId: string;
  toleranceMm: number;
  reason: string;
  issuedAt: string;
}

export interface InteriorExternalEvidence {
  status: InteriorCheckStatus;
  sourceRevision: string;
  modelSha256: string;
  coordinateFrameSha256: string;
  resultSha256: string;
  validatorId: string;
  validatorVersion: string;
  reviewerId: string;
  toleranceMm: number;
  reason: string;
}

export interface InteriorVerificationOptions {
  /** Evidence produced by a governed external authority or independent tool. */
  externalEvidence?: Partial<Record<InteriorCheckId, InteriorExternalEvidence>>;
  egressInput?: EgressRouteInput;
  doorSwingInput?: DoorSwingClearanceInput;
  minimumFfeClearanceMm?: number;
  now?: string;
}

export interface InteriorAxisEvidence {
  axis: 'surveyed-host' | 'space-closure' | 'egress' | 'door-swing' | 'placement-clearance' | 'finish-schedule' | 'drawing-consistency' | 'exchange-roundtrip';
  status: InteriorCheckStatus;
  sourceRevision: string;
  caseCount: 1;
  accuracyBasisPoints: number;
  coverageBasisPoints: number;
  falseVerificationCount: 0;
  artifactSha256: string;
}

export interface InteriorVerificationResult {
  status: 'PASS' | 'HOLD' | 'FAIL';
  currentRevisionVerified: boolean;
  productReceiptPromotionReady: false;
  sourceRevision: string | null;
  modelSha256: string | null;
  coordinateFrameSha256: string | null;
  receipts: InteriorCheckReceipt[];
  axisEvidence: InteriorAxisEvidence[];
  blockers: string[];
}

const SHA = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RECEIPT_KEYS = ['schema', 'checkId', 'status', 'sourceRevision', 'modelSha256', 'coordinateFrameSha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'toleranceMm', 'reason', 'issuedAt'] as const;
const DERIVED_CHECK_IDS = new Set<InteriorCheckId>([
  'space-closure', 'circulation-egress-accessibility', 'door-swing', 'ffe-clearance',
]);

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : record(value)
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const unique = (values: string[]): string[] => [...new Set(values)];

function hashReceiptBody(receipt: Omit<InteriorCheckReceipt, 'resultSha256'>): string {
  return sha256(receipt);
}

function validEvidence(value: unknown): value is InteriorExternalEvidence {
  if (!record(value)) return false;
  return exactKeys(value, ['status', 'sourceRevision', 'modelSha256', 'coordinateFrameSha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'toleranceMm', 'reason'])
    && typeof value.status === 'string' && ['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(value.status)
    && typeof value.sourceRevision === 'string' && SAFE_ID.test(value.sourceRevision)
    && typeof value.modelSha256 === 'string' && SHA.test(value.modelSha256)
    && typeof value.coordinateFrameSha256 === 'string' && SHA.test(value.coordinateFrameSha256)
    && typeof value.resultSha256 === 'string' && SHA.test(value.resultSha256)
    && typeof value.validatorId === 'string' && SAFE_ID.test(value.validatorId)
    && typeof value.validatorVersion === 'string' && SAFE_ID.test(value.validatorVersion)
    && typeof value.reviewerId === 'string' && SAFE_ID.test(value.reviewerId)
    && typeof value.toleranceMm === 'number' && Number.isFinite(value.toleranceMm) && value.toleranceMm >= 0
    && typeof value.reason === 'string' && value.reason.length <= 256;
}

export function validateInteriorCheckReceipt(value: unknown): string[] {
  if (!record(value) || !exactKeys(value, RECEIPT_KEYS)) return ['receipt:keys_invalid'];
  const receipt = value as unknown as InteriorCheckReceipt;
  const issues: string[] = [];
  if (receipt.schema !== INTERIOR_PRODUCT_CHECK_RECEIPT_SCHEMA) issues.push('receipt:schema_invalid');
  if (!INTERIOR_CHECK_IDS.includes(receipt.checkId)) issues.push('receipt:check_id_invalid');
  if (typeof receipt.sourceRevision !== 'string' || !SAFE_ID.test(receipt.sourceRevision)) issues.push('receipt:revision_invalid');
  if (!SHA.test(receipt.modelSha256)) issues.push('receipt:model_hash_invalid');
  if (!SHA.test(receipt.coordinateFrameSha256)) issues.push('receipt:coordinate_hash_invalid');
  if (!SHA.test(receipt.resultSha256)) issues.push('receipt:result_hash_invalid');
  if (!SAFE_ID.test(receipt.validatorId) || !SAFE_ID.test(receipt.validatorVersion)) issues.push('receipt:validator_invalid');
  if (!SAFE_ID.test(receipt.reviewerId)) issues.push('receipt:reviewer_invalid');
  if (!Number.isFinite(receipt.toleranceMm) || receipt.toleranceMm < 0) issues.push('receipt:tolerance_invalid');
  if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(receipt.status)) issues.push('receipt:status_invalid');
  if (typeof receipt.reason !== 'string' || receipt.reason.length > 256) issues.push('receipt:reason_invalid');
  if (typeof receipt.issuedAt !== 'string' || !ISO.test(receipt.issuedAt) || Number.isNaN(Date.parse(receipt.issuedAt))) issues.push('receipt:issued_at_invalid');
  if (receipt.status === 'PASS' && receipt.reviewerId === 'none') issues.push('receipt:pass_review_required');
  return unique(issues);
}

function asPoint(value: unknown): InteriorPoint | null {
  if (!record(value) || typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

function polygon(value: unknown): InteriorPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points = value.map(asPoint);
  return points.every(Boolean) ? points as InteriorPoint[] : null;
}

function objectMap(contract: InteriorProductContract): Map<string, InteriorObject> {
  return new Map(contract.objects.map(object => [object.id, object]));
}

function derivedSpaceClosure(contract: InteriorProductContract): { status: InteriorCheckStatus; reason: string; hash: string } {
  const spaces = contract.objects.filter(object => object.kind === 'space');
  const results = spaces.map(space => {
    const points = polygon(space.data.polygon);
    if (!points || points.length < 4) return { id: space.id, status: 'FAIL' as const, reason: 'space_polygon_missing' };
    const segments: BoundarySegment2[] = points.slice(0, -1).map((start, index) => ({ id: `${space.id}:edge:${index}`, start, end: points[index + 1]! }));
    const result = verifySpaceBoundaryClosure({ segments, snapToleranceMm: 0.1, minimumAreaMm2: 1 });
    return { id: space.id, status: result.closed ? 'PASS' as const : 'FAIL' as const, reason: result.closed ? '' : `space_boundary_${result.issues[0]?.code ?? 'invalid'}` };
  });
  const status = results.length > 0 && results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL';
  return { status, reason: results.find(result => result.status !== 'PASS')?.reason ?? '', hash: sha256(results) };
}

function derivedFfeClearance(contract: InteriorProductContract, minimum: number | undefined): { status: InteriorCheckStatus; reason: string; hash: string } {
  const governedMinimum = contract.requirements.clearances.minWorkingClearanceMm;
  const requestedMinimum = minimum === undefined ? governedMinimum : minimum;
  if (!(requestedMinimum >= 0) || !Number.isFinite(requestedMinimum)) return { status: 'FAIL', reason: 'minimum_clearance_invalid', hash: sha256('invalid-minimum') };
  const effectiveMinimum = Math.max(governedMinimum, requestedMinimum);
  const spaces = contract.objects.filter(object => object.kind === 'space');
  const furniture = contract.objects.filter(object => object.kind === 'ffe-envelope' || object.kind === 'millwork');
  const spacePolygons = new Map(spaces.map(space => [space.id, polygon(space.data.polygon)]));
  const boxes = furniture.map(object => {
    const d = object.data;
    const x = Number(d.x), y = Number(d.y), width = Number(d.width), depth = Number(d.depth);
    const space = spacePolygons.get(String(d.spaceId));
    const inside = space && polygonContainsBox(space, x, y, width, depth);
    return { id: object.id, spaceId: String(d.spaceId), x, y, width, depth, inside };
  });
  const outside = boxes.find(box => !box.inside);
  if (outside) return { status: 'FAIL', reason: `ffe_outside_space:${outside.id}`, hash: sha256(boxes) };
  for (let index = 0; index < boxes.length; index += 1) for (let other = index + 1; other < boxes.length; other += 1) {
    const a = boxes[index]!, b = boxes[other]!;
    const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
    const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.depth, b.y + b.depth));
    const distance = Math.hypot(dx, dy);
    if (a.spaceId === b.spaceId && a.inside && b.inside && distance < effectiveMinimum) return { status: 'FAIL', reason: `ffe_clearance:${a.id}:${b.id}`, hash: sha256({ boxes, effectiveMinimum }) };
  }
  return { status: 'PASS', reason: '', hash: sha256({ boxes, effectiveMinimum }) };
}

function makeReceipt(
  checkId: InteriorCheckId,
  contract: InteriorProductContract,
  options: InteriorVerificationOptions,
  derived: { status: InteriorCheckStatus; reason: string; resultSha256: string; validatorId?: string; reviewerId?: string; toleranceMm?: number },
): InteriorCheckReceipt {
  const candidate = DERIVED_CHECK_IDS.has(checkId) ? undefined : options.externalEvidence?.[checkId];
  const supplied = validEvidence(candidate) ? candidate : undefined;
  const base = {
    schema: INTERIOR_PRODUCT_CHECK_RECEIPT_SCHEMA,
    checkId,
    status: supplied?.status ?? derived.status,
    sourceRevision: supplied?.sourceRevision ?? contract.identity.revision,
    modelSha256: supplied?.modelSha256 ?? contract.identity.contentSha256,
    coordinateFrameSha256: supplied?.coordinateFrameSha256 ?? contract.coordinateFrameSha256,
    validatorId: supplied?.validatorId ?? derived.validatorId ?? 'precision-cad.interior',
    validatorVersion: supplied?.validatorVersion ?? 'v1',
    reviewerId: supplied?.reviewerId ?? derived.reviewerId ?? 'precision-cad.validator',
    toleranceMm: supplied?.toleranceMm ?? derived.toleranceMm ?? 0.1,
    reason: supplied?.reason ?? derived.reason,
    issuedAt: options.now ?? '2026-01-01T00:00:00.000Z',
  } satisfies Omit<InteriorCheckReceipt, 'resultSha256'>;
  let status = base.status;
  const stale = base.sourceRevision !== contract.identity.revision
    || base.modelSha256 !== contract.identity.contentSha256
    || base.coordinateFrameSha256 !== contract.coordinateFrameSha256
    || (status === 'PASS' && base.reviewerId === 'none');
  if (stale) status = 'STALE';
  const reason = stale ? 'receipt_revision_model_coordinate_or_review_mismatch' : base.reason;
  const resultSha256 = supplied?.resultSha256 ?? derived.resultSha256;
  return { ...base, status, reason, resultSha256 };
}

function polygonContainsBox(space: InteriorPoint[] | null, x: number, y: number, width: number, depth: number): boolean {
  if (!space || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(depth)) return false;
  const points = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + depth }, { x, y: y + depth }];
  return points.every(point => {
    let inside = false;
    for (let i = 0, j = space.length - 1; i < space.length; j = i++) {
      const a = space[i]!, b = space[j]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });
}

function externalOrNotRun(options: InteriorVerificationOptions, id: InteriorCheckId): { status: InteriorCheckStatus; reason: string; resultSha256: string } {
  const evidence = options.externalEvidence?.[id];
  if (!evidence) return { status: 'NOT_RUN', reason: `${id}_authority_not_run`, resultSha256: sha256(`${id}:not-run`) };
  if (!validEvidence(evidence)) return { status: 'HOLD', reason: `${id}_evidence_invalid`, resultSha256: sha256(`${id}:invalid-evidence`) };
  return { status: evidence.status, reason: evidence.reason, resultSha256: evidence.resultSha256 };
}

function derivedDoorSwing(contract: InteriorProductContract, input: DoorSwingClearanceInput | undefined): { status: InteriorCheckStatus; reason: string; resultSha256: string } {
  if (!input) return { status: 'NOT_RUN', reason: 'door_swing_input_not_supplied', resultSha256: sha256('door-swing:not-run') };
  const openings = contract.objects.filter(object => object.kind === 'opening' && object.data.swing !== 'none');
  if (openings.length !== 1) return { status: 'FAIL', reason: 'one_bound_swing_input_per_opening_required', resultSha256: sha256({ openingCount: openings.length }) };
  const opening = openings[0]!;
  const wall = contract.objects.find(object => object.id === opening.data.hostWallId && object.kind === 'wall');
  const center = asPoint(opening.data.center), start = wall ? asPoint(wall.data.start) : null, end = wall ? asPoint(wall.data.end) : null;
  const width = Number(opening.data.width);
  if (!center || !start || !end || !Number.isFinite(width) || Math.abs(input.widthMm - width) > 0.1) {
    return { status: 'FAIL', reason: 'door_swing_geometry_binding_mismatch', resultSha256: sha256({ opening: opening.id, input }) };
  }
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const ux = length > 0 ? (end.x - start.x) / length : 0, uy = length > 0 ? (end.y - start.y) / length : 0;
  const hinges = [{ x: center.x - ux * width / 2, y: center.y - uy * width / 2 }, { x: center.x + ux * width / 2, y: center.y + uy * width / 2 }];
  if (!length || Math.min(...hinges.map(hinge => Math.hypot(hinge.x - input.pivot.x, hinge.y - input.pivot.y))) > 0.1) {
    return { status: 'FAIL', reason: 'door_swing_pivot_binding_mismatch', resultSha256: sha256({ opening: opening.id, hinges, pivot: input.pivot }) };
  }
  const result = verifyDoorSwingClearance(input);
  return { status: result.clear ? 'PASS' : 'FAIL', reason: result.clear ? '' : `door_swing_obstacle:${result.collidingObstacleIds.join('|')}`, resultSha256: sha256({ opening: opening.id, result }) };
}

function axisEvidence(axis: InteriorAxisEvidence['axis'], receipts: InteriorCheckReceipt[], revision: string): InteriorAxisEvidence {
  const status: InteriorCheckStatus = receipts.some(receipt => receipt.status === 'FAIL') ? 'FAIL'
    : receipts.some(receipt => receipt.status === 'STALE') ? 'STALE'
      : receipts.some(receipt => receipt.status === 'HOLD') ? 'HOLD'
        : receipts.some(receipt => receipt.status === 'NOT_RUN') ? 'NOT_RUN' : 'PASS';
  return { axis, status, sourceRevision: revision, caseCount: 1, accuracyBasisPoints: status === 'PASS' ? 10_000 : 0, coverageBasisPoints: status === 'PASS' ? 10_000 : 0, falseVerificationCount: 0, artifactSha256: sha256(receipts.map(receipt => receipt.resultSha256)), };
}

/**
 * Runs the interior product gates for one immutable contract revision. Missing
 * field, code, catalog, exchange, or review authority remains NOT_RUN/HOLD;
 * synthetic geometry never supplies those external facts implicitly.
 */
export function verifyInteriorProduct(contractInput: unknown, options: InteriorVerificationOptions = {}): InteriorVerificationResult {
  const contractIssues = validateInteriorProductContract(contractInput);
  if (contractIssues.length) return { status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false, sourceRevision: null, modelSha256: null, coordinateFrameSha256: null, receipts: [], axisEvidence: [], blockers: contractIssues.map(issue => `contract:${issue}`), };
  const contract = contractInput as InteriorProductContract;
  const objects = objectMap(contract);
  const closureResult = derivedSpaceClosure(contract);
  const closure = { status: closureResult.status, reason: closureResult.reason, resultSha256: closureResult.hash };
  const ffeResult = derivedFfeClearance(contract, options.minimumFfeClearanceMm);
  const ffe = { status: ffeResult.status, reason: ffeResult.reason, resultSha256: ffeResult.hash };
  const doorDerived = derivedDoorSwing(contract, options.doorSwingInput);
  const egressDerived = options.egressInput
    ? (() => {
      const governedInput = {
        ...options.egressInput!,
        maximumTravelDistanceMm: contract.requirements.egress.maxTravelDistanceM * 1000,
        minimumClearWidthMm: contract.requirements.egress.minClearWidthMm,
      };
      const result = verifyEgressRoutes(governedInput);
      return { status: result.passed ? 'PASS' as const : 'FAIL' as const, reason: result.passed ? '' : `egress_${result.failures.join('|')}`, resultSha256: sha256({ governedInput, result }) };
    })()
    : { status: 'NOT_RUN' as const, reason: 'egress_input_not_supplied', resultSha256: sha256('egress:not-run') };
  const hasCeilings = objectsHas(contract, 'ceiling');
  const hasMep = objectsHas(contract, 'mep-zone');
  const hasLighting = objectsHas(contract, 'lighting');
  const hasFinishes = objectsHas(contract, 'finish-layer');
  const hasMillwork = objectsHas(contract, 'millwork');
  const derivedChecks: Record<InteriorCheckId, { status: InteriorCheckStatus; reason: string; resultSha256: string }> = {
    'surveyed-host': externalOrNotRun(options, 'surveyed-host'),
    'space-closure': closure,
    'circulation-egress-accessibility': egressDerived,
    'door-swing': doorDerived,
    'ffe-clearance': ffe,
    'ceiling-mep-clash': hasCeilings && hasMep ? externalOrNotRun(options, 'ceiling-mep-clash') : { status: 'FAIL', reason: 'ceiling_or_mep_missing', resultSha256: sha256('ceiling-mep:missing') },
    'maintenance-access': hasCeilings && hasMep ? externalOrNotRun(options, 'maintenance-access') : { status: 'FAIL', reason: 'maintenance_host_objects_missing', resultSha256: sha256('maintenance:missing') },
    'finish-thickness': hasFinishes ? externalOrNotRun(options, 'finish-thickness') : { status: 'FAIL', reason: 'finish_layers_missing', resultSha256: sha256('finish:missing') },
    'millwork-dimensions': hasMillwork ? externalOrNotRun(options, 'millwork-dimensions') : { status: 'FAIL', reason: 'millwork_missing', resultSha256: sha256('millwork:missing') },
    'millwork-catalog': hasMillwork ? externalOrNotRun(options, 'millwork-catalog') : { status: 'FAIL', reason: 'millwork_missing', resultSha256: sha256('millwork:missing') },
    'photometric': hasLighting ? externalOrNotRun(options, 'photometric') : { status: 'FAIL', reason: 'lighting_missing', resultSha256: sha256('photometric:missing') },
    'acoustic': hasFinishes ? externalOrNotRun(options, 'acoustic') : { status: 'FAIL', reason: 'acoustic_host_missing', resultSha256: sha256('acoustic:missing') },
    'drawing-schedule-quantity-consistency': externalOrNotRun(options, 'drawing-schedule-quantity-consistency'),
    'ifc-roundtrip': externalOrNotRun(options, 'ifc-roundtrip'),
    'code-authority': externalOrNotRun(options, 'code-authority'),
    'independent-review': externalOrNotRun(options, 'independent-review'),
  };
  const receipts = INTERIOR_CHECK_IDS.map(checkId => makeReceipt(checkId, contract, options, derivedChecks[checkId]));
  const blockers = receipts.flatMap(receipt => {
    const receiptIssues = validateInteriorCheckReceipt(receipt);
    if (receiptIssues.length) return receiptIssues.map(issue => `receipt_invalid:${receipt.checkId}:${issue}`);
    return receipt.status === 'PASS' ? [] : [`check_${receipt.status.toLowerCase()}:${receipt.checkId}${receipt.reason ? `:${receipt.reason}` : ''}`];
  });
  const by = (ids: InteriorCheckId[]) => receipts.filter(receipt => ids.includes(receipt.checkId));
  const axis = [
    axisEvidence('surveyed-host', by(['surveyed-host']), contract.identity.revision),
    axisEvidence('space-closure', by(['space-closure']), contract.identity.revision),
    axisEvidence('egress', by(['circulation-egress-accessibility']), contract.identity.revision),
    axisEvidence('door-swing', by(['door-swing']), contract.identity.revision),
    axisEvidence('placement-clearance', by(['ffe-clearance']), contract.identity.revision),
    axisEvidence('finish-schedule', by(['finish-thickness', 'millwork-dimensions', 'millwork-catalog', 'photometric', 'acoustic']), contract.identity.revision),
    axisEvidence('drawing-consistency', by(['drawing-schedule-quantity-consistency', 'code-authority', 'independent-review']), contract.identity.revision),
    axisEvidence('exchange-roundtrip', by(['ifc-roundtrip']), contract.identity.revision),
  ];
  const currentRevisionVerified = blockers.length === 0 && axis.every(item => item.status === 'PASS');
  return { status: currentRevisionVerified ? 'PASS' : blockers.some(blocker => blocker.startsWith('check_fail')) ? 'FAIL' : 'HOLD', currentRevisionVerified, productReceiptPromotionReady: false, sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256, coordinateFrameSha256: contract.coordinateFrameSha256, receipts, axisEvidence: axis, blockers: unique(blockers), };
}

function objectsHas(contract: InteriorProductContract, kind: InteriorObject['kind']): boolean {
  return contract.objects.some(object => object.kind === kind);
}
