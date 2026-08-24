import { createHash } from 'node:crypto';
import {
  validateCivilSiteAccessRoadDrainageContract,
  calculateCivilEarthworkGrid,
  type CivilAlignmentSegment,
  type CivilPoint,
  type CivilRevision,
  type CivilSiteAccessRoadDrainageContract,
  type CivilTinTriangle,
} from './contract';
import type { DomainValidationEvidence } from '../../../src/lib/cad/domainProductReceipt';

export const CIVIL_PRODUCT_CHECK_RECEIPT_SCHEMA = 'nexyfab.civil.check-receipt.v1' as const;
export type CivilCheckStatus = 'PASS' | 'FAIL' | 'HOLD' | 'NOT_RUN' | 'STALE';
export type CivilCheckId =
  | 'survey-datum' | 'tin-topology' | 'tin-coverage' | 'alignment-geometry'
  | 'profile-vertical' | 'cross-sections' | 'corridor' | 'drainage-network'
  | 'drainage-hydraulics' | 'catchments-outlets' | 'earthwork-grid'
  | 'construction-stages' | 'quantity-consistency' | 'landxml-roundtrip'
  | 'professional-review';

export const CIVIL_CHECK_IDS: readonly CivilCheckId[] = [
  'survey-datum', 'tin-topology', 'tin-coverage', 'alignment-geometry',
  'profile-vertical', 'cross-sections', 'corridor', 'drainage-network',
  'drainage-hydraulics', 'catchments-outlets', 'earthwork-grid',
  'construction-stages', 'quantity-consistency', 'landxml-roundtrip',
  'professional-review',
];

export interface CivilCheckReceipt {
  schema: typeof CIVIL_PRODUCT_CHECK_RECEIPT_SCHEMA;
  checkId: CivilCheckId;
  status: CivilCheckStatus;
  sourceRevision: CivilRevision;
  modelSha256: string;
  coordinateAuthoritySha256: string;
  resultSha256: string;
  validatorId: string;
  validatorVersion: string;
  reviewerId: string;
  reason: string;
  issuedAt: string;
}

export interface CivilExternalEvidence {
  status: CivilCheckStatus;
  sourceRevision: CivilRevision;
  modelSha256: string;
  coordinateAuthoritySha256: string;
  resultSha256: string;
  validatorId: string;
  validatorVersion: string;
  reviewerId: string;
  reason: string;
}

export interface CivilVerificationOptions {
  externalEvidence?: Partial<Record<CivilCheckId, CivilExternalEvidence>>;
  now?: string;
}

export interface CivilAxisEvidence {
  axis: 'survey-datum' | 'surface' | 'alignment-corridor' | 'drainage-hydraulics' | 'quantity-consistency' | 'landxml-roundtrip';
  status: CivilCheckStatus;
  sourceRevision: string;
  caseCount: 1;
  accuracyBasisPoints: number;
  coverageBasisPoints: number;
  falseVerificationCount: 0;
  artifactSha256: string;
}

