import { createHash } from 'node:crypto';

import {
  buildDomainProductQualification,
  type DomainProductQualificationResult,
} from '../../../src/lib/cad/domainProductQualification';
import {
  validateDomainAuthorityManifest,
  type DomainAuthorityManifest,
} from '../../../src/lib/cad/domainAuthorityManifest';
import {
  canonicalDomainDeliverableManifestHash,
  type DomainDeliverableManifest,
} from '../../../src/lib/cad/domainDeliverableManifest';
import {
  validateMechanicalProductAuthority,
  type MechanicalAuthorityContext,
} from './authority';
import {
  validateMechanicalDriveModuleDeliverableManifest,
  type MechanicalDriveModuleDeliverableManifest,
} from './deliverables';
import {
  hashMotorGearboxDriveModuleContract,
  validateMotorGearboxDriveModuleContract,
  type MotorGearboxDriveModuleContract,
} from './contract';
import {
  qualifyMotorGearboxDriveModule,
  type MechanicalCheckReceipt,
  type MechanicalDriveModuleQualification,
} from './qualify';
import { hashMechanicalFeatureTree } from './model';

const SHA = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';

const hashBytes = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const hashValue = (value: unknown): string => {
  if (typeof value === 'string') return hashBytes(Buffer.from(value, 'utf8'));
  if (value instanceof Uint8Array) return hashBytes(value);
  return hashBytes(Buffer.from(canonical(value), 'utf8'));
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unique = (values: string[]): string[] => [...new Set(values)];

export interface MechanicalIndependentStepEvidence {
  status: 'PASS' | 'FAIL' | 'HOLD';
  sourceRevision: string;
  inputSha256: string;
  importedSha256: string;
  validatorId: string;
  validatorVersion: string;
  independent: true;
}

export interface MechanicalNativeProjectEnvelope {
  schema: 'nexyfab.mechanical.native-project.v1';
  projectId: string;
  productId: string;
  sourceRevision: string;
  contractSha256: string;
  modelSha256: string;
}

export interface MechanicalProductPipelineInput {
  projectId: string;
  authorityContext: MechanicalAuthorityContext;
  authorityManifest: unknown;
  contract: unknown;
  model: unknown;
  nativeProject: unknown;
  step: string | Uint8Array;
  deliverableManifest: unknown;
  /** Bytes or canonical payloads for every item in the manifest. */
  deliverableContents: Record<string, unknown>;
  checks: unknown;
  independentStep: unknown;
  campaignEvidence?: Parameters<typeof buildDomainProductQualification>[0]['campaignEvidence'];
  independentReviews?: Parameters<typeof buildDomainProductQualification>[0]['independentReviews'];
  pilots?: Parameters<typeof buildDomainProductQualification>[0]['pilots'];
  claimedState: Parameters<typeof buildDomainProductQualification>[0]['claimedState'];
  issuedAt: string;
}

export interface MechanicalProductPipelineHashes {
  contractSha256: string | null;
  modelSha256: string | null;
  nativeProjectSha256: string | null;
  stepSha256: string | null;
  deliverableManifestSha256: string | null;
  deliverableSha256s: Record<string, string>;
}

export interface MechanicalProductPipelineResult {
  status: 'PASS' | 'HOLD' | 'FAIL';
  productReceiptPromotionReady: false;
  hashes: MechanicalProductPipelineHashes;
  mechanicalQualification: MechanicalDriveModuleQualification | null;
  commonQualification: DomainProductQualificationResult | null;
  authorityStatus: 'PASS' | 'HOLD';
  blockers: string[];
}

const emptyResult = (blockers: string[], hashes: MechanicalProductPipelineHashes = {
  contractSha256: null,
  modelSha256: null,
  nativeProjectSha256: null,
  stepSha256: null,
  deliverableManifestSha256: null,
  deliverableSha256s: {},
}): MechanicalProductPipelineResult => ({
  status: 'FAIL', productReceiptPromotionReady: false, hashes,
  mechanicalQualification: null, commonQualification: null,
  authorityStatus: 'HOLD', blockers: unique(blockers),
});

function validateModelBinding(model: unknown, contract: MotorGearboxDriveModuleContract): string[] {
  const issues: string[] = [];
  if (!isRecord(model)) return ['model:not_an_object'];
  if (model.schema !== 'nexyfab.mechanical.product.model.v1') issues.push('model:schema_invalid');
  if (!isRecord(model.contract)) issues.push('model:contract_missing');
  else if (hashMotorGearboxDriveModuleContract(model.contract as unknown as MotorGearboxDriveModuleContract) !== hashMotorGearboxDriveModuleContract(contract)) issues.push('model:contract_hash_mismatch');
  if (!isRecord(model.featureTrees)) issues.push('model:feature_trees_missing');
  else {
    const trees = model.featureTrees as Record<string, unknown>;
    const expectedIds = new Set(contract.parts.map((part) => part.id));
    for (const part of contract.parts) {
      const tree = trees[part.id];
      if (!tree) issues.push(`model:feature_tree_missing:${part.id}`);
      else if (hashMechanicalFeatureTree(tree as never) !== part.geometryHash) issues.push(`model:feature_tree_hash_mismatch:${part.id}`);
    }
    for (const id of Object.keys(trees)) if (!expectedIds.has(id)) issues.push(`model:feature_tree_unknown:${id}`);
  }
  if (!isRecord(model.assemblyState)) issues.push('model:assembly_state_missing');
  if (!isRecord(model.metadata) || model.metadata.preview !== false || model.metadata.rightsStatus !== 'RIGHTS_CLEARED_ORIGINAL') issues.push('model:not_rights_cleared_original');
  return unique(issues);
}

function validateIndependentStep(value: unknown, revision: string, stepSha256: string): string[] {
  if (!isRecord(value)) return ['step:independent_evidence_missing'];
  const expected = ['status', 'sourceRevision', 'inputSha256', 'importedSha256', 'validatorId', 'validatorVersion', 'independent'];
  if (Object.keys(value).sort().join('|') !== expected.slice().sort().join('|')) return ['step:independent_evidence_keys_invalid'];
  const issues: string[] = [];
  if (value.status !== 'PASS') issues.push(`step:independent_status_${String(value.status).toLowerCase()}`);
  if (value.sourceRevision !== revision) issues.push('step:independent_revision_stale');
  if (value.inputSha256 !== stepSha256) issues.push('step:independent_input_hash_mismatch');
  if (typeof value.importedSha256 !== 'string' || !SHA.test(value.importedSha256)) issues.push('step:independent_imported_hash_invalid');
  if (typeof value.validatorId !== 'string' || !SAFE.test(value.validatorId) || value.validatorId === 'nexyfab-mechanical-pipeline') issues.push('step:independent_validator_invalid');
  if (typeof value.validatorVersion !== 'string' || !SAFE.test(value.validatorVersion)) issues.push('step:independent_validator_version_invalid');
  if (value.independent !== true) issues.push('step:independent_attestation_missing');
  return issues;
}

function validateNativeProject(
  value: unknown,
  projectId: string,
  contract: MotorGearboxDriveModuleContract,
  contractSha256: string,
  modelSha256: string | null,
): string[] {
  if (!isRecord(value)) return ['native_project:not_an_object'];
  const expected = ['schema', 'projectId', 'productId', 'sourceRevision', 'contractSha256', 'modelSha256'];
  if (Object.keys(value).sort().join('|') !== expected.slice().sort().join('|')) return ['native_project:keys_invalid'];
  const issues: string[] = [];
  if (value.schema !== 'nexyfab.mechanical.native-project.v1') issues.push('native_project:schema_invalid');
  if (value.projectId !== projectId) issues.push('native_project:project_mismatch');
  if (value.productId !== contract.identity.id) issues.push('native_project:product_mismatch');
  if (value.sourceRevision !== contract.identity.revision) issues.push('native_project:revision_stale');
  if (value.contractSha256 !== contractSha256) issues.push('native_project:contract_hash_mismatch');
  if (!modelSha256 || value.modelSha256 !== modelSha256) issues.push('native_project:model_hash_mismatch');
  return issues;
}

function stepDocumentLooksValid(step: string | Uint8Array): boolean {
  const text = typeof step === 'string' ? step : Buffer.from(step).toString('utf8');
  return text.includes('ISO-10303-21;') && text.includes('END-ISO-10303-21;');
}

/**
 * Runs the mechanical product boundary from current source objects to a
 * qualification receipt. Every hash used by the receipt is recomputed from
 * the supplied current payloads; caller-provided hash fields are only
 * accepted when they match those payloads. Missing independent or production
 * evidence remains a HOLD and can never promote the synthetic fixture.
 */
export function runMechanicalProductPipeline(input: MechanicalProductPipelineInput): MechanicalProductPipelineResult {
  const hashes: MechanicalProductPipelineHashes = {
    contractSha256: null, modelSha256: null, nativeProjectSha256: null,
    stepSha256: null, deliverableManifestSha256: null, deliverableSha256s: {},
  };
  const blockers: string[] = [];
  const contractIssues = validateMotorGearboxDriveModuleContract(input.contract);
  if (contractIssues.length) return emptyResult(contractIssues.map((issue) => `contract:${issue}`), hashes);
  const contract = input.contract as MotorGearboxDriveModuleContract;
  hashes.contractSha256 = hashMotorGearboxDriveModuleContract(contract);
  const modelIssues = validateModelBinding(input.model, contract);
  if (modelIssues.length) blockers.push(...modelIssues);
  if (isRecord(input.model)) hashes.modelSha256 = hashValue(input.model);
  const nativeProjectIssues = validateNativeProject(input.nativeProject, input.projectId, contract, hashes.contractSha256, hashes.modelSha256);
  blockers.push(...nativeProjectIssues);
  if (input.nativeProject !== undefined && input.nativeProject !== null) hashes.nativeProjectSha256 = hashValue(input.nativeProject);
  if (typeof input.step !== 'string' && !(input.step instanceof Uint8Array)) blockers.push('step:missing');
  else {
    hashes.stepSha256 = hashValue(input.step);
    if (!stepDocumentLooksValid(input.step)) blockers.push('step:document_invalid');
  }
  if (hashes.nativeProjectSha256 && hashes.stepSha256) {
    const independentIssues = validateIndependentStep(input.independentStep, contract.identity.revision, hashes.stepSha256);
    blockers.push(...independentIssues);
  } else blockers.push('step:independent_evidence_unavailable');

  const manifestResult = validateMechanicalDriveModuleDeliverableManifest(input.deliverableManifest, {
    projectRevision: contract.identity.revision,
    modelContentHash: hashes.modelSha256 ?? undefined,
  });
  if (!manifestResult.valid || !isRecord(input.deliverableManifest)) blockers.push(...manifestResult.errors.map((issue) => `deliverables:${issue}`));
  else {
    const manifest = input.deliverableManifest as unknown as MechanicalDriveModuleDeliverableManifest;
    hashes.deliverableManifestSha256 = canonicalDomainDeliverableManifestHash(manifest);
    if (hashes.nativeProjectSha256 && manifest.deliverables.find((item) => item.kind === 'native-project')?.contentSha256 !== hashes.nativeProjectSha256) blockers.push('deliverables:native_project_hash_mismatch');
    if (hashes.stepSha256 && manifest.deliverables.find((item) => item.kind === 'step')?.contentSha256 !== hashes.stepSha256) blockers.push('deliverables:step_hash_mismatch');
    const deliverableContents = isRecord(input.deliverableContents) ? input.deliverableContents : {};
    if (!isRecord(input.deliverableContents)) blockers.push('deliverables:contents_invalid');
    for (const item of manifest.deliverables) {
      if (!(item.kind in deliverableContents)) blockers.push(`deliverables:content_missing:${item.kind}`);
      else {
        const actual = hashValue(deliverableContents[item.kind]);
        hashes.deliverableSha256s[item.kind] = actual;
        if (actual !== item.contentSha256) blockers.push(`deliverables:content_hash_mismatch:${item.kind}`);
      }
    }
  }

  const authorityContext = input.authorityContext;
  if (authorityContext.projectId !== input.projectId) blockers.push('authority:context_project_mismatch');
  const authorityValidation = validateMechanicalProductAuthority(input.authorityManifest, input.contract, authorityContext);
  blockers.push(...authorityValidation.issues.map((issue) => `authority:${issue}`));
  const authorityStatus = authorityValidation.status;
  const mechanicalQualification = qualifyMotorGearboxDriveModule(input.contract, input.checks);
  blockers.push(...mechanicalQualification.blockers.map((issue) => `qualification:${issue}`));

  const checkReceipts = Array.isArray(input.checks) ? input.checks as MechanicalCheckReceipt[] : [];
  const stepChecks = checkReceipts.filter((check) => check.checkId.endsWith(':step-roundtrip'));
  if (!stepChecks.length || stepChecks.some((check) => check.status !== 'PASS')) blockers.push('step:independent_part_roundtrip_missing');
  const calculationArtifactSha256s = checkReceipts.filter((check) => ['load-life', 'alignment', 'tolerance-stack', 'dfm'].includes(check.checkId) && check.status === 'PASS').map((check) => check.resultSha256);
  if (!checkReceipts.some((check) => check.checkId === 'load-life' && check.status === 'PASS')) blockers.push('calculation:load_life_missing');
  if (!checkReceipts.some((check) => check.checkId === 'dfm' && check.status === 'PASS')) blockers.push('calculation:dfm_missing');
  if (!checkReceipts.some((check) => check.checkId === 'model-drawing-bom' && check.status === 'PASS')) blockers.push('drawing:model_drawing_bom_missing');
  const evidence = mechanicalQualification.axisEvidence;
  const exchangeReceiptSha256 = hashes.stepSha256 && isRecord(input.independentStep)
    ? hashValue({ stepSha256: hashes.stepSha256, importedSha256: input.independentStep.importedSha256, partStepResultSha256s: stepChecks.map((check) => check.resultSha256).sort() })
    : undefined;
  const commonQualification = buildDomainProductQualification({
    domain: 'mechanical', productId: contract.identity.id, projectId: input.projectId,
    projectRevision: { id: contract.identity.revision, sha256: input.authorityContext.projectRevisionSha256 },
    claimedState: input.claimedState, requirementsSha256: hashValue(contract.requirements),
    semanticModelSha256: hashes.modelSha256 ?? '0'.repeat(64), geometryOrModelSha256: hashes.modelSha256 ?? '0'.repeat(64),
    relationshipsSha256: isRecord(input.model) && isRecord(input.model.assemblyState) ? hashValue(input.model.assemblyState) : '0'.repeat(64),
    calculationArtifactSha256s, exchangeReceiptSha256, validationEvidence: evidence,
    campaignEvidence: input.campaignEvidence, independentReviews: input.independentReviews, pilots: input.pilots,
    currentBlockers: unique(blockers), issuedAt: input.issuedAt,
    authorityManifest: validateDomainAuthorityManifest(input.authorityManifest).status === 'PASS' ? input.authorityManifest as DomainAuthorityManifest : undefined,
    deliverableManifest: manifestResult.valid ? input.deliverableManifest as DomainDeliverableManifest : undefined,
  });
  blockers.push(...commonQualification.evaluation.blockers.map((issue) => `receipt:${issue}`));
  const finalBlockers = unique(blockers);
  const hardFailure = finalBlockers.some((issue) => issue.startsWith('contract:') || issue.startsWith('model:') || issue.startsWith('native_project:') || issue === 'step:document_invalid' || issue.includes('hash_mismatch') || issue.includes('keys_invalid'));
  return {
    status: hardFailure ? 'FAIL' : finalBlockers.length ? 'HOLD' : 'PASS',
    productReceiptPromotionReady: false, hashes, mechanicalQualification, commonQualification,
    authorityStatus, blockers: finalBlockers,
  };
}
