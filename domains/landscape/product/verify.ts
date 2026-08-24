import { createHash } from 'node:crypto';
import {
  validateLandscapeProductContract,
  type LandscapePoint,
  type LandscapeProductContract,
  type LandscapeRevision,
} from './contract';
import { validateLandscapeSiteDeliverableBinding } from './deliverables';

export const LANDSCAPE_PRODUCT_CHECK_RECEIPT_SCHEMA = 'nexyfab.landscape.check-receipt.v1' as const;
export type LandscapeCheckStatus = 'PASS' | 'FAIL' | 'HOLD' | 'NOT_RUN' | 'STALE';
export type LandscapeCheckId =
  | 'coordinate-terrain' | 'terrain-grading' | 'hardscape-accessibility' | 'soil-volume'
  | 'planting-containment' | 'mature-clearance' | 'irrigation-network' | 'irrigation-hydraulics'
  | 'water-budget' | 'maintenance-access' | 'quantity-consistency' | 'drawing-consistency'
  | 'site-model-roundtrip' | 'catalog-authority' | 'code-authority' | 'professional-review';

export const LANDSCAPE_CHECK_IDS: readonly LandscapeCheckId[] = [
  'coordinate-terrain', 'terrain-grading', 'hardscape-accessibility', 'soil-volume',
  'planting-containment', 'mature-clearance', 'irrigation-network', 'irrigation-hydraulics',
  'water-budget', 'maintenance-access', 'quantity-consistency', 'drawing-consistency',
  'site-model-roundtrip', 'catalog-authority', 'code-authority', 'professional-review',
];