export interface CivilVerificationResult {
  status: 'PASS' | 'HOLD' | 'FAIL';
  currentRevisionVerified: boolean;
  productReceiptPromotionReady: false;
  sourceRevision: CivilRevision | null;
  modelSha256: string | null;
  coordinateAuthoritySha256: string | null;
  receipts: CivilCheckReceipt[];
  axisEvidence: CivilAxisEvidence[];
  blockers: string[];
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RECEIPT_KEYS = ['schema', 'checkId', 'status', 'sourceRevision', 'modelSha256', 'coordinateAuthoritySha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'reason', 'issuedAt'] as const;
const EVIDENCE_KEYS = ['status', 'sourceRevision', 'modelSha256', 'coordinateAuthoritySha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'reason'] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : record(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const unique = (values: string[]): string[] => [...new Set(values)];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const sameRevision = (actual: unknown, expected: CivilRevision): boolean => record(actual) && actual.id === expected.id && actual.sha256 === expected.sha256;
const distance2 = (a: CivilPoint, b: CivilPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

export function hashCivilCoordinateAuthority(contract: CivilSiteAccessRoadDrainageContract): string {
  return sha256({
    revision: contract.identity.revision,
    survey: contract.authority.survey,
    coordinateReference: contract.authority.coordinateReference,
    controlPoints: contract.authority.coordinateReference.controlPointIds,
  });
}

export function validateCivilCheckReceipt(value: unknown): string[] {
  if (!record(value) || !exact(value, RECEIPT_KEYS)) return ['receipt:keys_invalid'];
  const receipt = value as unknown as CivilCheckReceipt;
  const issues: string[] = [];
  if (receipt.schema !== CIVIL_PRODUCT_CHECK_RECEIPT_SCHEMA) issues.push('receipt:schema_invalid');
  if (!CIVIL_CHECK_IDS.includes(receipt.checkId)) issues.push('receipt:check_id_invalid');
  if (!record(receipt.sourceRevision) || !ID.test(receipt.sourceRevision.id) || !SHA.test(receipt.sourceRevision.sha256)) issues.push('receipt:revision_invalid');
  for (const [name, hash] of [['model', receipt.modelSha256], ['coordinate', receipt.coordinateAuthoritySha256], ['result', receipt.resultSha256]] as const) if (!SHA.test(hash)) issues.push(`receipt:${name}_hash_invalid`);
  for (const [name, id] of [['validator', receipt.validatorId], ['validator_version', receipt.validatorVersion], ['reviewer', receipt.reviewerId]] as const) if (!ID.test(id)) issues.push(`receipt:${name}_invalid`);
  if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(receipt.status)) issues.push('receipt:status_invalid');
  if (typeof receipt.reason !== 'string' || receipt.reason.length > 256) issues.push('receipt:reason_invalid');
  if (typeof receipt.issuedAt !== 'string' || !ISO.test(receipt.issuedAt) || Number.isNaN(Date.parse(receipt.issuedAt))) issues.push('receipt:issued_at_invalid');
  if (receipt.status === 'PASS' && receipt.reviewerId === 'none') issues.push('receipt:pass_review_required');
  return unique(issues);
}

function validExternalEvidence(value: unknown): value is CivilExternalEvidence {
  if (!record(value) || !exact(value, EVIDENCE_KEYS)) return false;
  return ['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(String(value.status))
    && record(value.sourceRevision) && ID.test(String(value.sourceRevision.id)) && SHA.test(String(value.sourceRevision.sha256))
    && SHA.test(String(value.modelSha256)) && SHA.test(String(value.coordinateAuthoritySha256)) && SHA.test(String(value.resultSha256))
    && ID.test(String(value.validatorId)) && ID.test(String(value.validatorVersion)) && ID.test(String(value.reviewerId))
    && typeof value.reason === 'string' && value.reason.length <= 256;
}

type Derived = { status: CivilCheckStatus; reason: string; resultSha256: string; evidence?: CivilExternalEvidence };

function externalOrNotRun(options: CivilVerificationOptions, id: CivilCheckId): Derived {
  const candidate = options.externalEvidence?.[id];
  if (!candidate) return { status: 'NOT_RUN', reason: `${id}_authority_not_run`, resultSha256: sha256(`${id}:not-run`) };
  if (!validExternalEvidence(candidate)) return { status: 'HOLD', reason: `${id}_evidence_invalid`, resultSha256: sha256(`${id}:invalid-evidence`) };
  return { status: candidate.status, reason: candidate.reason, resultSha256: candidate.resultSha256, evidence: candidate };
}

function surveyDatum(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const controls = new Set(contract.authority.coordinateReference.controlPointIds);
  const points = new Map(contract.surveyPoints.map(point => [point.id, point]));
  const missing = [...controls].find(id => !points.has(id) || !finite(points.get(id)?.point.z));
  const issue = missing ?? (controls.size < 2 ? 'control_network_too_small' : '');
  return { status: issue ? 'FAIL' : 'PASS', reason: issue ? `survey_control_invalid:${issue}` : '', resultSha256: sha256({ authority: contract.authority, controls: [...controls].sort() }) };
}

function tinTopology(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const points = new Map(contract.surveyPoints.map(item => [item.id, item.point]));
  const triangles = contract.tinTriangles;
  const byId = new Map(triangles.map(item => [item.id, item]));
  const bad: string[] = [];
  for (const triangle of triangles) {
    const vertices = triangle.vertexPointIds.map(id => points.get(id));
    if (vertices.some(point => !point) || new Set(triangle.vertexPointIds).size !== 3) { bad.push(`${triangle.id}:vertices`); continue; }
    const [a, b, c] = vertices as CivilPoint[];
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-10) bad.push(`${triangle.id}:degenerate`);
    for (const neighbourId of triangle.neighborTriangleIds) {
      const neighbour = byId.get(neighbourId);
      if (!neighbour || neighbour.surface !== triangle.surface || !neighbour.neighborTriangleIds.includes(triangle.id)) bad.push(`${triangle.id}:neighbor:${neighbourId}`);
    }
  }
  return { status: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `tin_topology:${bad[0]}` : '', resultSha256: sha256({ triangles, bad }) };
}

function tinCoverage(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const used = new Set(contract.tinTriangles.flatMap(triangle => triangle.vertexPointIds));
  const missing = contract.surveyPoints.find(point => !used.has(point.id));
  const hasSurface = (surface: 'existing' | 'proposed') => contract.tinTriangles.some(triangle => triangle.surface === surface);
  const issue = missing ? `point_uncovered:${missing.id}` : !hasSurface('existing') ? 'existing_surface_missing' : !hasSurface('proposed') ? 'proposed_surface_missing' : '';
  return { status: issue ? 'FAIL' : 'PASS', reason: issue ? `tin_xy_coverage:${issue}` : '', resultSha256: sha256({ used: [...used].sort(), surfaces: contract.tinTriangles.map(item => item.surface) }) };
}

function alignmentGeometry(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const segments = [...contract.alignmentSegments].sort((a, b) => a.startStation - b.startStation);
  const bad: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (index > 0) {
      const previous = segments[index - 1]!;
      if (Math.abs(segment.startStation - previous.endStation) > 1e-6) bad.push(`${segment.id}:station_gap`);
      if (distance2(segment.startPoint, previous.endPoint) > 1e-6) bad.push(`${segment.id}:geometry_gap`);
    }
    if (segment.kind === 'arc' && (!finite(segment.radiusM) || segment.radiusM < contract.criteria.alignment.values.minRadiusM)) bad.push(`${segment.id}:radius`);
  }
  const profile = [...contract.profilePoints].sort((a, b) => a.station - b.station);
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1]!, current = profile[index]!;
    const stationGap = current.station - previous.station;
    if (stationGap <= 0) bad.push(`${current.id}:station`);
    if (stationGap > 0 && Math.abs((current.elevationM - previous.elevationM) / stationGap * 100) > contract.criteria.alignment.values.maxGradePercent) bad.push(`${current.id}:grade`);
  }
  return { status: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `alignment_geometry:${bad[0]}` : '', resultSha256: sha256({ segments, profile, bad }) };
}

