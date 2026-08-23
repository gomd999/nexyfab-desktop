import { createHash } from 'node:crypto';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';

export const CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_SCHEMA = 'nexyfab.civil-gravity-drainage-hydraulic.v1' as const;
export const CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_RECEIPT_SCHEMA = 'nexyfab.civil-gravity-drainage-hydraulic-probe.v1' as const;
export const CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_CAPABILITY_ID = 'civil.gravity-drainage.hydraulic.internal' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && value.trim() === value;
const exact = (value: unknown, keys: readonly string[]) => record(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const sorted = <T extends { id: string }>(values: readonly T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
const sortedIds = (values: readonly { id: string }[]) => values.every((item, index) => index === 0 || values[index - 1]!.id.localeCompare(item.id) < 0);
const EPSILON = 1e-8;

export type CivilHydraulicArtifact = { id: string; kind: 'tin' | 'alignment' | 'network'; bytes: Uint8Array; artifactSha256?: string };
export type CivilHydraulicRainfall = { intensityMmPerHour: number; durationMin: number; sourceId: string; sourceSha256: string };
export type CivilHydraulicCatchment = { id: string; areaM2: number; runoffCoefficient: number; outletNodeId: string; sourceId: string; sourceSha256: string };
export type CivilHydraulicNode = { id: string; kind: 'inlet' | 'manhole' | 'outfall'; positionM: [number, number, number]; invertElevationM: number; rimElevationM: number };
export type CivilHydraulicPipe = { id: string; fromNodeId: string; toNodeId: string; invertStartM: number; invertEndM: number; diameterMm: number; lengthM: number; roughnessN: number };
export type CivilHydraulicOutfall = { id: string; nodeId: string; tailwaterElevationM: number };
export type CivilGravityDrainageHydraulicInput = {
  workspaceRevisionId: string;
  expectedWorkspaceRevisionId: string;
  workspaceRevisionValue: unknown;
  expectedWorkspaceContentHash: string;
  expectedTinArtifactSha256: string;
  expectedAlignmentArtifactSha256: string;
  expectedNetworkArtifactSha256: string;
  tinArtifact: CivilHydraulicArtifact;
  alignmentArtifact: CivilHydraulicArtifact;
  networkArtifact: CivilHydraulicArtifact;
  rainfall: CivilHydraulicRainfall;
  catchments: CivilHydraulicCatchment[];
  nodes: CivilHydraulicNode[];
  pipes: CivilHydraulicPipe[];
  outfalls: CivilHydraulicOutfall[];
  minimumFreeboardM: number;
  minimumCoverM: number;
  artifactName?: string;
};
export type CivilGravityDrainageHydraulicPayload = {
  schema: typeof CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_SCHEMA;
  binding: { workspaceRevisionId: string; workspaceContentHash: string; tinArtifactSha256: string; alignmentArtifactSha256: string; networkArtifactSha256: string };
  units: { length: 'm'; area: 'm2'; flow: 'm3/s'; rainfall: 'mm/hr'; roughness: 's/m^(1/3)' };
  provenance: { rainfallSourceId: string; rainfallSourceSha256: string; catchmentSourceIds: string[]; catchmentSourceSha256: string[] };
  criteria: { minimumFreeboardM: number; minimumCoverM: number; method: 'rational_peak_manning_full_flow_normal_hgl_v1' };
  rainfall: CivilHydraulicRainfall;
  catchments: CivilHydraulicCatchment[];
  nodes: CivilHydraulicNode[];
  pipes: CivilHydraulicPipe[];
  outfalls: CivilHydraulicOutfall[];
  pipeChecks: Array<{ id: string; peakFlowM3s: number; capacityM3s: number; capacityRatio: number; slopePercent: number; hglUpstreamM: number; hglDownstreamM: number; freeboardM: number; coverStartM: number; coverEndM: number; status: 'passed' }>;
  counts: { catchments: number; nodes: number; pipes: number; outfalls: number };
  dynamicHydraulics: 'NOT_RUN';
  surgeAnalysis: 'NOT_RUN';
  swmmRoundtrip: 'HOLD';
  civil3dRoundtrip: 'HOLD';
  surveyValidation: 'NOT_RUN';
  authorityReview: 'HOLD';
  fieldTest: 'NOT_RUN';
  releaseReady: false;
};
export type CivilGravityDrainageHydraulicArtifact = { payload: CivilGravityDrainageHydraulicPayload; contentHash: string; bytes: Uint8Array; artifactSha256: string; artifactName: string; artifactMime: 'application/json' };
export type CivilGravityDrainageHydraulicParseResult = { payload: CivilGravityDrainageHydraulicPayload; contentHash: string; artifactSha256: string };
export type CivilGravityDrainageHydraulicVerification =
  | { status: 'passed'; verifierId: 'civil-gravity-drainage-hydraulic-structural.v1'; issues: [] }
  | { status: 'failed'; verifierId: 'civil-gravity-drainage-hydraulic-structural.v1'; issues: string[] };
export type CivilGravityDrainageHydraulicReceipt = {
  schema: typeof CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_RECEIPT_SCHEMA;
  capabilityId: typeof CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_CAPABILITY_ID;
  format: 'json';
  workspaceRevisionId: string;
  workspaceContentHash: string;
  tinArtifactSha256: string;
  alignmentArtifactSha256: string;
  networkArtifactSha256: string;
  artifactSha256: string;
  artifactBytes: number;
  parserResult: 'verified';
  parserOutputSha256: string;
  verifierEvidenceSha256: string;
  stableIds: { catchments: string[]; nodes: string[]; pipes: string[]; outfalls: string[] };
  dynamicHydraulics: 'NOT_RUN';
  surgeAnalysis: 'NOT_RUN';
  swmmRoundtrip: 'HOLD';
  civil3dRoundtrip: 'HOLD';
  surveyValidation: 'NOT_RUN';
  authorityReview: 'HOLD';
  fieldTest: 'NOT_RUN';
  releaseReady: false;
};

function artifactHashes(input: Pick<CivilGravityDrainageHydraulicInput, 'tinArtifact' | 'alignmentArtifact' | 'networkArtifact'>): Array<{ id: string; kind: CivilHydraulicArtifact['kind']; sha256: string; bytes: number }> {
  const artifacts = [{ artifact: input.tinArtifact, expectedKind: 'tin' as const }, { artifact: input.alignmentArtifact, expectedKind: 'alignment' as const }, { artifact: input.networkArtifact, expectedKind: 'network' as const }]; const ids = new Set<string>(), kinds = new Set<CivilHydraulicArtifact['kind']>();
  return artifacts.map(({ artifact, expectedKind }) => { if (!identifier(artifact.id) || ids.has(artifact.id) || artifact.kind !== expectedKind || kinds.has(artifact.kind) || !(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0 || (artifact.artifactSha256 !== undefined && artifact.artifactSha256 !== hash(artifact.bytes))) throw new Error('CIVIL_GRAVITY_DRAINAGE_ARTIFACT_HASH_MISMATCH'); ids.add(artifact.id); kinds.add(artifact.kind); return { id: artifact.id, kind: artifact.kind, sha256: hash(artifact.bytes), bytes: artifact.bytes.byteLength }; }).sort((a, b) => a.id.localeCompare(b.id));
}
function artifactHash(artifacts: readonly { kind: CivilHydraulicArtifact['kind']; sha256: string }[], kind: CivilHydraulicArtifact['kind']): string { const result = artifacts.find(item => item.kind === kind); if (!result) throw new Error('CIVIL_GRAVITY_DRAINAGE_ARTIFACT_KIND_MISSING'); return result.sha256; }
function validateDag(nodes: readonly CivilHydraulicNode[], pipes: readonly CivilHydraulicPipe[]): string[] {
  const issues: string[] = []; const ids = new Set(nodes.map(node => node.id)); const state = new Map<string, number>(); const outgoing = new Map<string, string[]>();
  for (const pipe of pipes) { if (!ids.has(pipe.fromNodeId) || !ids.has(pipe.toNodeId)) issues.push(`dangling_pipe:${pipe.id}`); outgoing.set(pipe.fromNodeId, [...(outgoing.get(pipe.fromNodeId) ?? []), pipe.toNodeId]); }
  for (const [nodeId, targets] of outgoing) if (targets.length > 1) issues.push(`unsupported_flow_split:${nodeId}`);
  const visit = (id: string): boolean => { const current = state.get(id) ?? 0; if (current === 1) return true; if (current === 2) return false; state.set(id, 1); const cycle = (outgoing.get(id) ?? []).some(next => visit(next)); state.set(id, 2); return cycle; };
  for (const node of nodes) if (visit(node.id)) issues.push('drainage_network_cycle');
  return issues;
}
function expectedPipeChecks(payload: CivilGravityDrainageHydraulicPayload): CivilGravityDrainageHydraulicPayload['pipeChecks'] {
  const nodeById = new Map(payload.nodes.map(node => [node.id, node]));
  const pipesByFrom = new Map<string, CivilHydraulicPipe[]>();
  for (const pipe of payload.pipes) pipesByFrom.set(pipe.fromNodeId, [...(pipesByFrom.get(pipe.fromNodeId) ?? []), pipe]);
  const flowAtNode = new Map<string, number>();
  for (const catchment of payload.catchments) flowAtNode.set(catchment.outletNodeId, (flowAtNode.get(catchment.outletNodeId) ?? 0) + catchment.runoffCoefficient * payload.rainfall.intensityMmPerHour * catchment.areaM2 / 3_600_000);
  const incoming = new Map<string, number>();
  for (const pipe of payload.pipes) incoming.set(pipe.toNodeId, (incoming.get(pipe.toNodeId) ?? 0) + 1);
  const queue = payload.nodes.filter(node => (incoming.get(node.id) ?? 0) === 0).map(node => node.id);
  const order: string[] = [];
  while (queue.length) { const nodeId = queue.shift()!; order.push(nodeId); for (const pipe of pipesByFrom.get(nodeId) ?? []) { const remaining = (incoming.get(pipe.toNodeId) ?? 0) - 1; incoming.set(pipe.toNodeId, remaining); if (remaining === 0) queue.push(pipe.toNodeId); } }
  const checks: CivilGravityDrainageHydraulicPayload['pipeChecks'] = [];
  for (const nodeId of order) for (const pipe of pipesByFrom.get(nodeId) ?? []) {
    const from = nodeById.get(pipe.fromNodeId)!; const to = nodeById.get(pipe.toNodeId)!;
    const slope = (pipe.invertStartM - pipe.invertEndM) / pipe.lengthM; const diameterM = pipe.diameterMm / 1000; const area = Math.PI * diameterM * diameterM / 4; const hydraulicRadius = diameterM / 4;
    const capacity = (1 / pipe.roughnessN) * area * Math.pow(hydraulicRadius, 2 / 3) * Math.sqrt(slope); const demand = flowAtNode.get(pipe.fromNodeId) ?? 0;
    const downstreamBase = Math.max(to.invertElevationM, payload.outfalls.find(outfall => outfall.nodeId === to.id)?.tailwaterElevationM ?? to.invertElevationM); const hglDownstream = downstreamBase + diameterM; const hglUpstream = hglDownstream + pipe.lengthM * slope;
    const coverStart = from.rimElevationM - (pipe.invertStartM + diameterM); const coverEnd = to.rimElevationM - (pipe.invertEndM + diameterM);
    checks.push({ id: pipe.id, peakFlowM3s: demand, capacityM3s: capacity, capacityRatio: demand / capacity, slopePercent: slope * 100, hglUpstreamM: hglUpstream, hglDownstreamM: hglDownstream, freeboardM: from.rimElevationM - hglUpstream, coverStartM: coverStart, coverEndM: coverEnd, status: 'passed' });
    flowAtNode.set(pipe.toNodeId, (flowAtNode.get(pipe.toNodeId) ?? 0) + demand);
  }
  return sorted(checks);
}
function deepHydraulicIssues(payload: CivilGravityDrainageHydraulicPayload): string[] {
  const issues: string[] = [];
  try {
    const expected = expectedPipeChecks(payload);
    if (canonicalDesignJson(expected) !== canonicalDesignJson(payload.pipeChecks)) issues.push('hydraulic_pipe_check_computation_mismatch');
    for (const check of payload.pipeChecks) if (check.capacityRatio > 1 + EPSILON || check.freeboardM < payload.criteria.minimumFreeboardM - EPSILON || check.coverStartM < payload.criteria.minimumCoverM - EPSILON || check.coverEndM < payload.criteria.minimumCoverM - EPSILON) issues.push(`hydraulic_criteria_failed:${check.id}`);
  } catch { issues.push('hydraulic_pipe_check_computation_mismatch'); }
  return [...new Set(issues)];
}
function validatePayload(value: unknown): string[] {
  const issues: string[] = []; if (!record(value) || value.schema !== CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_SCHEMA) return ['hydraulic_schema_invalid']; const payload = value as Partial<CivilGravityDrainageHydraulicPayload>;
  if (!exact(payload, ['schema', 'binding', 'units', 'provenance', 'criteria', 'rainfall', 'catchments', 'nodes', 'pipes', 'outfalls', 'pipeChecks', 'counts', 'dynamicHydraulics', 'surgeAnalysis', 'swmmRoundtrip', 'civil3dRoundtrip', 'surveyValidation', 'authorityReview', 'fieldTest', 'releaseReady'])) issues.push('hydraulic_unknown_key');
  if (!exact(payload.binding, ['workspaceRevisionId', 'workspaceContentHash', 'tinArtifactSha256', 'alignmentArtifactSha256', 'networkArtifactSha256']) || !identifier(payload.binding?.workspaceRevisionId) || !SHA256.test(String(payload.binding?.workspaceContentHash)) || !SHA256.test(String(payload.binding?.tinArtifactSha256)) || !SHA256.test(String(payload.binding?.alignmentArtifactSha256)) || !SHA256.test(String(payload.binding?.networkArtifactSha256))) issues.push('hydraulic_binding_invalid');
  if (!exact(payload.units, ['length', 'area', 'flow', 'rainfall', 'roughness']) || payload.units?.length !== 'm' || payload.units?.area !== 'm2' || payload.units?.flow !== 'm3/s' || payload.units?.rainfall !== 'mm/hr' || payload.units?.roughness !== 's/m^(1/3)') issues.push('hydraulic_units_invalid');
  if (!exact(payload.criteria, ['minimumFreeboardM', 'minimumCoverM', 'method']) || !finite(payload.criteria?.minimumFreeboardM) || Number(payload.criteria?.minimumFreeboardM) < 0 || !finite(payload.criteria?.minimumCoverM) || Number(payload.criteria?.minimumCoverM) < 0 || payload.criteria?.method !== 'rational_peak_manning_full_flow_normal_hgl_v1') issues.push('hydraulic_criteria_invalid');
  if (payload.dynamicHydraulics !== 'NOT_RUN' || payload.surgeAnalysis !== 'NOT_RUN' || payload.swmmRoundtrip !== 'HOLD' || payload.civil3dRoundtrip !== 'HOLD' || payload.surveyValidation !== 'NOT_RUN' || payload.authorityReview !== 'HOLD' || payload.fieldTest !== 'NOT_RUN' || payload.releaseReady !== false) issues.push('hydraulic_release_truth_invalid');
  if (!exact(payload.rainfall, ['intensityMmPerHour', 'durationMin', 'sourceId', 'sourceSha256']) || !finite(payload.rainfall?.intensityMmPerHour) || Number(payload.rainfall?.intensityMmPerHour) <= 0 || !finite(payload.rainfall?.durationMin) || Number(payload.rainfall?.durationMin) <= 0 || !identifier(payload.rainfall?.sourceId) || !SHA256.test(String(payload.rainfall?.sourceSha256))) issues.push('hydraulic_rainfall_invalid');
  if (!Array.isArray(payload.catchments) || !Array.isArray(payload.nodes) || !Array.isArray(payload.pipes) || !Array.isArray(payload.outfalls) || !Array.isArray(payload.pipeChecks)) return [...new Set([...issues, 'hydraulic_collections_invalid'])];
  if (!sortedIds(payload.catchments) || !sortedIds(payload.nodes) || !sortedIds(payload.pipes) || !sortedIds(payload.outfalls) || !sortedIds(payload.pipeChecks)) issues.push('hydraulic_collections_not_sorted');
  const allIds: string[] = []; const nodeIds = new Set<string>(); const pipeIds = new Set<string>();
  for (const node of payload.nodes) { if (!exact(node, ['id', 'kind', 'positionM', 'invertElevationM', 'rimElevationM']) || !identifier(node.id) || nodeIds.has(node.id) || !['inlet', 'manhole', 'outfall'].includes(String(node.kind)) || !Array.isArray(node.positionM) || node.positionM.length !== 3 || !node.positionM.every(finite) || !finite(node.invertElevationM) || !finite(node.rimElevationM) || node.rimElevationM <= node.invertElevationM) issues.push('hydraulic_node_invalid'); else { nodeIds.add(node.id); allIds.push(node.id); } }
  for (const catchment of payload.catchments) { if (!exact(catchment, ['id', 'areaM2', 'runoffCoefficient', 'outletNodeId', 'sourceId', 'sourceSha256']) || !identifier(catchment.id) || !finite(catchment.areaM2) || catchment.areaM2 <= 0 || !finite(catchment.runoffCoefficient) || catchment.runoffCoefficient <= 0 || catchment.runoffCoefficient > 1 || !identifier(catchment.outletNodeId) || !nodeIds.has(catchment.outletNodeId) || payload.nodes.find(node => node.id === catchment.outletNodeId)?.kind === 'outfall' || !identifier(catchment.sourceId) || !SHA256.test(String(catchment.sourceSha256))) issues.push('hydraulic_catchment_invalid'); else allIds.push(catchment.id); }
  const nodeById = new Map(payload.nodes.map(node => [node.id, node]));
  for (const pipe of payload.pipes) { const from = nodeById.get(pipe.fromNodeId), to = nodeById.get(pipe.toNodeId); if (!exact(pipe, ['id', 'fromNodeId', 'toNodeId', 'invertStartM', 'invertEndM', 'diameterMm', 'lengthM', 'roughnessN']) || !identifier(pipe.id) || pipeIds.has(pipe.id) || !identifier(pipe.fromNodeId) || !identifier(pipe.toNodeId) || pipe.fromNodeId === pipe.toNodeId || !from || !to || !finite(pipe.invertStartM) || !finite(pipe.invertEndM) || Math.abs(pipe.invertStartM - from.invertElevationM) > EPSILON || Math.abs(pipe.invertEndM - to.invertElevationM) > EPSILON || !finite(pipe.diameterMm) || pipe.diameterMm <= 0 || !finite(pipe.lengthM) || pipe.lengthM <= 0 || !finite(pipe.roughnessN) || pipe.roughnessN <= 0 || pipe.invertStartM <= pipe.invertEndM) issues.push('hydraulic_pipe_invalid'); else { pipeIds.add(pipe.id); allIds.push(pipe.id); } }
  const outfallIds = new Set<string>(), outfallNodeIds = new Set<string>(); for (const outfall of payload.outfalls) { const node = nodeById.get(outfall.nodeId); if (!exact(outfall, ['id', 'nodeId', 'tailwaterElevationM']) || !identifier(outfall.id) || outfallIds.has(outfall.id) || !identifier(outfall.nodeId) || !node || node.kind !== 'outfall' || outfallNodeIds.has(outfall.nodeId) || !finite(outfall.tailwaterElevationM)) issues.push('hydraulic_outfall_invalid'); else { outfallIds.add(outfall.id); outfallNodeIds.add(outfall.nodeId); allIds.push(outfall.id); } }
  for (const node of payload.nodes) { const outgoing = payload.pipes.filter(pipe => pipe.fromNodeId === node.id).length; if ((node.kind === 'outfall' && (outgoing !== 0 || !outfallNodeIds.has(node.id))) || (node.kind !== 'outfall' && outgoing !== 1)) issues.push(`hydraulic_node_flow_path_invalid:${node.id}`); }
  for (const check of payload.pipeChecks) if (!exact(check, ['id', 'peakFlowM3s', 'capacityM3s', 'capacityRatio', 'slopePercent', 'hglUpstreamM', 'hglDownstreamM', 'freeboardM', 'coverStartM', 'coverEndM', 'status']) || !pipeIds.has(check.id) || !finite(check.peakFlowM3s) || check.peakFlowM3s < 0 || !finite(check.capacityM3s) || check.capacityM3s <= 0 || !finite(check.capacityRatio) || check.capacityRatio > 1 + EPSILON || !finite(check.slopePercent) || check.slopePercent <= 0 || !finite(check.hglUpstreamM) || !finite(check.hglDownstreamM) || !finite(check.freeboardM) || !finite(check.coverStartM) || !finite(check.coverEndM) || check.status !== 'passed') issues.push('hydraulic_pipe_check_invalid');
  if (new Set(allIds).size !== allIds.length || payload.pipeChecks.length !== payload.pipes.length || new Set(payload.pipeChecks.map(item => item.id)).size !== payload.pipeChecks.length || payload.pipeChecks.some(item => !pipeIds.has(item.id))) issues.push('hydraulic_id_or_check_coverage_invalid');
  issues.push(...validateDag(payload.nodes, payload.pipes));
  if (!exact(payload.provenance, ['rainfallSourceId', 'rainfallSourceSha256', 'catchmentSourceIds', 'catchmentSourceSha256']) || payload.provenance?.rainfallSourceId !== payload.rainfall?.sourceId || payload.provenance?.rainfallSourceSha256 !== payload.rainfall?.sourceSha256 || !Array.isArray(payload.provenance?.catchmentSourceIds) || !Array.isArray(payload.provenance?.catchmentSourceSha256) || payload.provenance.catchmentSourceIds.length !== payload.catchments.length || payload.provenance.catchmentSourceSha256.length !== payload.catchments.length || canonicalDesignJson(payload.provenance.catchmentSourceIds) !== canonicalDesignJson(sorted(payload.catchments).map(item => item.sourceId)) || canonicalDesignJson(payload.provenance.catchmentSourceSha256) !== canonicalDesignJson(sorted(payload.catchments).map(item => item.sourceSha256))) issues.push('hydraulic_provenance_invalid');
  const counts = payload.counts; if (!exact(counts, ['catchments', 'nodes', 'pipes', 'outfalls']) || counts?.catchments !== payload.catchments.length || counts?.nodes !== payload.nodes.length || counts?.pipes !== payload.pipes.length || counts?.outfalls !== payload.outfalls.length) issues.push('hydraulic_counts_mismatch');
  return [...new Set(issues)];
}

export function civilGravityDrainageHydraulicIssues(value: unknown): string[] { const structural = validatePayload(value); return structural.length || !record(value) ? structural : [...new Set([...structural, ...deepHydraulicIssues(value as CivilGravityDrainageHydraulicPayload)])]; }

export function exportCivilGravityDrainageHydraulicArtifact(input: CivilGravityDrainageHydraulicInput): CivilGravityDrainageHydraulicArtifact {
  if (!identifier(input.workspaceRevisionId) || input.workspaceRevisionId !== input.expectedWorkspaceRevisionId) throw new Error('CIVIL_GRAVITY_DRAINAGE_STALE_REVISION'); const workspaceContentHash = designRevisionSha256(input.workspaceRevisionValue); if (!SHA256.test(input.expectedWorkspaceContentHash) || workspaceContentHash !== input.expectedWorkspaceContentHash) throw new Error('CIVIL_GRAVITY_DRAINAGE_STALE_REVISION_HASH');
  const artifacts = artifactHashes(input); const tinHash = artifactHash(artifacts, 'tin'); const alignmentHash = artifactHash(artifacts, 'alignment'); const networkHash = artifactHash(artifacts, 'network');
  if (!SHA256.test(input.expectedTinArtifactSha256) || !SHA256.test(input.expectedAlignmentArtifactSha256) || !SHA256.test(input.expectedNetworkArtifactSha256) || tinHash !== input.expectedTinArtifactSha256 || alignmentHash !== input.expectedAlignmentArtifactSha256 || networkHash !== input.expectedNetworkArtifactSha256) throw new Error('CIVIL_GRAVITY_DRAINAGE_STALE_ARTIFACT_HASH');
  if (input.rainfall.sourceSha256 !== input.expectedWorkspaceContentHash && !SHA256.test(input.rainfall.sourceSha256)) throw new Error('CIVIL_GRAVITY_DRAINAGE_RAINFALL_PROVENANCE_INVALID');
  if (!finite(input.minimumFreeboardM) || input.minimumFreeboardM < 0 || !finite(input.minimumCoverM) || input.minimumCoverM < 0 || input.nodes.length < 2 || input.pipes.length === 0 || input.outfalls.length === 0 || input.catchments.length === 0) throw new Error('CIVIL_GRAVITY_DRAINAGE_INPUT_INVALID');
  if (validateDag(input.nodes, input.pipes).length) throw new Error('CIVIL_GRAVITY_DRAINAGE_NETWORK_INVALID');
  const nodeById = new Map(input.nodes.map(node => [node.id, node])); const catchmentsByNode = new Map<string, CivilHydraulicCatchment[]>();
  for (const catchment of input.catchments) { if (!SHA256.test(catchment.sourceSha256) || !nodeById.has(catchment.outletNodeId) || nodeById.get(catchment.outletNodeId)!.kind === 'outfall') throw new Error(`CIVIL_GRAVITY_DRAINAGE_CATCHMENT_INVALID:${catchment.id}`); catchmentsByNode.set(catchment.outletNodeId, [...(catchmentsByNode.get(catchment.outletNodeId) ?? []), catchment]); }
  for (const outfall of input.outfalls) if (!nodeById.has(outfall.nodeId) || nodeById.get(outfall.nodeId)!.kind !== 'outfall') throw new Error(`CIVIL_GRAVITY_DRAINAGE_OUTFALL_INVALID:${outfall.id}`);
  const flowAtNode = new Map<string, number>(); const pipesByFrom = new Map<string, CivilHydraulicPipe[]>(); for (const pipe of input.pipes) pipesByFrom.set(pipe.fromNodeId, [...(pipesByFrom.get(pipe.fromNodeId) ?? []), pipe]); for (const catchment of input.catchments) if (!(pipesByFrom.get(catchment.outletNodeId)?.length)) throw new Error(`CIVIL_GRAVITY_DRAINAGE_CATCHMENT_NO_CHECKED_PIPE:${catchment.id}`);
  for (const catchment of input.catchments) flowAtNode.set(catchment.outletNodeId, (flowAtNode.get(catchment.outletNodeId) ?? 0) + catchment.runoffCoefficient * input.rainfall.intensityMmPerHour * catchment.areaM2 / 3_600_000);
  const incoming = new Map<string, number>(); for (const pipe of input.pipes) incoming.set(pipe.toNodeId, (incoming.get(pipe.toNodeId) ?? 0) + 1); const queue = input.nodes.filter(node => (incoming.get(node.id) ?? 0) === 0).map(node => node.id); const order: string[] = []; while (queue.length) { const nodeId = queue.shift()!; order.push(nodeId); for (const pipe of pipesByFrom.get(nodeId) ?? []) { const remaining = (incoming.get(pipe.toNodeId) ?? 0) - 1; incoming.set(pipe.toNodeId, remaining); if (remaining === 0) queue.push(pipe.toNodeId); } }
  if (order.length !== input.nodes.length) throw new Error('CIVIL_GRAVITY_DRAINAGE_NETWORK_CYCLE');
  const pipeChecks: CivilGravityDrainageHydraulicPayload['pipeChecks'] = []; for (const nodeId of order) for (const pipe of pipesByFrom.get(nodeId) ?? []) { const from = nodeById.get(pipe.fromNodeId)!; const to = nodeById.get(pipe.toNodeId)!; const slope = (pipe.invertStartM - pipe.invertEndM) / pipe.lengthM; const diameterM = pipe.diameterMm / 1000; const area = Math.PI * diameterM * diameterM / 4; const hydraulicRadius = diameterM / 4; const capacity = (1 / pipe.roughnessN) * area * Math.pow(hydraulicRadius, 2 / 3) * Math.sqrt(slope); const demand = flowAtNode.get(pipe.fromNodeId) ?? 0; const downstreamBase = Math.max(to.invertElevationM, input.outfalls.find(outfall => outfall.nodeId === to.id)?.tailwaterElevationM ?? to.invertElevationM); const hglDownstream = downstreamBase + diameterM; const headLoss = pipe.lengthM * slope; const hglUpstream = hglDownstream + headLoss; const coverStart = from.rimElevationM - (pipe.invertStartM + diameterM); const coverEnd = to.rimElevationM - (pipe.invertEndM + diameterM); if (Math.abs(Math.hypot(to.positionM[0] - from.positionM[0], to.positionM[1] - from.positionM[1]) - pipe.lengthM) > 1e-5 || slope <= 0 || coverStart < input.minimumCoverM || coverEnd < input.minimumCoverM || from.rimElevationM - hglUpstream < input.minimumFreeboardM || demand > capacity + EPSILON) throw new Error(`CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_CHECK_FAILED:${pipe.id}`); pipeChecks.push({ id: pipe.id, peakFlowM3s: demand, capacityM3s: capacity, capacityRatio: demand / capacity, slopePercent: slope * 100, hglUpstreamM: hglUpstream, hglDownstreamM: hglDownstream, freeboardM: from.rimElevationM - hglUpstream, coverStartM: coverStart, coverEndM: coverEnd, status: 'passed' }); flowAtNode.set(pipe.toNodeId, (flowAtNode.get(pipe.toNodeId) ?? 0) + demand); }
  const payload: CivilGravityDrainageHydraulicPayload = { schema: CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_SCHEMA, binding: { workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash, tinArtifactSha256: tinHash, alignmentArtifactSha256: alignmentHash, networkArtifactSha256: networkHash }, units: { length: 'm', area: 'm2', flow: 'm3/s', rainfall: 'mm/hr', roughness: 's/m^(1/3)' }, provenance: { rainfallSourceId: input.rainfall.sourceId, rainfallSourceSha256: input.rainfall.sourceSha256, catchmentSourceIds: sorted(input.catchments).map(item => item.sourceId), catchmentSourceSha256: sorted(input.catchments).map(item => item.sourceSha256) }, criteria: { minimumFreeboardM: input.minimumFreeboardM, minimumCoverM: input.minimumCoverM, method: 'rational_peak_manning_full_flow_normal_hgl_v1' }, rainfall: input.rainfall, catchments: sorted(input.catchments), nodes: sorted(input.nodes), pipes: sorted(input.pipes), outfalls: sorted(input.outfalls), pipeChecks: sorted(pipeChecks), counts: { catchments: input.catchments.length, nodes: input.nodes.length, pipes: input.pipes.length, outfalls: input.outfalls.length }, dynamicHydraulics: 'NOT_RUN', surgeAnalysis: 'NOT_RUN', swmmRoundtrip: 'HOLD', civil3dRoundtrip: 'HOLD', surveyValidation: 'NOT_RUN', authorityReview: 'HOLD', fieldTest: 'NOT_RUN', releaseReady: false };
  const issues = validatePayload(payload); if (issues.length) throw new Error(`CIVIL_GRAVITY_DRAINAGE_PAYLOAD_INVALID:${issues[0]}`); const contentHash = designRevisionSha256(payload); const bytes = encoder.encode(canonicalDesignJson({ payload, contentHash })); return { payload, contentHash, bytes, artifactSha256: hash(bytes), artifactName: input.artifactName ?? 'civil-gravity-drainage-hydraulic.json', artifactMime: 'application/json' };
}

export function parseCivilGravityDrainageHydraulicArtifact(bytes: Uint8Array, expectedBinding?: CivilGravityDrainageHydraulicPayload['binding']): CivilGravityDrainageHydraulicParseResult {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('CIVIL_GRAVITY_DRAINAGE_ARTIFACT_EMPTY'); let text: string; try { text = decoder.decode(bytes); } catch { throw new Error('CIVIL_GRAVITY_DRAINAGE_INVALID_UTF8'); } let parsed: unknown; try { parsed = JSON.parse(text) as unknown; } catch { throw new Error('CIVIL_GRAVITY_DRAINAGE_JSON_INVALID'); } if (!record(parsed) || !record(parsed.payload) || typeof parsed.contentHash !== 'string' || !SHA256.test(parsed.contentHash) || !exact(parsed, ['payload', 'contentHash'])) throw new Error('CIVIL_GRAVITY_DRAINAGE_ENVELOPE_INVALID'); if (canonicalDesignJson(parsed) !== text) throw new Error('CIVIL_GRAVITY_DRAINAGE_NON_CANONICAL'); const issues = validatePayload(parsed.payload); if (issues.length) throw new Error(`CIVIL_GRAVITY_DRAINAGE_INVALID:${issues[0]}`); const payload = parsed.payload as CivilGravityDrainageHydraulicPayload; if (designRevisionSha256(payload) !== parsed.contentHash) throw new Error('CIVIL_GRAVITY_DRAINAGE_CONTENT_HASH_MISMATCH'); if (expectedBinding && canonicalDesignJson(payload.binding) !== canonicalDesignJson(expectedBinding)) throw new Error('CIVIL_GRAVITY_DRAINAGE_STALE_BINDING'); return { payload, contentHash: parsed.contentHash, artifactSha256: hash(bytes) };
}
export function verifyCivilGravityDrainageHydraulic(input: { artifact: CivilGravityDrainageHydraulicParseResult; workspaceRevisionId: string; workspaceContentHash: string; tinArtifactSha256: string; alignmentArtifactSha256: string; networkArtifactSha256: string }): CivilGravityDrainageHydraulicVerification { const structural = validatePayload(input.artifact.payload); const issues = [...structural, ...(structural.length ? [] : deepHydraulicIssues(input.artifact.payload))]; if (input.artifact.contentHash !== designRevisionSha256(input.artifact.payload)) issues.push('content_hash_mismatch'); const binding = input.artifact.payload.binding; if (binding.workspaceRevisionId !== input.workspaceRevisionId || binding.workspaceContentHash !== input.workspaceContentHash || binding.tinArtifactSha256 !== input.tinArtifactSha256 || binding.alignmentArtifactSha256 !== input.alignmentArtifactSha256 || binding.networkArtifactSha256 !== input.networkArtifactSha256) issues.push('stale_binding'); return issues.length ? { status: 'failed', verifierId: 'civil-gravity-drainage-hydraulic-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'civil-gravity-drainage-hydraulic-structural.v1', issues: [] }; }
function stableIds(payload: CivilGravityDrainageHydraulicPayload): CivilGravityDrainageHydraulicReceipt['stableIds'] { return { catchments: payload.catchments.map(item => item.id), nodes: payload.nodes.map(item => item.id), pipes: payload.pipes.map(item => item.id), outfalls: payload.outfalls.map(item => item.id) }; }
function canonicalObject(bytes: Uint8Array, errorCode: string): unknown { if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error(errorCode); let text: string; let parsed: unknown; try { text = decoder.decode(bytes); parsed = JSON.parse(text) as unknown; } catch { throw new Error(errorCode); } if (canonicalDesignJson(parsed) !== text) throw new Error(errorCode); return parsed; }
export function buildCivilGravityDrainageHydraulicReceipt(input: { artifact: CivilGravityDrainageHydraulicArtifact; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): Uint8Array {
  if (hash(input.artifact.bytes) !== input.artifact.artifactSha256) throw new Error('CIVIL_GRAVITY_DRAINAGE_RECEIPT_HASH_INPUT_INVALID');
  const parsedArtifact = parseCivilGravityDrainageHydraulicArtifact(input.artifact.bytes, input.artifact.payload.binding);
  if (parsedArtifact.contentHash !== input.artifact.contentHash || parsedArtifact.artifactSha256 !== input.artifact.artifactSha256 || canonicalDesignJson(parsedArtifact.payload) !== canonicalDesignJson(input.artifact.payload)) throw new Error('CIVIL_GRAVITY_DRAINAGE_RECEIPT_ARTIFACT_BINDING_MISMATCH');
  const verification = verifyCivilGravityDrainageHydraulic({ artifact: parsedArtifact, ...parsedArtifact.payload.binding }); if (verification.status !== 'passed') throw new Error(`CIVIL_GRAVITY_DRAINAGE_RECEIPT_VERIFICATION_FAILED:${verification.issues[0]}`);
  const parserOutput = canonicalObject(input.parserOutputBytes, 'CIVIL_GRAVITY_DRAINAGE_RECEIPT_PARSER_OUTPUT_INVALID'); if (canonicalDesignJson(parserOutput) !== canonicalDesignJson(parsedArtifact)) throw new Error('CIVIL_GRAVITY_DRAINAGE_RECEIPT_PARSER_OUTPUT_MISMATCH');
  const evidence = canonicalObject(input.verifierEvidenceBytes, 'CIVIL_GRAVITY_DRAINAGE_RECEIPT_VERIFIER_EVIDENCE_INVALID') as Record<string, unknown>;
  if (!exact(evidence, ['schema', 'verifierId', 'status', 'artifactSha256', 'contentHash', 'releaseReady']) || evidence.schema !== 'nexyfab.civil-gravity-drainage-hydraulic-verification.v1' || evidence.verifierId !== 'civil-gravity-drainage-hydraulic-structural.v1' || evidence.status !== 'passed' || evidence.artifactSha256 !== parsedArtifact.artifactSha256 || evidence.contentHash !== parsedArtifact.contentHash || evidence.releaseReady !== false) throw new Error('CIVIL_GRAVITY_DRAINAGE_RECEIPT_VERIFIER_EVIDENCE_MISMATCH');
  const payload = parsedArtifact.payload; const receipt: CivilGravityDrainageHydraulicReceipt = { schema: CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_RECEIPT_SCHEMA, capabilityId: CIVIL_GRAVITY_DRAINAGE_HYDRAULIC_CAPABILITY_ID, format: 'json', workspaceRevisionId: payload.binding.workspaceRevisionId, workspaceContentHash: payload.binding.workspaceContentHash, tinArtifactSha256: payload.binding.tinArtifactSha256, alignmentArtifactSha256: payload.binding.alignmentArtifactSha256, networkArtifactSha256: payload.binding.networkArtifactSha256, artifactSha256: input.artifact.artifactSha256, artifactBytes: input.artifact.bytes.byteLength, parserResult: 'verified', parserOutputSha256: hash(input.parserOutputBytes), verifierEvidenceSha256: hash(input.verifierEvidenceBytes), stableIds: stableIds(payload), dynamicHydraulics: 'NOT_RUN', surgeAnalysis: 'NOT_RUN', swmmRoundtrip: 'HOLD', civil3dRoundtrip: 'HOLD', surveyValidation: 'NOT_RUN', authorityReview: 'HOLD', fieldTest: 'NOT_RUN', releaseReady: false }; return encoder.encode(canonicalDesignJson(receipt));
}
export function claimCivilGravityDrainageHydraulicReceipt(input: { artifact: CivilGravityDrainageHydraulicArtifact; receiptBytes: Uint8Array; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): CivilGravityDrainageHydraulicReceipt & { receiptSha256: string; claim: 'internal-civil-gravity-drainage-hydraulic-verified' } { let text: string; let receipt: CivilGravityDrainageHydraulicReceipt; try { text = decoder.decode(input.receiptBytes); receipt = JSON.parse(text) as CivilGravityDrainageHydraulicReceipt; } catch { throw new Error('CIVIL_GRAVITY_DRAINAGE_RECEIPT_INVALID'); } if (!exact(receipt, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'tinArtifactSha256', 'alignmentArtifactSha256', 'networkArtifactSha256', 'artifactSha256', 'artifactBytes', 'parserResult', 'parserOutputSha256', 'verifierEvidenceSha256', 'stableIds', 'dynamicHydraulics', 'surgeAnalysis', 'swmmRoundtrip', 'civil3dRoundtrip', 'surveyValidation', 'authorityReview', 'fieldTest', 'releaseReady']) || canonicalDesignJson(receipt) !== text) throw new Error('CIVIL_GRAVITY_DRAINAGE_RECEIPT_NON_CANONICAL'); const expected = JSON.parse(decoder.decode(buildCivilGravityDrainageHydraulicReceipt(input))) as CivilGravityDrainageHydraulicReceipt; if (canonicalDesignJson(receipt) !== canonicalDesignJson(expected)) throw new Error('CIVIL_GRAVITY_DRAINAGE_RECEIPT_BINDING_MISMATCH'); return { ...receipt, receiptSha256: hash(input.receiptBytes), claim: 'internal-civil-gravity-drainage-hydraulic-verified' }; }
