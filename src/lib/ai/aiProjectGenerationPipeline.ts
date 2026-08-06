import type { CadFailureCode } from '@/lib/reference/cadFailureTaxonomy';
import type { ProductSpatialIr } from './productSpatialIr';
import { productSpatialReleaseReady, validateProductSpatialIr } from './productSpatialIr';
import type { CrossDomainVerificationInput, CrossDomainVerificationResult } from './crossDomainVerification';
import { verifyCrossDomainDesign } from './crossDomainVerification';
import { assessComplexProductAccuracy, type ComplexProductAssessment, type ComplexProductEvidence } from './complexProductAccuracy';

export type AiProjectStage = 'requirements' | 'product_spatial_ir' | 'geometry' | 'complexity' | 'verification' | 'export' | 'complete';
export interface AiProjectGenerationInput {
  requirements: { unresolved: string[]; conflicts: string[] };
  ir?: ProductSpatialIr;
  geometry: { requested: number; exactGenerated: number; failedIds: string[] };
  complexProduct?: ComplexProductEvidence;
  verification?: CrossDomainVerificationInput;
  exports: { required: Array<'step' | 'ifc' | 'drawing'>; passed: Array<'step' | 'ifc' | 'drawing'> };
}
export interface AiProjectDecision {
  stage: AiProjectStage;
  status: 'pass' | 'blocked';
  failureCodes: CadFailureCode[];
  reasons: string[];
  verification?: CrossDomainVerificationResult;
  complexProduct?: ComplexProductAssessment;
}

export function evaluateAiProjectGeneration(input: AiProjectGenerationInput): AiProjectDecision {
  if (input.requirements.conflicts.length || input.requirements.unresolved.length) {
    return { stage: 'requirements', status: 'blocked', failureCodes: [], reasons: [...input.requirements.conflicts, ...input.requirements.unresolved] };
  }
  if (!input.ir) return { stage: 'product_spatial_ir', status: 'blocked', failureCodes: ['SEMANTIC_MAPPING_UNAVAILABLE'], reasons: ['Product/Spatial IR was not produced.'] };
  const irIssues = validateProductSpatialIr(input.ir);
  if (irIssues.length || !productSpatialReleaseReady(input.ir)) {
    const failureCodes = [...new Set(irIssues.map(issue => issue.code as CadFailureCode).filter(code => ['AMBIGUOUS_UNIT', 'INVALID_TRANSFORM', 'CYCLIC_ASSEMBLY', 'SEMANTIC_MAPPING_UNAVAILABLE'].includes(code)))];
    if (!failureCodes.length) failureCodes.push('MISSING_TRANSFORM');
    return { stage: 'product_spatial_ir', status: 'blocked', failureCodes, reasons: irIssues.length ? irIssues.map(issue => issue.message) : ['Required local/world placement evidence is incomplete.'] };
  }
  if (input.geometry.requested <= 0 || input.geometry.exactGenerated !== input.geometry.requested || input.geometry.failedIds.length) {
    return { stage: 'geometry', status: 'blocked', failureCodes: ['INVALID_BREP'], reasons: input.geometry.failedIds.length ? input.geometry.failedIds.map(id => `Exact geometry failed: ${id}`) : ['Exact generated geometry count does not match the request.'] };
  }
  const complexByPartCount = input.geometry.requested >= 10;
  if (complexByPartCount && !input.complexProduct) {
    return { stage: 'complexity', status: 'blocked', failureCodes: ['GEOMETRY_INCOMPLETE'], reasons: ['Complex products require per-part, interface, hierarchy, STEP occurrence, and repair-isolation evidence.'] };
  }
  if (input.complexProduct) {
    const complexProduct = assessComplexProductAccuracy(input.complexProduct);
    if (!complexProduct.releaseReady) return {
      stage: 'complexity', status: 'blocked', complexProduct,
      failureCodes: [...new Set(complexProduct.gates.filter(gate => !gate.passed).map(gate => gate.failureCode))],
      reasons: complexProduct.gates.filter(gate => !gate.passed).map(gate => gate.reason),
    };
  }
  if (!input.verification) return { stage: 'verification', status: 'blocked', failureCodes: ['PRECISE_INTERFERENCE_NOT_RUN'], reasons: ['Cross-domain verification was not run.'] };
  const verification = verifyCrossDomainDesign(input.verification);
  if (!verification.releaseReady) {
    return {
      stage: 'verification', status: 'blocked', verification,
      failureCodes: [...new Set(verification.gates.flatMap(gate => gate.failureCode ? [gate.failureCode] : []))],
      reasons: verification.gates.filter(gate => gate.status !== 'passed').map(gate => gate.reason),
    };
  }
  const missingExports = input.exports.required.filter(format => !input.exports.passed.includes(format));
  if (missingExports.length) return { stage: 'export', status: 'blocked', failureCodes: [], reasons: missingExports.map(format => `${format.toUpperCase()} roundtrip did not pass.`), verification };
  return { stage: 'complete', status: 'pass', failureCodes: [], reasons: [], verification };
}

export interface AiProjectRepairPlan { action: 'retry_stage' | 'request_input' | 'manual_review' | 'stop'; stage: AiProjectStage; reason: string }

export function planAiProjectRepair(decision: AiProjectDecision, attempt: number, repeatedFingerprintCount: number, maxAttempts = 3): AiProjectRepairPlan {
  if (decision.status === 'pass') return { action: 'stop', stage: 'complete', reason: 'Project generation already passed.' };
  if (attempt >= maxAttempts || repeatedFingerprintCount >= maxAttempts - 1) return { action: 'stop', stage: decision.stage, reason: 'Repeated identical failure; preserve the last verified checkpoint.' };
  if (decision.stage === 'requirements') return { action: 'request_input', stage: decision.stage, reason: 'Authoritative design requirements are missing or conflicting.' };
  if (decision.failureCodes.some(code => ['CYCLIC_ASSEMBLY', 'INVALID_TRANSFORM'].includes(code))) return { action: 'manual_review', stage: decision.stage, reason: 'Repair could change assembly or spatial design intent.' };
  return { action: 'retry_stage', stage: decision.stage, reason: 'Retry only the failed stage with structured failure codes.' };
}