function profileVertical(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const points = [...contract.profilePoints].sort((a, b) => a.station - b.station);
  const criteria = contract.criteria.profile.values;
  const bad: string[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!, current = points[index]!;
    const gap = current.station - previous.station;
    if (!(gap > 0) || gap > criteria.maxStationGapM) bad.push(`${current.id}:station_gap`);
    if (gap > 0 && Math.abs((current.elevationM - previous.elevationM) / gap * 100) > criteria.maxGradePercent) bad.push(`${current.id}:grade`);
  }
  const start = points[0]?.station ?? 0, end = points.at(-1)?.station ?? 0;
  for (const curve of contract.verticalCurves) {
    if (curve.startStation < start || curve.endStation > end || curve.endStation <= curve.startStation || Math.abs(curve.lengthM - (curve.endStation - curve.startStation)) > 1e-6 || curve.lengthM < criteria.minVerticalCurveLengthM) bad.push(`${curve.id}:range_or_length`);
  }
  return { status: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `profile_vertical:${bad[0]}` : '', resultSha256: sha256({ points, curves: contract.verticalCurves, bad }) };
}

function crossSections(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const sections = [...contract.crossSections].sort((a, b) => a.station - b.station);
  const alignmentEnd = Math.max(...contract.alignmentSegments.map(segment => segment.endStation));
  const bad = sections.find((section, index) => section.station < 0 || section.station > alignmentEnd || (index > 0 && section.station <= sections[index - 1]!.station) || section.samples.some((sample, sampleIndex) => sampleIndex > 0 && sample.offsetM <= section.samples[sampleIndex - 1]!.offsetM));
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? `cross_section_order_or_range:${bad.id}` : '', resultSha256: sha256({ sections, alignmentEnd }) };
}

