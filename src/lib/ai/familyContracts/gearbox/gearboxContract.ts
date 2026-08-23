import { createHash } from 'node:crypto';
import { z } from 'zod';
import { verifyComplexSystemGraphBytes } from '../../complexSystemGraph';

const sha = z.string().regex(/^[a-f0-9]{64}$/), positive = z.number().finite().positive();
const safeName = z.string().min(1).max(240).refine(value => !/[\\/]/.test(value) && value !== '.' && value !== '..');
const contractSchema = z.object({
  schema: z.literal('nexyfab.gearbox-family-contract.v1'), systemGraphHash: sha,
  target: z.object({ ratio: positive, ratioTolerance: z.number().finite().min(0).max(0.2), inputTorqueNm: positive, requiredOutputTorqueNm: positive, outputDirection: z.enum(['same', 'opposite']), requiredLifeHours: positive, minimumGearBendingSafetyFactor: positive, minimumGearContactSafetyFactor: positive, minimumShaftSafetyFactor: positive, minimumBearingStaticSafetyFactor: positive }).strict(),
  gears: z.array(z.object({ nodeId: z.string().min(1), teeth: z.number().int().min(6), moduleMm: positive, faceWidthMm: positive }).strict()).min(2),
  stages: z.array(z.object({ id: z.string().min(1), inputGearNodeId: z.string().min(1), outputGearNodeId: z.string().min(1), mesh: z.enum(['external', 'internal', 'worm']), efficiency: z.number().finite().gt(0).max(1) }).strict()).min(1),
  gearStrength: z.array(z.object({ gearNodeId: z.string().min(1), bendingStressMpa: positive, allowableBendingStressMpa: positive, contactStressMpa: positive, allowableContactStressMpa: positive }).strict()).min(2),
  shafts: z.array(z.object({ nodeId: z.string().min(1), demandedTorqueNm: positive, allowableTorqueNm: positive }).strict()).min(2),
  bearings: z.array(z.object({ nodeId: z.string().min(1), calculatedLifeHours: positive, staticSafetyFactor: positive }).strict()).min(2),
  backlash: z.object({ predictedMm: z.number().finite().min(0), minimumMm: z.number().finite().min(0), maximumMm: positive }).strict(),
  housing: z.object({ nodeId: z.string().min(1), predictedDeflectionMm: z.number().finite().min(0), maximumDeflectionMm: positive }).strict(),
  thermal: z.object({ predictedSteadyTemperatureC: z.number().finite(), maximumTemperatureC: z.number().finite(), totalLossW: z.number().finite().min(0) }).strict(),
  lubrication: z.object({ selected: z.literal(true), viscosityAt40Cst: positive, minimumOperatingC: z.number().finite(), maximumOperatingC: z.number().finite(), materialCompatibilityConfirmed: z.boolean() }).strict(),
  seals: z.array(z.object({ nodeId: z.string().min(1), lubricantCompatible: z.boolean(), temperatureCompatible: z.boolean(), shaftSpeedCompatible: z.boolean() }).strict()).min(1),
  evidenceArtifactNames: z.array(safeName).min(1),
}).strict();