export interface LandscapeCheckReceipt {
  schema: typeof LANDSCAPE_PRODUCT_CHECK_RECEIPT_SCHEMA;
  checkId: LandscapeCheckId; status: LandscapeCheckStatus; sourceRevision: LandscapeRevision;
  modelSha256: string; coordinateAuthoritySha256: string; resultSha256: string;
  validatorId: string; validatorVersion: string; reviewerId: string; reason: string; issuedAt: string;
}
export interface LandscapeExternalEvidence {
  status: LandscapeCheckStatus; sourceRevision: LandscapeRevision; modelSha256: string;
  coordinateAuthoritySha256: string; resultSha256: string; validatorId: string;
  validatorVersion: string; reviewerId: string; reason: string;
}
export interface LandscapeVerificationOptions {
  externalEvidence?: Partial<Record<LandscapeCheckId, LandscapeExternalEvidence>>;
  /** Optional independently validated site-model binding. It is never synthesized by this verifier. */
  deliverableBinding?: unknown;
  now?: string;
}
export interface LandscapeAxisEvidence {
  axis: 'terrain-grading' | 'planting' | 'mature-clearance' | 'irrigation-hydraulics' | 'water-budget' | 'quantity-consistency' | 'drawing-consistency';
  status: LandscapeCheckStatus; sourceRevision: string; caseCount: 1;
  accuracyBasisPoints: number; coverageBasisPoints: number; falseVerificationCount: 0; artifactSha256: string;
}
export interface LandscapeVerificationResult {
  status: 'PASS' | 'HOLD' | 'FAIL'; currentRevisionVerified: boolean; productReceiptPromotionReady: false;
  sourceRevision: LandscapeRevision | null; modelSha256: string | null; coordinateAuthoritySha256: string | null;
  receipts: LandscapeCheckReceipt[]; axisEvidence: LandscapeAxisEvidence[]; blockers: string[];
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RECEIPT_KEYS = ['schema', 'checkId', 'status', 'sourceRevision', 'modelSha256', 'coordinateAuthoritySha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'reason', 'issuedAt'] as const;
const EVIDENCE_KEYS = ['status', 'sourceRevision', 'modelSha256', 'coordinateAuthoritySha256', 'resultSha256', 'validatorId', 'validatorVersion', 'reviewerId', 'reason'] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((item, index) => item === expected[index]); };
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : record(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown) => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const sameRevision = (actual: unknown, expected: LandscapeRevision) => record(actual) && actual.id === expected.id && actual.sha256 === expected.sha256;
const unique = (values: string[]) => [...new Set(values)];
const distance = (a: LandscapePoint, b: LandscapePoint) => Math.hypot(a.x - b.x, a.y - b.y);

export function hashLandscapeCoordinateAuthority(contract: LandscapeProductContract): string {
  return sha256({ revision: contract.identity.revision, coordinateFrame: contract.authority.coordinateFrame, terrainBinding: contract.authority.terrainBinding });
}

function polygonArea(points: LandscapePoint[]): number {
  let sum = 0; for (let index = 0; index < points.length - 1; index += 1) sum += points[index]!.x * points[index + 1]!.y - points[index + 1]!.x * points[index]!.y;
  return Math.abs(sum) / 2;
}
function pointOnSegment(point: LandscapePoint, a: LandscapePoint, b: LandscapePoint): boolean {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  return Math.abs(cross) <= 1e-9 && point.x >= Math.min(a.x, b.x) - 1e-9 && point.x <= Math.max(a.x, b.x) + 1e-9 && point.y >= Math.min(a.y, b.y) - 1e-9 && point.y <= Math.max(a.y, b.y) + 1e-9;
}
function pointInPolygon(point: LandscapePoint, polygon: LandscapePoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!, b = polygon[previous]!;
    if (pointOnSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function circleInsidePolygon(center: LandscapePoint, radius: number, polygon: LandscapePoint[]): boolean {
  if (!(radius >= 0) || !pointInPolygon(center, polygon)) return false;
  return polygon.slice(0, -1).every((a, index) => {
    const b = polygon[index + 1]!; const length = distance(a, b); if (!(length > 0)) return false;
    const cross = Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) / length;
    const along = ((center.x - a.x) * (b.x - a.x) + (center.y - a.y) * (b.y - a.y)) / length;
    const edgeDistance = along >= 0 && along <= length ? cross : Math.min(distance(center, a), distance(center, b));
    return edgeDistance + 1e-9 >= radius;
  });
}
const baseId = (value: unknown): string | undefined => record(value) && typeof value.id === 'string' ? value.id : undefined;

export function validateLandscapeCheckReceipt(value: unknown): string[] {
  if (!record(value) || !exact(value, RECEIPT_KEYS)) return ['receipt:keys_invalid'];
  const receipt = value as unknown as LandscapeCheckReceipt; const issues: string[] = [];
  if (receipt.schema !== LANDSCAPE_PRODUCT_CHECK_RECEIPT_SCHEMA) issues.push('receipt:schema_invalid');
  if (!LANDSCAPE_CHECK_IDS.includes(receipt.checkId)) issues.push('receipt:check_id_invalid');
  if (!record(receipt.sourceRevision) || !ID.test(receipt.sourceRevision.id) || !SHA.test(receipt.sourceRevision.sha256)) issues.push('receipt:revision_invalid');
  for (const [name, hash] of [['model', receipt.modelSha256], ['coordinate', receipt.coordinateAuthoritySha256], ['result', receipt.resultSha256]] as const) if (!SHA.test(hash)) issues.push(`receipt:${name}_hash_invalid`);
  for (const [name, id] of [['validator', receipt.validatorId], ['validator_version', receipt.validatorVersion], ['reviewer', receipt.reviewerId]] as const) if (!ID.test(id)) issues.push(`receipt:${name}_invalid`);
  if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(receipt.status)) issues.push('receipt:status_invalid');
  if (typeof receipt.reason !== 'string' || receipt.reason.length > 256) issues.push('receipt:reason_invalid');
  if (typeof receipt.issuedAt !== 'string' || !ISO.test(receipt.issuedAt) || Number.isNaN(Date.parse(receipt.issuedAt))) issues.push('receipt:issued_at_invalid');
  if (receipt.status === 'PASS' && receipt.reviewerId === 'none') issues.push('receipt:pass_review_required');
  return unique(issues);
}

function validExternalEvidence(value: unknown): value is LandscapeExternalEvidence {
  if (!record(value) || !exact(value, EVIDENCE_KEYS)) return false;
  return ['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(String(value.status)) && record(value.sourceRevision)
    && ID.test(String(value.sourceRevision.id)) && SHA.test(String(value.sourceRevision.sha256)) && SHA.test(String(value.modelSha256))
    && SHA.test(String(value.coordinateAuthoritySha256)) && SHA.test(String(value.resultSha256)) && ID.test(String(value.validatorId))
    && ID.test(String(value.validatorVersion)) && ID.test(String(value.reviewerId)) && typeof value.reason === 'string' && value.reason.length <= 256;
}
type Derived = { status: LandscapeCheckStatus; reason: string; resultSha256: string; evidence?: LandscapeExternalEvidence };
function externalOrNotRun(options: LandscapeVerificationOptions, id: LandscapeCheckId): Derived {
  const candidate = options.externalEvidence?.[id];
  if (!candidate) return { status: 'NOT_RUN', reason: `${id}_authority_not_run`, resultSha256: sha256(`${id}:not-run`) };
  if (!validExternalEvidence(candidate)) return { status: 'HOLD', reason: `${id}_evidence_invalid`, resultSha256: sha256(`${id}:invalid-evidence`) };
  return { status: candidate.status, reason: candidate.reason, resultSha256: candidate.resultSha256, evidence: candidate };
}
function combineStructuralAndExternal(structural: Derived, external: Derived): Derived {
  if (structural.status === 'FAIL') return structural;
  if (external.evidence) return external;
  return { ...external, reason: structural.reason || external.reason, resultSha256: sha256({ structural: structural.resultSha256, external: external.resultSha256 }) };
}

function coordinateTerrain(contract: LandscapeProductContract): Derived {
  const binding = contract.authority.terrainBinding; const revision = contract.identity.revision;
  // The civil surface owns its own revision lineage. It must be immutable and
  // hash-bound, but its revision ID is not required to equal the landscape
  // project's revision ID.
  const bad = !sameRevision(binding.revision, revision) || !binding.approvedUse
    || contract.grading.outlets.some(outlet => outlet.civilOutletRef !== binding.drainageOutletId || outlet.approvalStatus !== 'APPROVED');
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? 'coordinate_terrain_binding_invalid' : '', resultSha256: sha256({ coordinate: contract.authority.coordinateFrame, terrain: binding }) };
}
function terrainGrading(contract: LandscapeProductContract): Derived {
  const spots = new Map(contract.grading.spotGrades.map(item => [item.id, item])); const outlets = new Map(contract.grading.outlets.map(item => [item.id, item])); const bad: string[] = [];
  for (const path of contract.grading.drainagePaths) {
    const values = path.pointRefs.map(id => spots.get(id)?.point); const outlet = outlets.get(path.outletRef);
    if (values.some(value => !value) || !outlet) { bad.push(`${path.id}:reference`); continue; }
    if (path.flowDirection === 'DOWNHILL' && values.some((value, index) => index > 0 && value!.z > values[index - 1]!.z + 1e-9)) bad.push(`${path.id}:uphill`);
    if (outlet && values.at(-1)!.z < outlet.elevationM - 1e-9) bad.push(`${path.id}:outlet_above_path`);
  }
  const boundary = contract.siteBoundary.polygon; const outside = contract.grading.spotGrades.find(item => !pointInPolygon(item.point, boundary));
  if (outside) bad.push(`${outside.id}:outside_site`);
  return { status: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `terrain_grading:${bad[0]}` : '', resultSha256: sha256({ spots: contract.grading.spotGrades, paths: contract.grading.drainagePaths, bad }) };
}
function hardscapeAccessibility(contract: LandscapeProductContract): Derived {
  const maximum = contract.authority.code.values.maxSlopePercent; const maxSlope = typeof maximum === 'number' ? maximum : Number.NaN;
  const bad = contract.hardscape.find(item => !(item.maxSlopePercent >= 0) || !finite(maxSlope) || item.maxSlopePercent > maxSlope + 1e-9);
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? `hardscape_slope_or_accessibility:${bad.id}` : '', resultSha256: sha256({ hardscape: contract.hardscape, code: contract.authority.code }) };
}
function soilVolume(contract: LandscapeProductContract): Derived {
  const bad = contract.soilZones.find(zone => Math.abs(zone.volumeM3 - polygonArea(zone.boundary) * zone.depthM) > Math.max(1e-6, zone.volumeM3 * 1e-6));
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? `soil_volume:${bad.id}` : '', resultSha256: sha256(contract.soilZones.map(zone => ({ id: zone.id, area: polygonArea(zone.boundary), depth: zone.depthM, volume: zone.volumeM3 }))) };
}
function plantingContainment(contract: LandscapeProductContract): Derived {
  const soils = new Map(contract.soilZones.map(zone => [zone.id, zone])); const badZone = contract.plantingZones.find(zone => { const soil = soils.get(zone.soilZoneRef); return !soil || polygonArea(zone.boundary) > polygonArea(soil.boundary) + 1e-6 || !zone.boundary.slice(0, -1).every(point => pointInPolygon(point, soil!.boundary)); });
  const plants = new Map(contract.plantingZones.map(zone => [zone.id, zone])); const badPlant = contract.plants.find(plant => !plants.has(plant.plantingZoneRef) || !pointInPolygon(plant.point, plants.get(plant.plantingZoneRef)!.boundary));
  return { status: badZone || badPlant ? 'FAIL' : 'PASS', reason: badZone ? `planting_zone_not_in_soil:${badZone.id}` : badPlant ? `plant_outside_zone:${badPlant.id}` : '', resultSha256: sha256({ zones: contract.plantingZones, plants: contract.plants }) };
}
function matureClearance(contract: LandscapeProductContract): Derived {
  const planting = new Map(contract.plantingZones.map(zone => [zone.id, zone])); const boundary = contract.siteBoundary.polygon;
  const badPlant = contract.plants.find(plant => {
    const zone = planting.get(plant.plantingZoneRef); if (!zone) return true;
    const canopy = plant.matureCanopyDiameterM / 2; const root = plant.matureRootDiameterM / 2;
    return !circleInsidePolygon(plant.point, canopy, boundary) || !circleInsidePolygon(plant.point, root, zone.boundary);
  });
  let collision = '';
  contract.plants.some((a, index) => contract.plants.slice(index + 1).some(b => {
    const separation = distance(a.point, b.point);
    if (separation < a.matureRootDiameterM / 2 + b.matureRootDiameterM / 2 - 1e-9) { collision = `mature_root_collision:${a.id}:${b.id}`; return true; }
    if (separation < a.matureCanopyDiameterM / 2 + b.matureCanopyDiameterM / 2 - 1e-9) { collision = `mature_canopy_collision:${a.id}:${b.id}`; return true; }
    return false;
  }));
  return { status: badPlant || collision ? 'FAIL' : 'PASS', reason: badPlant ? `mature_clearance:${badPlant.id}` : collision, resultSha256: sha256({ plants: contract.plants, collision }) };
}
function irrigationNetwork(contract: LandscapeProductContract): Derived {
  const irrigation = contract.irrigation; const valves = new Map(irrigation.valves.map(item => [item.id, item])); const zones = new Map(irrigation.zones.map(item => [item.id, item])); const plants = new Map(contract.plants.map(item => [item.id, item])); const bad: string[] = [];
  for (const valve of irrigation.valves) { const zone = zones.get(valve.zoneRef); if (!zone || valve.sourceRef !== irrigation.source.id || valve.ratedFlowLpm < zone.designFlowLpm) bad.push(`${valve.id}:source_zone_capacity`); }
  for (const zone of irrigation.zones) {
    const valve = valves.get(zone.valveRef);
    if (!valve || valve.zoneRef !== zone.id) bad.push(`${zone.id}:valve_reference`);
    if (zone.plantingZoneRefs.length === 0 || zone.plantingZoneRefs.some(id => !contract.plantingZones.some(item => item.id === id))) bad.push(`${zone.id}:planting_reference`);
    const emitterFlow = irrigation.emitters.filter(item => item.valveRef === zone.valveRef).reduce((sum, item) => sum + item.flowLpm, 0); if (emitterFlow > zone.designFlowLpm + 1e-9) bad.push(`${zone.id}:emitter_flow`);
  }
  for (const emitter of irrigation.emitters) {
    const valve = valves.get(emitter.valveRef); const zone = valve ? zones.get(valve.zoneRef) : undefined;
    if (!valve || !zone || emitter.plantRefs.length === 0 || emitter.plantRefs.some(id => {
      const plant = plants.get(id); return !plant || !zone.plantingZoneRefs.includes(plant.plantingZoneRef);
    })) bad.push(`${emitter.id}:emitter_reference`);
  }
  const pipeEdges = irrigation.pipes.map(item => [item.fromRef, item.toRef] as const); const adjacency = new Map<string, string[]>(); pipeEdges.forEach(([from, to]) => adjacency.set(from, [...(adjacency.get(from) ?? []), to]));
  const visiting = new Set<string>(), reachable = new Set<string>(); let cycle = false; const visit = (id: string) => { if (visiting.has(id)) { cycle = true; return; } if (reachable.has(id)) return; visiting.add(id); reachable.add(id); (adjacency.get(id) ?? []).forEach(visit); visiting.delete(id); }; visit(irrigation.source.id);
  if (cycle) bad.push('pipe_cycle');
  for (const valve of irrigation.valves) if (!reachable.has(valve.id)) bad.push(`${valve.id}:pipe_unreachable`);
  for (const pipe of irrigation.pipes) {
    if (!reachable.has(pipe.fromRef) || !reachable.has(pipe.toRef)) bad.push(`${pipe.id}:pipe_disconnected`);
    const valve = valves.get(pipe.toRef); const zone = valve ? zones.get(valve.zoneRef) : undefined;
    if (zone && pipe.designFlowLpm + 1e-9 < zone.designFlowLpm) bad.push(`${pipe.id}:pipe_flow_capacity`);
  }
  const edges = [...pipeEdges, ...irrigation.zones.map(item => [item.valveRef, item.id] as const)];
  return { status: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `irrigation_network:${bad[0]}` : '', resultSha256: sha256({ edges, bad }) };
}
function irrigationHydraulics(contract: LandscapeProductContract): Derived {
  const source = contract.irrigation.source; const total = contract.irrigation.zones.reduce((sum, zone) => sum + zone.designFlowLpm, 0); const bad = total > source.maxFlowLpm + 1e-9 || contract.irrigation.valves.some(valve => valve.ratedFlowLpm > source.maxFlowLpm + 1e-9);
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? 'irrigation_hydraulic_capacity' : '', resultSha256: sha256({ total, source, valves: contract.irrigation.valves }) };
}
function waterBudget(contract: LandscapeProductContract): Derived {
  const budget = contract.irrigation.waterBudget; const limit = contract.authority.hydraulic.values.annualWaterLimitM3; const total = contract.irrigation.zones.reduce((sum, zone) => sum + zone.waterBudgetM3PerYear, 0); const bad = budget.annualDemandM3 < total - 1e-9 || (typeof limit === 'number' && budget.annualDemandM3 > limit + 1e-9) || budget.sourceCapacityLpm > contract.irrigation.source.maxFlowLpm + 1e-9;
  return { status: bad ? 'FAIL' : 'PASS', reason: bad ? 'water_budget_exceeded_or_underdeclared' : '', resultSha256: sha256({ budget, total, limit }) };
}
function maintenanceAccess(contract: LandscapeProductContract): Derived {
  const objectIds = new Set<string>(contract.maintenance.zones.flatMap(zone => zone.objectRefs)); const known = new Set<string>([...contract.plantingZones, ...contract.soilZones, ...contract.plants, ...contract.hardscape, ...contract.irrigation.zones].map(baseId).filter((id): id is string => !!id)); const dangling = [...objectIds].find(id => !known.has(id)); const required = [...contract.plantingZones, ...contract.irrigation.zones].map(item => item.id); const uncovered = required.find(id => !objectIds.has(id)); const noTask = contract.maintenance.zones.find(zone => !contract.maintenance.tasks.some(task => task.zoneRef === zone.id) || !(zone.accessWidthM > 0));
  return { status: dangling || uncovered || noTask ? 'FAIL' : 'PASS', reason: dangling ? `maintenance_object_unknown:${dangling}` : uncovered ? `maintenance_object_uncovered:${uncovered}` : noTask ? `maintenance_access_or_task:${noTask.id}` : '', resultSha256: sha256({ zones: contract.maintenance.zones, tasks: contract.maintenance.tasks, dangling, uncovered }) };
}

