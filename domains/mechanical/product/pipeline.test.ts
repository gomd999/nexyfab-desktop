import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createMechanicalDriveModuleDeliverableManifest, MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS } from './deliverables';
import { MECHANICAL_CHECK_RECEIPT_SCHEMA, type MechanicalCheckReceipt } from './qualify';
import { buildMotorGearboxDriveModuleModel } from './model';
import { runMechanicalProductPipeline, type MechanicalProductPipelineInput } from './pipeline';

const sha = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').digest('hex');
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const payloadSha = (value: unknown): string => sha(typeof value === 'string' ? value : canonical(value));

const globalChecks = [
  'assembly-solver', 'assembly-dof', 'assembly-static-interference', 'assembly-motion', 'assembly-exact-evidence',
  'load-life', 'alignment', 'service-clearance', 'guard-safety', 'tolerance-stack', 'dfm',
  'model-drawing-bom', 'inspection-coverage',
];

function checks(model: ReturnType<typeof buildMotorGearboxDriveModuleModel>): MechanicalCheckReceipt[] {
  const contract = model.contract;
  const ids = [
    ...globalChecks,
    ...contract.parts.flatMap((part) => [`part:${part.id}:feature-tree`, `part:${part.id}:exact-brep`, `part:${part.id}:topology`, `part:${part.id}:step-roundtrip`]),
  ];
  return ids.map((checkId) => {
    const part = contract.parts.find((candidate) => checkId === `part:${candidate.id}:feature-tree`);
    return {
      schema: MECHANICAL_CHECK_RECEIPT_SCHEMA, checkId, status: 'PASS',
      sourceRevision: contract.identity.revision, inputSha256: contract.identity.contentSha256,
      resultSha256: part?.geometryHash ?? sha(checkId), validatorId: `independent-${checkId.replaceAll(':', '-')}`,
      validatorVersion: '1.0.0', issuedAt: '2026-08-24T00:00:00Z',
    };
  });
}

function makeInput(overrides: Partial<MechanicalProductPipelineInput> = {}): MechanicalProductPipelineInput {
  const model = buildMotorGearboxDriveModuleModel();
  const step = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
  const modelHash = payloadSha(model);
  const nativeProject = {
    schema: 'nexyfab.mechanical.native-project.v1', projectId: 'mechanical-project-001',
    productId: model.contract.identity.id, sourceRevision: model.contract.identity.revision,
    contractSha256: model.contract.identity.contentSha256, modelSha256: modelHash,
  };
  const values: Record<string, unknown> = {
    'native-project': nativeProject, step, 'part-drawings': { drawing: 'original-part-drawing-set' },
    'assembly-drawing': { drawing: 'original-assembly-drawing' }, bom: { rows: ['base', 'shaft'] },
    'tolerance-inspection-report': { report: 'original-inspection-plan' },
    'dfm-report': { report: 'original-dfm-review-input' },
    'assembly-verification-receipt': { receipt: 'original-assembly-receipt' },
  };
  const manifest = createMechanicalDriveModuleDeliverableManifest({
    projectRevision: model.contract.identity.revision, modelContentHash: modelHash,
    generatedAt: '2026-08-24T00:00:00.000Z',
    deliverables: MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS.map((kind) => ({
      id: `drive-${kind}`, kind,
      format: ({ 'native-project': 'json', step: 'step', 'part-drawings': 'drawing', 'assembly-drawing': 'drawing', bom: 'bom', 'tolerance-inspection-report': 'pdf', 'dfm-report': 'pdf', 'assembly-verification-receipt': 'json' } as const)[kind],
      contentSha256: payloadSha(values[kind]), byteLength: 100, sourceRevision: model.contract.identity.revision,
      generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' as const,
    })),
  });
  return {
    projectId: 'mechanical-project-001',
    authorityContext: { projectId: 'mechanical-project-001', projectRevisionSha256: 'a'.repeat(64), sourceRevisionSha256: 'b'.repeat(64) },
    authorityManifest: undefined, contract: model.contract, model, nativeProject, step,
    deliverableManifest: manifest, deliverableContents: values, checks: checks(model), independentStep: {
      status: 'PASS', sourceRevision: model.contract.identity.revision, inputSha256: payloadSha(step), importedSha256: sha('imported-step'),
      validatorId: 'independent-occt-step', validatorVersion: '1.0.0', independent: true as const,
    }, claimedState: 'PRODUCT_QUALIFIED', issuedAt: '2026-08-24T00:00:00Z', ...overrides,
  };
}

describe('mechanical product pipeline', () => {
  it('recomputes current hashes and keeps one synthetic drive-module case below product qualification', () => {
    const input = makeInput();
    const result = runMechanicalProductPipeline(input);
    expect(result.hashes.contractSha256).toBe(input.contract && (result.mechanicalQualification?.contractSha256 ?? null));
    expect(result.hashes.modelSha256).toBe(payloadSha(input.model));
    expect(result.hashes.stepSha256).toBe(payloadSha(input.step));
    expect(result.productReceiptPromotionReady).toBe(false);
    expect(result.status).toBe('HOLD');
    expect(result.commonQualification?.evaluation.status).toBe('HOLD');
    expect(result.commonQualification?.evaluation.blockers).toEqual(expect.arrayContaining([
      'current_blocker:authority:manifest:manifest:not_an_object',
      'validation_axis_case_count:geometry',
      'campaign_count_below_three',
      'independent_review_count_below_two',
      'pilot_count_below_three',
    ]));
  });

  it('fails closed when current model or STEP bytes diverge from declared deliverables', () => {
    const input = makeInput();
    const result = runMechanicalProductPipeline({ ...input, step: `${input.step}tampered` });
    expect(result.status).toBe('FAIL');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'deliverables:step_hash_mismatch', 'step:independent_input_hash_mismatch',
    ]));

    const model = structuredClone(input.model as object) as typeof input.model;
    const firstPartId = Object.keys((model as { featureTrees: Record<string, unknown> }).featureTrees)[0]!;
    (model as { featureTrees: Record<string, unknown> }).featureTrees[firstPartId] = { nodes: [] };
    const modelResult = runMechanicalProductPipeline({ ...input, model });
    expect(modelResult.status).toBe('FAIL');
    expect(modelResult.blockers).toEqual(expect.arrayContaining([`model:feature_tree_hash_mismatch:${firstPartId}`]));

    const nativeResult = runMechanicalProductPipeline({ ...input, nativeProject: { schema: 'nexyfab.mechanical.native-project.v1' } });
    expect(nativeResult.status).toBe('FAIL');
    expect(nativeResult.blockers).toContain('native_project:keys_invalid');
  });

  it('requires load/life, DFM, drawing, independent STEP, campaigns, reviews, and fabrication pilots', () => {
    const input = makeInput({
      checks: (makeInput().checks as MechanicalCheckReceipt[]).filter((check) => !['load-life', 'dfm', 'model-drawing-bom'].includes(check.checkId) && !check.checkId.endsWith(':step-roundtrip')),
      independentStep: undefined,
    });
    const result = runMechanicalProductPipeline(input);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'calculation:load_life_missing', 'calculation:dfm_missing', 'drawing:model_drawing_bom_missing',
      'step:independent_evidence_missing', 'step:independent_part_roundtrip_missing',
      'receipt:campaign_count_below_three', 'receipt:independent_review_count_below_two', 'receipt:pilot_count_below_three',
    ]));
  });
});