function corridor(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const segments = new Map(contract.alignmentSegments.map(item => [item.id, item]));
  const sections = new Map(contract.crossSections.map(item => [item.id, item]));
  const triangles = new Set(contract.tinTriangles.map(item => item.id));
  const criteria = contract.criteria.corridor.values;
  const bad = contract.corridorAssemblies.find(assembly => {
    if (!assembly.alignmentSegmentIds.length || assembly.alignmentSegmentIds.some(id => !segments.has(id)) || !assembly.crossSectionIds.length || assembly.crossSectionIds.some(id => !sections.has(id))) return true;
    return assembly.targets.some(target => !target.surfaceTriangleIds.every(id => triangles.has(id)) || (target.kind === 'width' && target.value < criteria.leftWidthM + criteria.rightWidthM) || (target.kind === 'slope' && Math.abs(target.value) > criteria.maxSideSlopePercent));
  });
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? `corridor_target_or_reference:${bad.id}` : '', resultSha256: sha256({ assemblies: contract.corridorAssemblies, criteria }) };
}

function drainageNetwork(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const nodes = new Map(contract.drainageNodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const bad: string[] = [];
  for (const pipe of contract.pipes) {
    const from = nodes.get(pipe.fromNodeId), to = nodes.get(pipe.toNodeId);
    if (!from || !to || to.kind === 'inlet' || from.kind === 'outfall' || !finite(from.point.z) || !finite(to.point.z)) { bad.push(`${pipe.id}:direction`); continue; }
    if (!(from.point.z > to.point.z) || !(pipe.slopePercent > 0)) bad.push(`${pipe.id}:invert_slope`);
    outgoing.set(pipe.fromNodeId, [...(outgoing.get(pipe.fromNodeId) ?? []), pipe.toNodeId]);
  }
  const outfalls = new Set(contract.drainageNodes.filter(node => node.kind === 'outfall').map(node => node.id));
  const reachesOutfall = (start: string): boolean => {
    const seen = new Set<string>(); const visit = (id: string): boolean => { if (outfalls.has(id)) return true; if (seen.has(id)) return false; seen.add(id); return (outgoing.get(id) ?? []).some(visit); };
    return visit(start);
  };
  for (const node of contract.drainageNodes.filter(item => item.kind !== 'outfall')) if (!reachesOutfall(node.id)) bad.push(`${node.id}:no_outfall_path`);
  return { status: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `drainage_network:${bad[0]}` : '', resultSha256: sha256({ nodes: contract.drainageNodes, pipes: contract.pipes, bad }) };
}

function drainageHydraulics(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const criteria = contract.criteria.drainage.values;
  const nodes = new Map(contract.drainageNodes.map(node => [node.id, node]));
  const bad = contract.pipes.find(pipe => {
    const from = nodes.get(pipe.fromNodeId), to = nodes.get(pipe.toNodeId);
    const area = Math.PI * (pipe.diameterM / 2) ** 2;
    const expectedSlope = from && to ? (from.point.z! - to.point.z!) / pipe.lengthM * 100 : Number.NaN;
    const velocity = area > 0 ? criteria.designFlowM3S / area : Number.POSITIVE_INFINITY;
    return !from || !to || Math.abs(pipe.slopePercent - expectedSlope) > 0.1 || pipe.coverM < criteria.minCoverM || pipe.capacityM3S < criteria.designFlowM3S || velocity > criteria.maxVelocityMS;
  });
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? `drainage_hydraulics:${bad.id}` : '', resultSha256: sha256({ pipes: contract.pipes, criteria }) };
}

function combineStructuralAndExternal(structural: Derived, external: Derived): Derived {
  // An independent receipt can add authority, but it cannot turn a failed
  // deterministic geometry/calculation check into a pass.
  if (structural.status === 'FAIL') return structural;
  if (external.evidence) return external;
  return { ...external, reason: structural.reason || external.reason, resultSha256: sha256({ structural: structural.resultSha256, external: external.resultSha256 }) };
}

function catchmentsOutlets(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const nodeIds = new Set(contract.drainageNodes.map(node => node.id));
  const outfalls = new Set(contract.drainageNodes.filter(node => node.kind === 'outfall').map(node => node.id));
  const bad = contract.catchments.find(catchment => !nodeIds.has(catchment.outletNodeId) || outfalls.has(catchment.outletNodeId) && catchment.areaM2 <= 0);
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? `catchment_outlet:${bad.id}` : '', resultSha256: sha256({ catchments: contract.catchments, outfalls: [...outfalls].sort() }) };
}

