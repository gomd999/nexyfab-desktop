import {
  validateCadInteropPreservationReceipt,
  validateExternalCadReopenEvidence,
  type CadInteropPreservationReceipt,
  type ExternalCadReopenEvidence,
} from '../../../packages/cad-contracts/src/index';

export interface NativeCadReopenGateResult {
  schema: 'nexyfab.native-cad-reopen-gate.v1';
  state: 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED';
  releaseReady: boolean;
  sourceFormat: CadInteropPreservationReceipt['sourceFormat'];
  resultFormat: CadInteropPreservationReceipt['resultFormat'];
  reasons: string[];
}

/**
 * Joins exchange preservation with a licensed application's actual open and
 * regeneration evidence. Container output alone is intentionally
 * insufficient for this gate.
 */
export function evaluateNativeCadReopenGate(
  receipt: CadInteropPreservationReceipt,
  evidence: ExternalCadReopenEvidence | null,
): NativeCadReopenGateResult {
  const receiptIssues = validateCadInteropPreservationReceipt(receipt);
  const reasons = [...receiptIssues];
  if (receipt.execution !== 'PASS') reasons.push(`interop_preservation_${receipt.execution.toLowerCase()}`);
  const reopen = receipt.resultContentSha256
    ? validateExternalCadReopenEvidence(receipt.resultContentSha256, evidence)
    : { state: 'NOT_RUN' as const, reasons: ['interop_result_artifact_missing'] };
  reasons.push(...reopen.reasons);
  let state: NativeCadReopenGateResult['state'];
  if (receiptIssues.length || receipt.execution === 'FAIL' || reopen.state === 'FAIL') state = 'FAIL';
  else if (receipt.execution === 'BLOCKED' || reopen.state === 'BLOCKED') state = 'BLOCKED';
  else if (receipt.execution !== 'PASS' || reopen.state !== 'PASS') state = 'NOT_RUN';
  else state = 'PASS';
  return {
    schema: 'nexyfab.native-cad-reopen-gate.v1',
    state,
    releaseReady: state === 'PASS',
    sourceFormat: receipt.sourceFormat,
    resultFormat: receipt.resultFormat,
    reasons: [...new Set(reasons)],
  };
}
