import type { ComplexGenerationStage } from './complexGenerationCheckpoint';

export type ComplexErrorClass = 'input' | 'requirements' | 'kernel' | 'topology' | 'assembly' | 'motion' | 'clearance' | 'roundtrip' | 'unknown';
export type RepairDisposition = 'auto_retry' | 'user_input' | 'manual_review' | 'stop';
export interface RepairMutation { path: string; operation: 'rebuild' | 'heal' | 'recompute' | 'reexport'; }
export interface ComplexRepairRequest { errorCodes: string[]; affectedPaths: string[]; lockedPaths: string[]; previousFingerprints?: string[]; maximumIdenticalAttempts?: number; }
export interface ComplexRepairPlan { schema: 'nexyfab.complex-repair-plan.v1'; fingerprint: string; errorClass: ComplexErrorClass; disposition: RepairDisposition; mutations: RepairMutation[]; rollbackTo: ComplexGenerationStage | null; downstreamStages: ComplexGenerationStage[]; reasons: string[]; }

interface RegistryEntry { prefix: string; errorClass: ComplexErrorClass; disposition: RepairDisposition; operation?: RepairMutation['operation']; rollbackTo?: ComplexGenerationStage; allowedRoots?: string[]; }
const REGISTRY: readonly RegistryEntry[] = [
  { prefix: 'PART_KERNEL_', errorClass: 'kernel', disposition: 'auto_retry', operation: 'rebuild', rollbackTo: 'S4_KERNEL', allowedRoots: ['parts.'] },
  { prefix: 'PART_NOT_WATERTIGHT', errorClass: 'topology', disposition: 'auto_retry', operation: 'heal', rollbackTo: 'S4_KERNEL', allowedRoots: ['parts.'] },
  { prefix: 'PART_NON_MANIFOLD', errorClass: 'topology', disposition: 'auto_retry', operation: 'heal', rollbackTo: 'S4_KERNEL', allowedRoots: ['parts.'] },
  { prefix: 'PART_DIMENSION_', errorClass: 'requirements', disposition: 'user_input' },
  { prefix: 'ASSEMBLY_TRANSFORM_', errorClass: 'assembly', disposition: 'auto_retry', operation: 'recompute', rollbackTo: 'S5_ASSEMBLY', allowedRoots: ['occurrences.'] },
  { prefix: 'ASSEMBLY_JOINT_', errorClass: 'assembly', disposition: 'auto_retry', operation: 'recompute', rollbackTo: 'S5_ASSEMBLY', allowedRoots: ['interfaces.'] },
  { prefix: 'MOTION_SOLVER_', errorClass: 'motion', disposition: 'auto_retry', operation: 'recompute', rollbackTo: 'S6_MOTION_COLLISION', allowedRoots: ['motion.'] },
  { prefix: 'PRECISE_COLLISION_', errorClass: 'clearance', disposition: 'manual_review' },
  { prefix: 'CLEARANCE_BELOW_', errorClass: 'clearance', disposition: 'manual_review' },
  { prefix: 'STEP_ROUNDTRIP_', errorClass: 'roundtrip', disposition: 'auto_retry', operation: 'reexport', rollbackTo: 'S7_MANUFACTURING_ROUNDTRIP', allowedRoots: ['exports.'] },
];
const STAGES: ComplexGenerationStage[] = ['S0_INPUT', 'S1_REQUIREMENTS', 'S2_ARCHITECTURE', 'S3_PART_DESIGN', 'S4_KERNEL', 'S5_ASSEMBLY', 'S6_MOTION_COLLISION', 'S7_MANUFACTURING_ROUNDTRIP', 'S8_REPAIR'];
const isWithin = (path: string, root: string) => path === root.slice(0, -1) || path.startsWith(root);
const overlaps = (path: string, locked: string) => path === locked || path.startsWith(`${locked}.`) || locked.startsWith(`${path}.`);

/** Deterministic, fail-closed repair planning. It never mutates values itself. */
export function planComplexRepair(request: ComplexRepairRequest): ComplexRepairPlan {
  const codes = [...new Set(request.errorCodes.map(code => code.trim()).filter(Boolean))].sort();
  const paths = [...new Set(request.affectedPaths.map(path => path.trim()).filter(Boolean))].sort();
  const fingerprint = `${codes.join('|')}::${paths.join('|')}`;
  const base = { schema: 'nexyfab.complex-repair-plan.v1' as const, fingerprint, mutations: [] as RepairMutation[], rollbackTo: null, downstreamStages: [] as ComplexGenerationStage[] };
  if (!codes.length) return { ...base, errorClass: 'unknown', disposition: 'stop', reasons: ['repair_error_code_missing'] };
  const entries = codes.map(code => REGISTRY.find(entry => code.startsWith(entry.prefix)));
  if (entries.some(entry => !entry)) return { ...base, errorClass: 'unknown', disposition: 'stop', reasons: codes.filter((_, index) => !entries[index]).map(code => `repair_code_unregistered:${code}`) };
  const resolved = entries as RegistryEntry[];
  const strongest = resolved.some(item => item.disposition === 'stop') ? 'stop' : resolved.some(item => item.disposition === 'user_input') ? 'user_input' : resolved.some(item => item.disposition === 'manual_review') ? 'manual_review' : 'auto_retry';
  const errorClass = resolved[0]!.errorClass;
  if (strongest !== 'auto_retry') return { ...base, errorClass, disposition: strongest, reasons: [`repair_requires_${strongest}`] };
  const limit = Math.max(1, request.maximumIdenticalAttempts ?? 3), repeats = (request.previousFingerprints ?? []).filter(value => value === fingerprint).length;
  if (repeats >= limit) return { ...base, errorClass, disposition: 'stop', reasons: [`repair_identical_attempt_limit:${limit}`] };
  const allowedRoots = [...new Set(resolved.flatMap(item => item.allowedRoots ?? []))];
  const forbidden = paths.filter(path => !allowedRoots.some(root => isWithin(path, root)));
  const locked = paths.filter(path => request.lockedPaths.some(item => overlaps(path, item)));
  if (forbidden.length || locked.length) return { ...base, errorClass, disposition: 'stop', reasons: [...forbidden.map(path => `repair_path_outside_boundary:${path}`), ...locked.map(path => `repair_locked_path:${path}`)] };
  if (!paths.length) return { ...base, errorClass, disposition: 'stop', reasons: ['repair_affected_path_missing'] };
  const rollbackTo = resolved.map(item => item.rollbackTo!).sort((a, b) => STAGES.indexOf(a) - STAGES.indexOf(b))[0]!;
  const operation = resolved[0]!.operation!;
  const mutations = paths.map(path => ({ path, operation }));
  return { ...base, errorClass, disposition: 'auto_retry', mutations, rollbackTo, downstreamStages: STAGES.slice(STAGES.indexOf(rollbackTo)), reasons: [] };
}