function earthworkGrid(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const surfaces = new Map(contract.earthworkSurfaces.map(surface => [surface.id, surface]));
  const triangles = new Map(contract.tinTriangles.map(triangle => [triangle.id, triangle]));
  const bad = contract.gridBindings.find(grid => {
    const surface = surfaces.get(grid.surfaceId);
    return !surface || !grid.gridSha256 || surface.triangleIds.length === 0 || surface.triangleIds.some(id => triangles.get(id)?.surface !== surface.kind);
  });
  const kinds = new Set(contract.earthworkSurfaces.map(surface => surface.kind));
  let issue = bad ? `grid:${bad.id}` : !kinds.has('existing') ? 'existing_surface_missing' : !kinds.has('proposed') ? 'proposed_surface_missing' : '';
  let calculation: ReturnType<typeof calculateCivilEarthworkGrid> | null = null;
  if (!issue) {
    try { calculation = calculateCivilEarthworkGrid(contract); }
    catch (error) { issue = error instanceof Error ? error.message : 'grid_calculation_failed'; }
  }
  if (calculation && (calculation.maxCutDepthM > contract.criteria.earthwork.values.maxCutDepthM + 1e-9 || calculation.maxFillDepthM > contract.criteria.earthwork.values.maxFillDepthM + 1e-9 || Math.abs(calculation.netVolumeM3) > contract.criteria.earthwork.values.balanceToleranceM3 + 1e-9)) issue = 'earthwork_criteria_exceeded';
  return { status: issue ? 'FAIL' : 'PASS', reason: issue ? `earthwork_grid:${issue}` : '', resultSha256: sha256({ surfaces: contract.earthworkSurfaces, grids: contract.gridBindings, calculation }) };
}

function constructionStages(contract: CivilSiteAccessRoadDrainageContract): Derived {
  const stages = new Map(contract.constructionStages.map(stage => [stage.id, stage]));
  const visiting = new Set<string>(), visited = new Set<string>(), bad: string[] = [];
  const visit = (id: string): void => { if (visiting.has(id)) { bad.push(`${id}:cycle`); return; } if (visited.has(id)) return; const stage = stages.get(id); if (!stage) { bad.push(`${id}:missing`); return; } visiting.add(id); stage.dependsOnStageIds.forEach(visit); visiting.delete(id); visited.add(id); };
  stages.forEach((_, id) => visit(id));
  return { status: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `construction_stage_dag:${bad[0]}` : '', resultSha256: sha256({ stages: contract.constructionStages, bad }) };
}

function makeReceipt(checkId: CivilCheckId, contract: CivilSiteAccessRoadDrainageContract, options: CivilVerificationOptions, derived: Derived, coordinate: string): CivilCheckReceipt {
  const evidence = derived.evidence;
  const base = {
    schema: CIVIL_PRODUCT_CHECK_RECEIPT_SCHEMA, checkId,
    status: evidence?.status ?? derived.status,
    sourceRevision: evidence?.sourceRevision ?? contract.identity.revision,
    modelSha256: evidence?.modelSha256 ?? contract.identity.contentSha256,
    coordinateAuthoritySha256: evidence?.coordinateAuthoritySha256 ?? coordinate,
    resultSha256: evidence?.resultSha256 ?? derived.resultSha256,
    validatorId: evidence?.validatorId ?? 'precision-cad.civil', validatorVersion: evidence?.validatorVersion ?? 'v1',
    reviewerId: evidence?.reviewerId ?? 'precision-cad.validator', reason: evidence?.reason ?? derived.reason,
    issuedAt: options.now ?? '2026-08-24T00:00:00.000Z',
  } satisfies Omit<CivilCheckReceipt, 'resultSha256'> & { resultSha256: string };
  const stale = !sameRevision(base.sourceRevision, contract.identity.revision) || base.modelSha256 !== contract.identity.contentSha256 || base.coordinateAuthoritySha256 !== coordinate || (base.status === 'PASS' && base.reviewerId === 'none');
  return { ...base, status: stale ? 'STALE' : base.status, reason: stale ? 'receipt_revision_model_or_coordinate_mismatch' : base.reason };
}