function makeReceipt(checkId: LandscapeCheckId, contract: LandscapeProductContract, options: LandscapeVerificationOptions, derived: Derived, coordinate: string): LandscapeCheckReceipt {
  const evidence = derived.evidence; const base = { schema: LANDSCAPE_PRODUCT_CHECK_RECEIPT_SCHEMA, checkId, status: evidence?.status ?? derived.status, sourceRevision: evidence?.sourceRevision ?? contract.identity.revision, modelSha256: evidence?.modelSha256 ?? contract.identity.contentSha256, coordinateAuthoritySha256: evidence?.coordinateAuthoritySha256 ?? coordinate, resultSha256: evidence?.resultSha256 ?? derived.resultSha256, validatorId: evidence?.validatorId ?? 'precision-cad.landscape', validatorVersion: evidence?.validatorVersion ?? 'v1', reviewerId: evidence?.reviewerId ?? 'precision-cad.validator', reason: evidence?.reason ?? derived.reason, issuedAt: options.now ?? '2026-08-24T00:00:00.000Z' };
  const stale = !sameRevision(base.sourceRevision, contract.identity.revision) || base.modelSha256 !== contract.identity.contentSha256 || base.coordinateAuthoritySha256 !== coordinate || (base.status === 'PASS' && base.reviewerId === 'none');
  return { ...base, status: stale ? 'STALE' : base.status, reason: stale ? 'receipt_revision_model_or_coordinate_mismatch' : base.reason };
}
function axisEvidence(axis: LandscapeAxisEvidence['axis'], receipts: LandscapeCheckReceipt[], revision: LandscapeRevision): LandscapeAxisEvidence {
  const status: LandscapeCheckStatus = receipts.some(item => item.status === 'FAIL') ? 'FAIL' : receipts.some(item => item.status === 'STALE') ? 'STALE' : receipts.some(item => item.status === 'HOLD') ? 'HOLD' : receipts.some(item => item.status === 'NOT_RUN') ? 'NOT_RUN' : 'PASS';
  return { axis, status, sourceRevision: revision.id, caseCount: 1, accuracyBasisPoints: status === 'PASS' ? 10_000 : 0, coverageBasisPoints: status === 'PASS' ? 10_000 : 0, falseVerificationCount: 0, artifactSha256: sha256(receipts.map(item => item.resultSha256)) };
}

