import { createHash } from 'node:crypto';
import type { DomainValidationEvidence } from '../../../src/lib/cad/domainProductReceipt';
import {
  validateMotorGearboxDriveModuleContract,
  type MotorGearboxDriveModuleContract,
} from './contract';

export const MECHANICAL_CHECK_RECEIPT_SCHEMA = 'nexyfab.mechanical.check-receipt.v1' as const;

export interface MechanicalCheckReceipt {
  schema: typeof MECHANICAL_CHECK_RECEIPT_SCHEMA;
  checkId: string;
  status: 'PASS' | 'FAIL' | 'HOLD' | 'NOT_RUN' | 'STALE';
  sourceRevision: string;
  inputSha256: string;
  resultSha256: string;
  validatorId: string;
  validatorVersion: string;
  issuedAt: string;
}

export interface MechanicalDriveModuleQualification {
  status: 'PASS' | 'HOLD' | 'FAIL';
  currentRevisionVerified: boolean;
  productReceiptPromotionReady: false;
  sourceRevision: string | null;
  contractSha256: string | null;
  checkCount: number;
  blockers: string[];
  axisEvidence: DomainValidationEvidence[];
}

const SHA = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RECEIPT_KEYS = ['schema', 'checkId', 'status', 'sourceRevision', 'inputSha256', 'resultSha256', 'validatorId', 'validatorVersion', 'issuedAt'];
const GLOBAL_CHECKS = [
  'assembly-solver', 'assembly-dof', 'assembly-static-interference', 'assembly-motion', 'assembly-exact-evidence',
  'load-life', 'alignment', 'service-clearance', 'guard-safety', 'tolerance-stack', 'dfm',
  'model-drawing-bom', 'inspection-coverage',
] as const;
const AXIS_CHECKS = {
  geometry: ['part-feature-tree', 'part-exact-brep'],
  topology: ['part-topology'],
  constraints: ['tolerance-stack', 'inspection-coverage'],
  assembly: ['assembly-solver', 'assembly-dof', 'assembly-static-interference', 'assembly-motion', 'assembly-exact-evidence', 'alignment', 'service-clearance', 'guard-safety'],
  manufacturability: ['load-life', 'dfm'],
  'drawing-consistency': ['model-drawing-bom', 'inspection-coverage'],
  'exchange-roundtrip': ['part-step-roundtrip'],
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const unique = (items: string[]) => [...new Set(items)];
const aggregateHash = (values: string[]) => createHash('sha256').update(JSON.stringify([...values].sort()), 'utf8').digest('hex');

function expectedCheckIds(contract: MotorGearboxDriveModuleContract): Set<string> {
  return new Set([
    ...GLOBAL_CHECKS,
    ...contract.parts.flatMap(part => [
      `part:${part.id}:feature-tree`,
      `part:${part.id}:exact-brep`,
      `part:${part.id}:topology`,
      `part:${part.id}:step-roundtrip`,
    ]),
  ]);
}

function validateReceipt(value: unknown, index: number, contract: MotorGearboxDriveModuleContract, expected: Set<string>): string[] {
  const path = `checks[${index}]`;
  if (!isRecord(value) || !exactKeys(value, RECEIPT_KEYS)) return [`${path}:keys_invalid`];
  const issues: string[] = [];
  if (value.schema !== MECHANICAL_CHECK_RECEIPT_SCHEMA) issues.push(`${path}:schema_invalid`);
  if (typeof value.checkId !== 'string' || !expected.has(value.checkId)) issues.push(`${path}:check_id_unknown`);
  if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(value.status as string)) issues.push(`${path}:status_invalid`);
  if (value.sourceRevision !== contract.identity.revision) issues.push(`${path}:revision_stale`);
  if (value.inputSha256 !== contract.identity.contentSha256) issues.push(`${path}:input_hash_mismatch`);
  if (typeof value.resultSha256 !== 'string' || !SHA.test(value.resultSha256)) issues.push(`${path}:result_hash_invalid`);
  if (typeof value.validatorId !== 'string' || !SAFE.test(value.validatorId)) issues.push(`${path}:validator_id_invalid`);
  if (typeof value.validatorVersion !== 'string' || !SAFE.test(value.validatorVersion)) issues.push(`${path}:validator_version_invalid`);
  if (typeof value.issuedAt !== 'string' || !ISO.test(value.issuedAt) || Number.isNaN(Date.parse(value.issuedAt))) issues.push(`${path}:issued_at_invalid`);
  if (typeof value.checkId === 'string' && value.checkId.startsWith('part:') && value.checkId.endsWith(':feature-tree')) {
    const partId = value.checkId.slice(5, -13);
    const part = contract.parts.find(item => item.id === partId);
    if (part && value.resultSha256 !== part.geometryHash) issues.push(`${path}:feature_tree_hash_mismatch`);
  }
  return issues;
}

