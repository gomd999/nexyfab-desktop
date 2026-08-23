export const CAD_CONTRACT_VERSION = 'nexyfab.cad-contract.v1' as const;

export const CAD_DOMAINS = [
  'mechanical',
  'architecture',
  'civil',
  'landscape',
  'interior',
  'coordination',
] as const;

export type CadDomain = (typeof CAD_DOMAINS)[number];

export type CapabilityState =
  | 'WORKING'
  | 'PREVIEW'
  | 'BLOCKED'
  | 'NOT_IMPLEMENTED';

export type EvidenceTruthState =
  | 'PASS'
  | 'FAIL'
  | 'PREVIEW'
  | 'NOT_RUN'
  | 'BLOCKED';

export interface SelectionRequirement {
  minimum: number;
  maximum?: number;
  kinds: string[];
}

export interface ToolDefinition {
  id: string;
  domain: CadDomain;
  contractVersion: typeof CAD_CONTRACT_VERSION;
  requiredSelection: SelectionRequirement;
  parameterSchema: Readonly<Record<string, unknown>>;
  previewCapability: 'EXACT' | 'PREVIEW' | 'NOT_IMPLEMENTED';
  executeCapability: 'EXACT' | 'PREVIEW' | 'NOT_IMPLEMENTED';
  undoPolicy: 'SINGLE_REVISION' | 'TRANSACTION' | 'NOT_AVAILABLE';
  requiredPermission: string;
  requiredEvidence: string[];
  state: CapabilityState;
  unavailableReason?: string;
}

export interface DeploymentIdentity {
  buildId: string;
  contractVersion: string;
  schemaVersion: string;
  kernelIdentity: string | 'NOT_APPLICABLE';
  environment: 'local' | 'preview' | 'staging' | 'production';
}

export const CAD_INTEROP_RECEIPT_VERSION = 'nexyfab.cad-interop-preservation-receipt.v1' as const;

export const CAD_INTEROP_FORMATS = ['STEP', 'IFC', 'DWG', 'RVT', 'NEXYFAB_IR'] as const;
export type CadInteropFormat = (typeof CAD_INTEROP_FORMATS)[number];

export const CAD_INTEROP_AXES = [
  'units',
  'coordinate',
  'topology',
  'assembly',
  'pmi',
  'material',
] as const;
export type CadInteropAxisName = (typeof CAD_INTEROP_AXES)[number];

export interface CadInteropAxisEvidence {
  axis: CadInteropAxisName;
  required: boolean;
  state: EvidenceTruthState;
  method: string;
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>> | null;
  tolerance: Readonly<Record<string, number>> | null;
  reasons: string[];
}

export interface CadInteropPreservationReceipt {
  contractVersion: typeof CAD_INTEROP_RECEIPT_VERSION;
  sourceFormat: CadInteropFormat;
  resultFormat: CadInteropFormat;
  sourceContentSha256: string;
  resultContentSha256: string | null;
  execution: EvidenceTruthState;
  axes: CadInteropAxisEvidence[];
  unsupportedReasons: string[];
}

export type CadInteropReceiptInput = Omit<CadInteropPreservationReceipt, 'contractVersion' | 'execution'>;

export interface ExternalCadReopenEvidence {
  format: Exclude<CadInteropFormat, 'NEXYFAB_IR'>;
  application: string;
  applicationVersion: string;
  workerIdentitySha256: string;
  openedContentSha256: string;
  execution: 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED';
  licenseVerified: boolean;
  documentOpened: boolean;
  nativeRegenerationCompleted: boolean;
  savedRoundtripContentSha256: string | null;
  reasons: string[];
}

export function validateExternalCadReopenEvidence(
  expectedContentSha256: string,
  evidence: ExternalCadReopenEvidence | null,
): { state: 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED'; reasons: string[] } {
  if (!evidence) return { state: 'NOT_RUN', reasons: ['external_cad_reopen_evidence_missing'] };
  const reasons = [...evidence.reasons];
  if (!SHA256.test(expectedContentSha256) || evidence.openedContentSha256 !== expectedContentSha256) reasons.push('external_cad_opened_hash_mismatch');
  if (!SHA256.test(evidence.workerIdentitySha256)) reasons.push('external_cad_worker_identity_invalid');
  if (!evidence.licenseVerified) reasons.push('external_cad_license_not_verified');
  if (!evidence.documentOpened) reasons.push('external_cad_document_not_opened');
  if (!evidence.nativeRegenerationCompleted) reasons.push('external_cad_regeneration_not_completed');
  if (evidence.savedRoundtripContentSha256 !== null && !SHA256.test(evidence.savedRoundtripContentSha256)) reasons.push('external_cad_roundtrip_hash_invalid');
  if (evidence.execution === 'NOT_RUN' || evidence.execution === 'BLOCKED') {
    return { state: evidence.execution, reasons: [...new Set(reasons.length ? reasons : ['external_cad_reopen_not_executed'])] };
  }
  if (evidence.execution === 'FAIL' || reasons.length) return { state: 'FAIL', reasons: [...new Set(reasons.length ? reasons : ['external_cad_reopen_failed'])] };
  return { state: 'PASS', reasons: [] };
}

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Produces the only aggregate interop verdict used across browser, Container,
 * and licensed native-worker paths. A required axis that was not executed can
 * never be promoted to PASS by aggregation.
 */