/** Verifies one immutable landscape revision. A single synthetic case never promotes the product receipt. */
export function verifyLandscapeProduct(contractInput: unknown, options: LandscapeVerificationOptions = {}): LandscapeVerificationResult {
  const contractIssues = validateLandscapeProductContract(contractInput);
  if (contractIssues.length) return { status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false, sourceRevision: null, modelSha256: null, coordinateAuthoritySha256: null, receipts: [], axisEvidence: [], blockers: contractIssues.map(issue => `contract:${issue}`) };
  const contract = contractInput as LandscapeProductContract; const coordinate = hashLandscapeCoordinateAuthority(contract);
  const siteModel = options.deliverableBinding === undefined
    ? { status: 'NOT_RUN' as const, reason: 'site_model_binding_not_run', resultSha256: sha256('site-model:binding-not-run') }
    : (() => { const validation = validateLandscapeSiteDeliverableBinding(options.deliverableBinding, { projectId: contract.identity.projectId, modelRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256 }); return validation.valid ? externalOrNotRun(options, 'site-model-roundtrip') : { status: 'HOLD' as const, reason: `site_model_binding:${validation.errors[0] ?? 'invalid'}`, resultSha256: sha256(validation.errors) }; })();
  const derived: Record<LandscapeCheckId, Derived> = {
    'coordinate-terrain': coordinateTerrain(contract), 'terrain-grading': terrainGrading(contract), 'hardscape-accessibility': hardscapeAccessibility(contract), 'soil-volume': soilVolume(contract),
    'planting-containment': plantingContainment(contract), 'mature-clearance': matureClearance(contract), 'irrigation-network': irrigationNetwork(contract), 'irrigation-hydraulics': combineStructuralAndExternal(irrigationHydraulics(contract), externalOrNotRun(options, 'irrigation-hydraulics')),
    'water-budget': waterBudget(contract), 'maintenance-access': maintenanceAccess(contract), 'quantity-consistency': externalOrNotRun(options, 'quantity-consistency'), 'drawing-consistency': externalOrNotRun(options, 'drawing-consistency'), 'site-model-roundtrip': siteModel,
    'catalog-authority': externalOrNotRun(options, 'catalog-authority'), 'code-authority': externalOrNotRun(options, 'code-authority'), 'professional-review': externalOrNotRun(options, 'professional-review'),
  };
  const receipts = LANDSCAPE_CHECK_IDS.map(id => makeReceipt(id, contract, options, derived[id], coordinate));
  const blockers = unique(receipts.flatMap(receipt => { const issues = validateLandscapeCheckReceipt(receipt); if (issues.length) return issues.map(issue => `receipt_invalid:${receipt.checkId}:${issue}`); return receipt.status === 'PASS' ? [] : [`check_${receipt.status.toLowerCase()}:${receipt.checkId}${receipt.reason ? `:${receipt.reason}` : ''}`]; }));
  const by = (ids: LandscapeCheckId[]) => receipts.filter(receipt => ids.includes(receipt.checkId));
  const axes: LandscapeAxisEvidence[] = [
    axisEvidence('terrain-grading', by(['coordinate-terrain', 'terrain-grading', 'hardscape-accessibility']), contract.identity.revision),
    axisEvidence('planting', by(['soil-volume', 'planting-containment']), contract.identity.revision),
    axisEvidence('mature-clearance', by(['mature-clearance']), contract.identity.revision),
    axisEvidence('irrigation-hydraulics', by(['irrigation-network', 'irrigation-hydraulics']), contract.identity.revision),
    axisEvidence('water-budget', by(['water-budget']), contract.identity.revision),
    axisEvidence('quantity-consistency', by(['soil-volume', 'quantity-consistency']), contract.identity.revision),
    axisEvidence('drawing-consistency', by(['drawing-consistency', 'site-model-roundtrip']), contract.identity.revision),
  ];
  const currentRevisionVerified = blockers.length === 0 && axes.every(axis => axis.status === 'PASS');
  return { status: currentRevisionVerified ? 'PASS' : blockers.some(blocker => blocker.startsWith('check_fail')) ? 'FAIL' : 'HOLD', currentRevisionVerified, productReceiptPromotionReady: false, sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256, coordinateAuthoritySha256: coordinate, receipts, axisEvidence: axes, blockers };
}
