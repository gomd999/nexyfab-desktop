import { createHash } from 'node:crypto';
import { z } from 'zod';
import { verifyComplexSystemGraphBytes } from '../../complexSystemGraph';

const sha = z.string().regex(/^[a-f0-9]{64}$/), positive = z.number().finite().positive(), safeName = z.string().min(1).max(240).refine(value => !/[\\/]/.test(value) && value !== '.' && value !== '..');
const schema = z.object({
  schema: z.literal('nexyfab.machine-skid-family-contract.v1'), systemGraphHash: sha,
  target: z.object({ maximumMassKg: positive, maximumEnvelopeMm: z.tuple([positive, positive, positive]), maximumAlignmentErrorMm: positive, minimumLoadPathSafetyFactor: positive, minimumAnchorSafetyFactor: positive, minimumLiftingSafetyFactor: positive, operatingFrequencyHz: z.tuple([positive, positive]), minimumFrequencySeparationRatio: z.number().finite().gt(1) }).strict(),
  massItems: z.array(z.object({ nodeId: z.string().min(1), massKg: positive }).strict()).min(2),
  baseFrame: z.object({ nodeId: z.string().min(1), predictedDeflectionMm: z.number().finite().min(0), maximumDeflectionMm: positive }).strict(),
  loadCases: z.array(z.object({ id: z.string().min(1), demandedN: positive, allowableN: positive, demandedMomentNm: z.number().finite().min(0), allowableMomentNm: positive }).strict()).min(1),
  anchors: z.array(z.object({ nodeId: z.string().min(1), demandedN: positive, allowableN: positive }).strict()).min(2),
  alignment: z.array(z.object({ equipmentNodeId: z.string().min(1), predictedErrorMm: z.number().finite().min(0) }).strict()).min(1),
  vibrationModesHz: z.array(positive).min(1),
  lifting: z.array(z.object({ nodeId: z.string().min(1), demandedN: positive, allowableN: positive }).strict()).min(2),
  centerOfGravityInsideLiftPolygon: z.boolean(),
  ports: z.array(z.object({ nodeId: z.string().min(1), connected: z.boolean(), ratingMargin: z.number().finite().min(0) }).strict()).min(1),
  service: z.array(z.object({ nodeId: z.string().min(1), availableClearanceMm: z.number().finite().min(0), requiredClearanceMm: positive, removableWithoutDestructiveDisassembly: z.boolean() }).strict()).min(1),
  transport: z.object({ envelopeMm: z.tuple([positive, positive, positive]), totalMassKg: positive, approvedLiftAndTieDownPlan: z.boolean() }).strict(),
  evidenceArtifactNames: z.array(safeName).min(1),
}).strict();
export type MachineSkidFamilyContract = z.infer<typeof schema>;
export type MachineSkidFamilyContractReport = { schema: 'nexyfab.machine-skid-family-contract-report.v1'; status: 'passed' | 'failed' | 'not_run'; familyContractReady: boolean; systemGraphHash: string | null; contractFileSha256: string; applicationHash: string | null; calculated: { totalMassKg: number | null; minimumLoadPathSafetyFactor: number | null; minimumAnchorSafetyFactor: number | null; minimumLiftingSafetyFactor: number | null; maximumAlignmentErrorMm: number | null }; checks: Record<'systemGraph' | 'componentRoles' | 'massEnvelope' | 'baseFrame' | 'loadPath' | 'anchors' | 'alignment' | 'vibration' | 'lifting' | 'ports' | 'service' | 'transport' | 'evidence', boolean>; errors: string[]; blockers: string[]; physicalCommissioningComplete: false; releaseReady: false; sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false } };