function statusBlocker(check: MechanicalCheckReceipt): string | null {
  return check.status === 'PASS' ? null : `check_${check.status.toLowerCase()}:${check.checkId}`;
}

function axisReceipts(
  axisGroup: readonly string[],
  receipts: Map<string, MechanicalCheckReceipt>,
  contract: MotorGearboxDriveModuleContract,
): MechanicalCheckReceipt[] {
  return axisGroup.flatMap(check => {
    if (check === 'part-feature-tree') return contract.parts.map(part => receipts.get(`part:${part.id}:feature-tree`)).filter(Boolean) as MechanicalCheckReceipt[];
    if (check === 'part-exact-brep') return contract.parts.map(part => receipts.get(`part:${part.id}:exact-brep`)).filter(Boolean) as MechanicalCheckReceipt[];
    if (check === 'part-topology') return contract.parts.map(part => receipts.get(`part:${part.id}:topology`)).filter(Boolean) as MechanicalCheckReceipt[];
    if (check === 'part-step-roundtrip') return contract.parts.map(part => receipts.get(`part:${part.id}:step-roundtrip`)).filter(Boolean) as MechanicalCheckReceipt[];
    const receipt = receipts.get(check);
    return receipt ? [receipt] : [];
  });
}

/**
 * Verifies one immutable drive-module revision. The returned one-case axis
 * evidence cannot itself satisfy the 20-case/3-campaign product policy.
 */
export function qualifyMotorGearboxDriveModule(contractInput: unknown, checkInput: unknown): MechanicalDriveModuleQualification {
  const contractIssues = validateMotorGearboxDriveModuleContract(contractInput);
  if (contractIssues.length) return {
    status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false,
    sourceRevision: null, contractSha256: null, checkCount: 0,
    blockers: contractIssues.map(issue => `contract:${issue}`), axisEvidence: [],
  };
  const contract = contractInput as MotorGearboxDriveModuleContract;
  if (!Array.isArray(checkInput) || checkInput.length > 512) return {
    status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false,
    sourceRevision: contract.identity.revision, contractSha256: contract.identity.contentSha256, checkCount: 0,
    blockers: ['checks:invalid'], axisEvidence: [],
  };

  const expected = expectedCheckIds(contract);
  const structuralIssues = checkInput.flatMap((value, index) => validateReceipt(value, index, contract, expected));
  if (structuralIssues.length) return {
    status: 'FAIL', currentRevisionVerified: false, productReceiptPromotionReady: false,
    sourceRevision: contract.identity.revision, contractSha256: contract.identity.contentSha256, checkCount: checkInput.length,
    blockers: unique(structuralIssues), axisEvidence: [],
  };

  const receipts = new Map<string, MechanicalCheckReceipt>();
  const blockers: string[] = [];
  for (const receipt of checkInput as MechanicalCheckReceipt[]) {
    if (receipts.has(receipt.checkId)) blockers.push(`check_duplicate:${receipt.checkId}`);
    receipts.set(receipt.checkId, receipt);
    const blocker = statusBlocker(receipt);
    if (blocker) blockers.push(blocker);
  }
  for (const checkId of expected) if (!receipts.has(checkId)) blockers.push(`check_not_run:${checkId}`);

  const axisEvidence = Object.entries(AXIS_CHECKS).map(([axis, groups]): DomainValidationEvidence => {
    const requiredCount = groups.reduce((count, group) => count + (group.startsWith('part-') ? contract.parts.length : 1), 0);
    const checks = axisReceipts(groups, receipts, contract);
    const statuses = checks.map(check => check.status);
    const status: DomainValidationEvidence['status'] = checks.length !== requiredCount ? 'NOT_RUN'
      : statuses.includes('FAIL') ? 'FAIL'
        : statuses.includes('STALE') ? 'STALE'
          : statuses.includes('HOLD') ? 'HOLD'
            : statuses.includes('NOT_RUN') ? 'NOT_RUN' : 'PASS';
    return {
      axis,
      status,
      caseCount: 1,
      accuracyBasisPoints: status === 'PASS' ? 10_000 : 0,
      coverageBasisPoints: status === 'PASS' ? 10_000 : 0,
      falseVerificationCount: 0,
      artifactSha256: aggregateHash(checks.map(check => check.resultSha256)),
      sourceRevision: contract.identity.revision,
    };
  });
  const currentRevisionVerified = blockers.length === 0 && axisEvidence.every(axis => axis.status === 'PASS');
  return {
    status: currentRevisionVerified ? 'PASS' : blockers.some(blocker => blocker.includes('_fail:')) ? 'FAIL' : 'HOLD',
    currentRevisionVerified,
    productReceiptPromotionReady: false,
    sourceRevision: contract.identity.revision,
    contractSha256: contract.identity.contentSha256,
    checkCount: receipts.size,
    blockers: unique(blockers),
    axisEvidence,
  };
}