export function buildCadInteropPreservationReceipt(input: CadInteropReceiptInput): CadInteropPreservationReceipt {
  const seen = new Set<CadInteropAxisName>();
  for (const axis of input.axes) {
    if (seen.has(axis.axis)) throw new Error(`cad_interop_axis_duplicate:${axis.axis}`);
    seen.add(axis.axis);
  }
  const missing = CAD_INTEROP_AXES.filter(axis => !seen.has(axis));
  if (missing.length) throw new Error(`cad_interop_axes_missing:${missing.join(',')}`);
  if (!SHA256.test(input.sourceContentSha256)) throw new Error('cad_interop_source_hash_invalid');
  if (input.resultContentSha256 !== null && !SHA256.test(input.resultContentSha256)) {
    throw new Error('cad_interop_result_hash_invalid');
  }
  const required = input.axes.filter(axis => axis.required);
  let execution: EvidenceTruthState;
  if (input.unsupportedReasons.length) execution = 'BLOCKED';
  else if (!required.length || input.resultContentSha256 === null) execution = 'NOT_RUN';
  else if (required.some(axis => axis.state === 'FAIL')) execution = 'FAIL';
  else if (required.some(axis => axis.state === 'BLOCKED')) execution = 'BLOCKED';
  else if (required.some(axis => axis.state !== 'PASS')) execution = 'NOT_RUN';
  else execution = 'PASS';
  return { contractVersion: CAD_INTEROP_RECEIPT_VERSION, ...input, execution };
}

export function validateCadInteropPreservationReceipt(value: unknown): string[] {
  if (!isRecord(value)) return ['cad_interop_receipt_must_be_an_object'];
  const issues: string[] = [];
  if (value.contractVersion !== CAD_INTEROP_RECEIPT_VERSION) issues.push('cad_interop_contract_version_mismatch');
  if (!CAD_INTEROP_FORMATS.includes(value.sourceFormat as CadInteropFormat)) issues.push('cad_interop_source_format_invalid');
  if (!CAD_INTEROP_FORMATS.includes(value.resultFormat as CadInteropFormat)) issues.push('cad_interop_result_format_invalid');
  if (!SHA256.test(String(value.sourceContentSha256 ?? ''))) issues.push('cad_interop_source_hash_invalid');
  if (value.resultContentSha256 !== null && !SHA256.test(String(value.resultContentSha256 ?? ''))) issues.push('cad_interop_result_hash_invalid');
  if (!['PASS', 'FAIL', 'PREVIEW', 'NOT_RUN', 'BLOCKED'].includes(String(value.execution))) issues.push('cad_interop_execution_invalid');
  if (!Array.isArray(value.unsupportedReasons) || value.unsupportedReasons.some(reason => typeof reason !== 'string' || !reason.trim())) {
    issues.push('cad_interop_unsupported_reasons_invalid');
  }
  if (!Array.isArray(value.axes)) return [...issues, 'cad_interop_axes_invalid'];
  const axes = value.axes.filter(isRecord);
  if (axes.length !== value.axes.length) issues.push('cad_interop_axis_invalid');
  for (const name of CAD_INTEROP_AXES) {
    const matching = axes.filter(axis => axis.axis === name);
    if (matching.length !== 1) issues.push(`cad_interop_axis_count_invalid:${name}`);
  }
  for (const axis of axes) {
    if (typeof axis.required !== 'boolean') issues.push(`cad_interop_axis_required_invalid:${String(axis.axis)}`);
    if (!['PASS', 'FAIL', 'PREVIEW', 'NOT_RUN', 'BLOCKED'].includes(String(axis.state))) issues.push(`cad_interop_axis_state_invalid:${String(axis.axis)}`);
    if (typeof axis.method !== 'string' || !axis.method.trim()) issues.push(`cad_interop_axis_method_invalid:${String(axis.axis)}`);
    if (!Array.isArray(axis.reasons) || axis.reasons.some(reason => typeof reason !== 'string' || !reason.trim())) issues.push(`cad_interop_axis_reasons_invalid:${String(axis.axis)}`);
  }
  if (!issues.length) {
    try {
      const receipt = value as unknown as CadInteropPreservationReceipt;
      const rebuilt = buildCadInteropPreservationReceipt({
        sourceFormat: receipt.sourceFormat,
        resultFormat: receipt.resultFormat,
        sourceContentSha256: receipt.sourceContentSha256,
        resultContentSha256: receipt.resultContentSha256,
        axes: receipt.axes,
        unsupportedReasons: receipt.unsupportedReasons,
      });
      if (rebuilt.execution !== receipt.execution) issues.push('cad_interop_execution_inconsistent');
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'cad_interop_receipt_invalid');
    }
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateToolDefinition(value: unknown): string[] {
  if (!isRecord(value)) return ['tool_definition_must_be_an_object'];

  const issues: string[] = [];
  if (typeof value.id !== 'string' || value.id.trim() === '') issues.push('tool_id_required');
  if (!CAD_DOMAINS.includes(value.domain as CadDomain)) issues.push('unsupported_cad_domain');
  if (value.contractVersion !== CAD_CONTRACT_VERSION) issues.push('cad_contract_version_mismatch');
  if (!isRecord(value.requiredSelection)) issues.push('selection_requirement_required');
  if (!isRecord(value.parameterSchema)) issues.push('parameter_schema_required');
  if (typeof value.requiredPermission !== 'string' || value.requiredPermission.trim() === '') issues.push('required_permission_missing');
  if (!Array.isArray(value.requiredEvidence)) issues.push('required_evidence_must_be_an_array');
  if (!['WORKING', 'PREVIEW', 'BLOCKED', 'NOT_IMPLEMENTED'].includes(String(value.state))) issues.push('invalid_capability_state');
  if ((value.state === 'BLOCKED' || value.state === 'NOT_IMPLEMENTED')
    && (typeof value.unavailableReason !== 'string' || value.unavailableReason.trim() === '')) {
    issues.push('unavailable_reason_required');
  }
  return issues;
}