export function verifyMachineSkidFamilyContractBytes(graphBytes: Uint8Array, contractBytes: Uint8Array, artifacts: ReadonlyMap<string, Uint8Array>): MachineSkidFamilyContractReport {
  const graphReport = verifyComplexSystemGraphBytes(graphBytes, artifacts), errors: string[] = [];
  let graphRaw: unknown = null, raw: unknown = null; try { graphRaw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(graphBytes)); } catch { /* graph report owns error */ } try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contractBytes)); } catch { errors.push('contract must be valid UTF-8 JSON'); }
  const parsed = schema.safeParse(raw); if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `contract.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!graphReport.graphReady || graphReport.family !== 'machine_skid') errors.push('machine/skid system graph is not ready');
  const graph = graphRaw && typeof graphRaw === 'object' ? graphRaw as { nodes?: Array<{ id?: unknown; kind?: unknown; attributes?: Record<string, unknown> }>; artifacts?: Array<{ name?: unknown }> } : null;
  const roles = new Map((graph?.nodes ?? []).filter(node => typeof node.id === 'string').map(node => [node.id as string, node.attributes?.role]));
  const checks: MachineSkidFamilyContractReport['checks'] = { systemGraph: graphReport.graphReady && graphReport.family === 'machine_skid', componentRoles: false, massEnvelope: false, baseFrame: false, loadPath: false, anchors: false, alignment: false, vibration: false, lifting: false, ports: false, service: false, transport: false, evidence: false };
  let totalMassKg: number | null = null, minLoad: number | null = null, minAnchor: number | null = null, minLift: number | null = null, maxAlignment: number | null = null;
  if (parsed.success) {
    const value = parsed.data; if (value.systemGraphHash !== graphReport.graphHash) errors.push('contract systemGraphHash mismatch');
    const expectedRoles: Array<[string, string]> = [[value.baseFrame.nodeId, 'base_frame'], ...value.massItems.map(item => [item.nodeId, item.nodeId === value.baseFrame.nodeId ? 'base_frame' : 'equipment'] as [string, string]), ...value.anchors.map(item => [item.nodeId, 'anchor'] as [string, string]), ...value.lifting.map(item => [item.nodeId, 'lifting_point'] as [string, string]), ...value.ports.map(item => [item.nodeId, 'port'] as [string, string])];
    checks.componentRoles = expectedRoles.every(([id, role]) => roles.get(id) === role); if (!checks.componentRoles) errors.push('machine/skid component role binding invalid');
    totalMassKg = value.massItems.reduce((sum, item) => sum + item.massKg, 0); checks.massEnvelope = totalMassKg <= value.target.maximumMassKg;
    checks.baseFrame = value.baseFrame.predictedDeflectionMm <= value.baseFrame.maximumDeflectionMm;
    minLoad = Math.min(...value.loadCases.flatMap(item => [item.allowableN / item.demandedN, item.demandedMomentNm > 0 ? item.allowableMomentNm / item.demandedMomentNm : Number.POSITIVE_INFINITY])); checks.loadPath = minLoad >= value.target.minimumLoadPathSafetyFactor;
    minAnchor = Math.min(...value.anchors.map(item => item.allowableN / item.demandedN)); checks.anchors = minAnchor >= value.target.minimumAnchorSafetyFactor;
    maxAlignment = Math.max(...value.alignment.map(item => item.predictedErrorMm)); checks.alignment = maxAlignment <= value.target.maximumAlignmentErrorMm && value.alignment.every(item => roles.get(item.equipmentNodeId) === 'equipment');
    const [operatingMin, operatingMax] = value.target.operatingFrequencyHz; checks.vibration = operatingMax >= operatingMin && value.vibrationModesHz.every(mode => mode < operatingMin / value.target.minimumFrequencySeparationRatio || mode > operatingMax * value.target.minimumFrequencySeparationRatio);
    minLift = Math.min(...value.lifting.map(item => item.allowableN / item.demandedN)); checks.lifting = minLift >= value.target.minimumLiftingSafetyFactor && value.centerOfGravityInsideLiftPolygon;
    checks.ports = value.ports.every(item => item.connected && item.ratingMargin >= 1);
    checks.service = value.service.every(item => roles.has(item.nodeId) && item.availableClearanceMm >= item.requiredClearanceMm && item.removableWithoutDestructiveDisassembly);
    checks.transport = value.transport.totalMassKg === totalMassKg && value.transport.approvedLiftAndTieDownPlan && value.transport.envelopeMm.every((dimension, index) => dimension <= value.target.maximumEnvelopeMm[index]!);
    const declared = new Set((graph?.artifacts ?? []).flatMap(item => typeof item.name === 'string' ? [item.name] : [])); checks.evidence = value.evidenceArtifactNames.every(name => declared.has(name) && artifacts.has(name));
    for (const [name, passed] of Object.entries(checks)) if (!passed) errors.push(`machine_skid_check_failed:${name}`);
  }
  const uniqueErrors = [...new Set(errors)], ready = parsed.success && uniqueErrors.length === 0 && Object.values(checks).every(Boolean), systemGraphHash = graphReport.graphHash, contractFileSha256 = digest(contractBytes);
  return { schema: 'nexyfab.machine-skid-family-contract-report.v1', status: ready ? 'passed' : graphReport.status === 'not_run' ? 'not_run' : 'failed', familyContractReady: ready, systemGraphHash, contractFileSha256, applicationHash: ready && systemGraphHash ? digest(new TextEncoder().encode(canonical({ systemGraphHash, contractFileSha256, totalMassKg, minLoad, minAnchor, minLift, maxAlignment }))) : null, calculated: { totalMassKg, minimumLoadPathSafetyFactor: minLoad, minimumAnchorSafetyFactor: minAnchor, minimumLiftingSafetyFactor: minLift, maximumAlignmentErrorMm: maxAlignment }, checks, errors: uniqueErrors, blockers: ready ? ['machine_skid_physical_commissioning_required', 'final_expert_review_required'] : ['machine_skid_family_contract_incomplete', 'machine_skid_physical_commissioning_required', 'final_expert_review_required'], physicalCommissioningComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } };
}
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