export type GearboxFamilyContract = z.infer<typeof contractSchema>;
export type GearboxFamilyContractReport = {
  schema: 'nexyfab.gearbox-family-contract-report.v1'; status: 'passed' | 'failed' | 'not_run'; familyContractReady: boolean; systemGraphHash: string | null; contractFileSha256: string; applicationHash: string | null;
  calculated: { ratio: number | null; outputTorqueNm: number | null; outputDirection: 'same' | 'opposite' | null; minimumGearBendingSafetyFactor: number | null; minimumGearContactSafetyFactor: number | null; minimumShaftSafetyFactor: number | null; minimumBearingStaticSafetyFactor: number | null; minimumBearingLifeHours: number | null };
  checks: { systemGraph: boolean; topology: boolean; ratio: boolean; direction: boolean; torque: boolean; gearStrength: boolean; shaftStrength: boolean; bearingLife: boolean; backlash: boolean; housing: boolean; thermal: boolean; lubrication: boolean; seals: boolean; evidence: boolean };
  errors: string[]; blockers: string[]; physicalValidationComplete: false; finalExpertReviewComplete: false; releaseReady: false; sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function verifyGearboxFamilyContractBytes(graphBytes: Uint8Array, contractBytes: Uint8Array, artifacts: ReadonlyMap<string, Uint8Array>): GearboxFamilyContractReport {
  const errors: string[] = [], graphReport = verifyComplexSystemGraphBytes(graphBytes, artifacts);
  let graphRaw: unknown = null, contractRaw: unknown = null;
  try { graphRaw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(graphBytes)); } catch { /* graph verifier reports it */ }
  try { contractRaw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contractBytes)); } catch { errors.push('contract must be valid UTF-8 JSON'); }
  const parsed = contractSchema.safeParse(contractRaw);
  if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `contract.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!graphReport.graphReady || graphReport.family !== 'gearbox') errors.push('gearbox system graph is not ready');
  const graph = graphRaw && typeof graphRaw === 'object' ? graphRaw as { nodes?: Array<{ id?: unknown; kind?: unknown; attributes?: Record<string, unknown> }>; artifacts?: Array<{ name?: unknown }> } : null;
  const partRoles = new Map((graph?.nodes ?? []).filter(node => node.kind === 'part' && typeof node.id === 'string').map(node => [node.id as string, node.attributes?.role]));
  const checks = { systemGraph: graphReport.graphReady && graphReport.family === 'gearbox', topology: false, ratio: false, direction: false, torque: false, gearStrength: false, shaftStrength: false, bearingLife: false, backlash: false, housing: false, thermal: false, lubrication: false, seals: false, evidence: false };
  let ratio: number | null = null, outputTorqueNm: number | null = null, outputDirection: 'same' | 'opposite' | null = null, minBending: number | null = null, minContact: number | null = null, minShaft: number | null = null, minBearingStatic: number | null = null, minBearingLife: number | null = null;
  if (parsed.success) {
    const value = parsed.data, gearById = new Map(value.gears.map(item => [item.nodeId, item])), componentIds = [...value.gears.map(item => item.nodeId), ...value.shafts.map(item => item.nodeId), ...value.bearings.map(item => item.nodeId), value.housing.nodeId, ...value.seals.map(item => item.nodeId)];
    if (value.systemGraphHash !== graphReport.graphHash) errors.push('contract systemGraphHash mismatch');
    if (new Set(componentIds).size !== componentIds.length) errors.push('gearbox component roles must use distinct part nodes');
    const roleGroups: Array<[string, string[], string]> = [['gear', value.gears.map(item => item.nodeId), 'gear'], ['shaft', value.shafts.map(item => item.nodeId), 'shaft'], ['bearing', value.bearings.map(item => item.nodeId), 'bearing'], ['housing', [value.housing.nodeId], 'housing'], ['seal', value.seals.map(item => item.nodeId), 'seal']];
    for (const [label, ids, role] of roleGroups) for (const id of ids) if (partRoles.get(id) !== role) errors.push(`${label}_part_role_invalid:${id}`);
    const stageIds = new Set<string>(), usedInputs = new Set<string>(), usedOutputs = new Set<string>();
    let ratioValue = 1, efficiency = 1, direction = 1;
    for (const stage of value.stages) { if (stageIds.has(stage.id)) errors.push(`stage_duplicate:${stage.id}`); stageIds.add(stage.id); const input = gearById.get(stage.inputGearNodeId), output = gearById.get(stage.outputGearNodeId); if (!input || !output || input.nodeId === output.nodeId) errors.push(`stage_gear_invalid:${stage.id}`); else { ratioValue *= output.teeth / input.teeth; efficiency *= stage.efficiency; direction *= stage.mesh === 'internal' ? 1 : -1; } usedInputs.add(stage.inputGearNodeId); usedOutputs.add(stage.outputGearNodeId); }
    const first = value.stages[0], last = value.stages[value.stages.length - 1];
    for (let index = 0; index < value.stages.length - 1; index++) if (value.stages[index]!.outputGearNodeId !== value.stages[index + 1]!.inputGearNodeId) errors.push(`stage_chain_disconnected:${value.stages[index]!.id}:${value.stages[index + 1]!.id}`);
    checks.topology = Boolean(first && last) && value.gears.every(gear => usedInputs.has(gear.nodeId) || usedOutputs.has(gear.nodeId)) && !errors.some(error => error.startsWith('stage_'));
    ratio = ratioValue; outputTorqueNm = value.target.inputTorqueNm * ratioValue * efficiency; outputDirection = direction === 1 ? 'same' : 'opposite';
    checks.ratio = Math.abs(ratioValue - value.target.ratio) <= value.target.ratio * value.target.ratioTolerance;
    checks.direction = outputDirection === value.target.outputDirection;
    checks.torque = outputTorqueNm >= value.target.requiredOutputTorqueNm;
    const strengthByGear = new Map(value.gearStrength.map(item => [item.gearNodeId, item])); if (strengthByGear.size !== value.gears.length || value.gears.some(gear => !strengthByGear.has(gear.nodeId))) errors.push('gear strength coverage incomplete');
    minBending = Math.min(...value.gearStrength.map(item => item.allowableBendingStressMpa / item.bendingStressMpa)); minContact = Math.min(...value.gearStrength.map(item => item.allowableContactStressMpa / item.contactStressMpa));
    checks.gearStrength = minBending >= value.target.minimumGearBendingSafetyFactor && minContact >= value.target.minimumGearContactSafetyFactor && !errors.includes('gear strength coverage incomplete');
    minShaft = Math.min(...value.shafts.map(item => item.allowableTorqueNm / item.demandedTorqueNm)); checks.shaftStrength = minShaft >= value.target.minimumShaftSafetyFactor;
    minBearingStatic = Math.min(...value.bearings.map(item => item.staticSafetyFactor)); minBearingLife = Math.min(...value.bearings.map(item => item.calculatedLifeHours)); checks.bearingLife = minBearingStatic >= value.target.minimumBearingStaticSafetyFactor && minBearingLife >= value.target.requiredLifeHours;
    checks.backlash = value.backlash.maximumMm >= value.backlash.minimumMm && value.backlash.predictedMm >= value.backlash.minimumMm && value.backlash.predictedMm <= value.backlash.maximumMm;
    checks.housing = value.housing.predictedDeflectionMm <= value.housing.maximumDeflectionMm;
    checks.thermal = value.thermal.predictedSteadyTemperatureC <= value.thermal.maximumTemperatureC;
    checks.lubrication = value.lubrication.materialCompatibilityConfirmed && value.lubrication.maximumOperatingC > value.lubrication.minimumOperatingC && value.thermal.predictedSteadyTemperatureC >= value.lubrication.minimumOperatingC && value.thermal.predictedSteadyTemperatureC <= value.lubrication.maximumOperatingC;
    checks.seals = value.seals.every(item => item.lubricantCompatible && item.temperatureCompatible && item.shaftSpeedCompatible);
    const graphArtifacts = new Set((graph?.artifacts ?? []).flatMap(item => typeof item.name === 'string' ? [item.name] : [])); checks.evidence = value.evidenceArtifactNames.every(name => graphArtifacts.has(name) && artifacts.has(name));
    for (const [name, passed] of Object.entries(checks)) if (!passed) errors.push(`gearbox_check_failed:${name}`);
  }
  const uniqueErrors = [...new Set(errors)], ready = parsed.success && uniqueErrors.length === 0 && Object.values(checks).every(Boolean);
  const systemGraphHash = graphReport.graphHash;
  return { schema: 'nexyfab.gearbox-family-contract-report.v1', status: ready ? 'passed' : graphReport.status === 'not_run' ? 'not_run' : 'failed', familyContractReady: ready, systemGraphHash, contractFileSha256: digest(contractBytes), applicationHash: ready && systemGraphHash ? digest(new TextEncoder().encode(canonical({ systemGraphHash, contractFileSha256: digest(contractBytes), calculated: { ratio, outputTorqueNm, outputDirection, minBending, minContact, minShaft, minBearingStatic, minBearingLife } }))) : null, calculated: { ratio, outputTorqueNm, outputDirection, minimumGearBendingSafetyFactor: minBending, minimumGearContactSafetyFactor: minContact, minimumShaftSafetyFactor: minShaft, minimumBearingStaticSafetyFactor: minBearingStatic, minimumBearingLifeHours: minBearingLife }, checks, errors: uniqueErrors, blockers: ready ? ['gearbox_physical_validation_required', 'final_expert_review_required'] : ['gearbox_family_contract_incomplete', 'gearbox_physical_validation_required', 'final_expert_review_required'], physicalValidationComplete: false, finalExpertReviewComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } };
}

function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