function axisEvidence(axis: CivilAxisEvidence['axis'], receipts: CivilCheckReceipt[], revision: CivilRevision): CivilAxisEvidence {
  const status: CivilCheckStatus = receipts.some(item => item.status === 'FAIL') ? 'FAIL' : receipts.some(item => item.status === 'STALE') ? 'STALE' : receipts.some(item => item.status === 'HOLD') ? 'HOLD' : receipts.some(item => item.status === 'NOT_RUN') ? 'NOT_RUN' : 'PASS';
  return { axis, status, sourceRevision: revision.id, caseCount: 1, accuracyBasisPoints: status === 'PASS' ? 10_000 : 0, coverageBasisPoints: status === 'PASS' ? 10_000 : 0, falseVerificationCount: 0, artifactSha256: sha256(receipts.map(item => item.resultSha256)) };
}

/** Verifies one immutable civil revision. One case is evidence only; it can never promote the product receipt. */
export function verifyCivilProduct(contractInput: unknown, options: CivilVerificationOptions = {}): CivilVerificationResult {
  const contractIssues = validateCivilSiteAccessRoadDrainageContract(contractInput);
  if (contractIssues.length) return { status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false, sourceRevision: null, modelSha256: null, coordinateAuthoritySha256: null, receipts: [], axisEvidence: [], blockers: contractIssues.map(issue => `contract:${issue}`) };
  const contract = contractInput as CivilSiteAccessRoadDrainageContract;
  const coordinate = hashCivilCoordinateAuthority(contract);
  const derived: Record<CivilCheckId, Derived> = {
    'survey-datum': combineStructuralAndExternal(surveyDatum(contract), externalOrNotRun(options, 'survey-datum')),
    'tin-topology': tinTopology(contract), 'tin-coverage': tinCoverage(contract), 'alignment-geometry': alignmentGeometry(contract),
    'profile-vertical': profileVertical(contract), 'cross-sections': crossSections(contract), 'corridor': corridor(contract),
    'drainage-network': drainageNetwork(contract), 'drainage-hydraulics': combineStructuralAndExternal(drainageHydraulics(contract), externalOrNotRun(options, 'drainage-hydraulics')),
    'catchments-outlets': catchmentsOutlets(contract), 'earthwork-grid': earthworkGrid(contract), 'construction-stages': constructionStages(contract),
    'quantity-consistency': externalOrNotRun(options, 'quantity-consistency'), 'landxml-roundtrip': externalOrNotRun(options, 'landxml-roundtrip'),
    'professional-review': externalOrNotRun(options, 'professional-review'),
  };
  const receipts = CIVIL_CHECK_IDS.map(id => makeReceipt(id, contract, options, derived[id], coordinate));
  const blockers = unique(receipts.flatMap(receipt => {
    const issues = validateCivilCheckReceipt(receipt);
    if (issues.length) return issues.map(issue => `receipt_invalid:${receipt.checkId}:${issue}`);
    return receipt.status === 'PASS' ? [] : [`check_${receipt.status.toLowerCase()}:${receipt.checkId}${receipt.reason ? `:${receipt.reason}` : ''}`];
  }));
  const by = (ids: CivilCheckId[]) => receipts.filter(receipt => ids.includes(receipt.checkId));
  const axes: CivilAxisEvidence[] = [
    axisEvidence('survey-datum', by(['survey-datum']), contract.identity.revision),
    axisEvidence('surface', by(['tin-topology', 'tin-coverage']), contract.identity.revision),
    axisEvidence('alignment-corridor', by(['alignment-geometry', 'profile-vertical', 'cross-sections', 'corridor']), contract.identity.revision),
    axisEvidence('drainage-hydraulics', by(['drainage-network', 'drainage-hydraulics', 'catchments-outlets']), contract.identity.revision),
    axisEvidence('quantity-consistency', by(['earthwork-grid', 'quantity-consistency']), contract.identity.revision),
    axisEvidence('landxml-roundtrip', by(['landxml-roundtrip']), contract.identity.revision),
  ];
  const currentRevisionVerified = blockers.length === 0 && axes.every(axis => axis.status === 'PASS');
  return { status: currentRevisionVerified ? 'PASS' : blockers.some(blocker => blocker.startsWith('check_fail')) ? 'FAIL' : 'HOLD', currentRevisionVerified, productReceiptPromotionReady: false, sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256, coordinateAuthoritySha256: coordinate, receipts, axisEvidence: axes, blockers };
}
