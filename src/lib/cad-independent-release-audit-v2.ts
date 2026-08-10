export interface CadIndependentReleaseAuditV2 {
  schema: 'nexyfab.cad-independent-release-audit.v2';
  releaseId: string;
  productRisk: 'standard' | 'complex';
  externalCadRequired: false;
  runtimeKernelMode: 'wasm-only-no-stub';
  closedBetaIntegrity: { status: 'pass' | 'fail'; reportSha256: string };
  revisionManifest: { status: 'pass' | 'fail'; sha256: string };
  kernelStackIdentity: { status: 'pass' | 'fail'; sha256: string };
  kernelEvidence: { status: 'pass' | 'fail'; sha256: string };
  licenses: { status: 'pass' | 'fail'; inventorySha256: string; unresolved: string[] };
  apiControls: { evidenceSha256: string; authentication: 'pass' | 'fail'; authorization: 'pass' | 'fail'; rateLimit: 'pass' | 'fail'; metering: 'pass' | 'fail' };
  operations: { restoreDrill: 'pass' | 'fail'; rollback: 'pass' | 'fail'; monitoring: 'pass' | 'fail' };
  expertReview: { status: 'pass' | 'not-required' | 'missing'; reviewerId?: string };
}

export interface ReleaseAuditIssue { code: string; message: string }
const SHA256 = /^[a-f0-9]{64}$/;

export function cadIndependentReleaseAuditV2Issues(value: unknown): ReleaseAuditIssue[] {
  const audit = value as Partial<CadIndependentReleaseAuditV2> | null;
  if (!audit || typeof audit !== 'object') return [{ code: 'audit.missing', message: 'CAD-independent release audit v2 is required' }];
  const issues: ReleaseAuditIssue[] = [];
  if (audit.schema !== 'nexyfab.cad-independent-release-audit.v2') issues.push({ code: 'audit.schema', message: 'release audit schema must be v2' });
  if (!audit.releaseId?.trim()) issues.push({ code: 'audit.release_id', message: 'releaseId is required' });
  if (audit.externalCadRequired !== false) issues.push({ code: 'audit.external_cad_contract', message: 'external CAD must not be required' });
  if (audit.runtimeKernelMode !== 'wasm-only-no-stub') issues.push({ code: 'audit.kernel_mode', message: 'commercial runtime must be WASM-only with no stub fallback' });
  for (const [name, gate] of Object.entries({
    closedBetaIntegrity: audit.closedBetaIntegrity,
    revisionManifest: audit.revisionManifest,
    kernelStackIdentity: audit.kernelStackIdentity,
    kernelEvidence: audit.kernelEvidence,
  })) {
    if (!gate || gate.status !== 'pass') issues.push({ code: `audit.${name}.failed`, message: `${name} must pass` });
    if (!gate || !SHA256.test('reportSha256' in gate ? String(gate.reportSha256) : String(gate.sha256))) issues.push({ code: `audit.${name}.sha256`, message: `${name} must bind a SHA-256` });
  }
  if (!audit.licenses || audit.licenses.status !== 'pass' || audit.licenses.unresolved?.length) issues.push({ code: 'audit.licenses.failed', message: 'all production dependency licenses must be resolved' });
  if (!audit.licenses || !SHA256.test(String(audit.licenses.inventorySha256))) issues.push({ code: 'audit.licenses.sha256', message: 'license inventory SHA-256 is required' });
  for (const key of ['authentication', 'authorization', 'rateLimit', 'metering'] as const) {
    if (audit.apiControls?.[key] !== 'pass') issues.push({ code: `audit.api.${key}`, message: `API ${key} evidence must pass` });
  }
  if (!SHA256.test(String(audit.apiControls?.evidenceSha256))) issues.push({ code: 'audit.api.sha256', message: 'API control evidence SHA-256 is required' });
  for (const key of ['restoreDrill', 'rollback', 'monitoring'] as const) {
    if (audit.operations?.[key] !== 'pass') issues.push({ code: `audit.operations.${key}`, message: `operations ${key} evidence must pass` });
  }
  if (audit.productRisk === 'complex') {
    if (audit.expertReview?.status !== 'pass' || !audit.expertReview.reviewerId?.trim()) issues.push({ code: 'audit.expert_review', message: 'complex products require an identified internal expert review' });
  } else if (audit.productRisk !== 'standard') {
    issues.push({ code: 'audit.product_risk', message: 'productRisk must be standard or complex' });
  } else if (!['pass', 'not-required'].includes(audit.expertReview?.status ?? '')) {
    issues.push({ code: 'audit.expert_review', message: 'standard products require pass or an explicit not-required decision' });
  }
  return issues;
}
