#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PILOT_REL = 'docs/evidence/cad-independent/complex-reference-exchange-pilot-260809.json';
const ROBOT_REL = 'docs/evidence/ai-robot6axis-demonstrator-260809/report.json';
const EXECUTION_POLICY_REL = 'src/lib/ai/adaptiveComplexProductExecution.ts';
const OUTPUT_REL = 'docs/evidence/cad-independent/complex-product-scope-assessment.json';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readEvidence = (root, relative) => {
  const bytes = fs.readFileSync(path.join(root, ...relative.split('/')));
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
};

export function buildComplexProductScopeAssessment(root) {
  const pilot = readEvidence(root, PILOT_REL);
  const robot = readEvidence(root, ROBOT_REL);
  const executionPolicyBytes = fs.readFileSync(path.join(root, ...EXECUTION_POLICY_REL.split('/')));
  if (pilot.value.schemaVersion !== 1 || !Array.isArray(pilot.value.records)) throw new Error('COMPLEX_SCOPE_PILOT_SCHEMA_INVALID');
  if (robot.value.schema !== 'nexyfab.ai-complex-product-demonstrator.v1') throw new Error('COMPLEX_SCOPE_ROBOT_SCHEMA_INVALID');

  const families = pilot.value.records.map(record => {
    const assertions = Array.isArray(record.assertions) ? record.assertions : [];
    const counts = {
      pass: assertions.filter(item => item.status === 'pass').length,
      fail: assertions.filter(item => item.status === 'fail').length,
      notRun: assertions.filter(item => item.status === 'not_run').length,
    };
    const scope = record.status === 'pass' ? 'validated_exchange_pilot' : record.status === 'fail' ? 'blocked' : counts.pass > 0 ? 'partially_validated' : 'not_validated';
    return {
      scenarioId: record.scenarioId,
      sourceLabel: record.sourceLabel,
      sourceSha256: record.input?.sha256 ?? null,
      format: record.input?.extension ?? null,
      importer: record.importer,
      status: record.status,
      scope,
      assertions: counts,
      unresolvedAssertions: assertions.filter(item => item.status !== 'pass').map(item => ({ assertion: item.assertion, status: item.status, reason: item.reason })),
    };
  });
  const totals = {
    families: families.length,
    validatedExchangePilots: families.filter(item => item.scope === 'validated_exchange_pilot').length,
    partiallyValidated: families.filter(item => item.scope === 'partially_validated').length,
    blocked: families.filter(item => item.scope === 'blocked').length,
    notValidated: families.filter(item => item.scope === 'not_validated').length,
  };
  const robotProduct = robot.value.product ?? {};
  const robotAssembly = robot.value.assembly ?? {};
  const robotBlockers = Array.isArray(robot.value.blockers) ? robot.value.blockers : [];
  const broadSelfServiceEligible = families.every(item => item.status === 'pass') && robot.value.releaseReady === true;

  return {
    schema: 'nexyfab.complex-product-scope-assessment.v1',
    assessedAt: [pilot.value.generatedAt, robot.value.generatedAt].filter(Boolean).sort().at(-1) ?? null,
    sources: [
      { path: PILOT_REL, sha256: sha256(pilot.bytes) },
      { path: ROBOT_REL, sha256: sha256(robot.bytes) },
      { path: EXECUTION_POLICY_REL, sha256: sha256(executionPolicyBytes) },
    ],
    externalCadInstallationRequired: false,
    platformExecutionContract: {
      objective: 'complete_manufacturing_product',
      aiIsDefaultExecutor: true,
      aiDraftOnly: false,
      precisionCadIsConditional: true,
      generalUserWorkflow: 'ai_guided',
      precisionCadForGeneralUsers: 'ai_managed',
      expertUserWorkflow: 'ai_or_manual_precision',
      expertPrecisionWorkspaceAvailable: true,
      expertPrecisionWorkspaceRequired: false,
      manualAdjustmentDuringAiWorkflow: true,
      exactManualParameterEntry: true,
      userLockedValuesOverrideLaterAiChanges: true,
      manualValuesPreservedToExpertHandoff: true,
      modelReportedConfidenceIsSufficient: false,
      serverValidatedProductPlan: true,
      requirementToPartTraceRequired: true,
      authoritativeInputsRequiredBeforeExactGeometry: true,
      assemblyMateConnectivityRequired: true,
      repeatedDefinitionsMustRemainIdentical: true,
      inventedEvidenceReferencesRejected: true,
      precisionCadEntryReasons: ['exact_geometry', 'topology', 'assembly', 'motion_collision_clearance', 'step_roundtrip', 'bounded_ai_repair_exhausted'],
      authoritativeFactsAreRequestedNotInvented: true,
      expertReleaseReviewSeparatedFromDesignCompletion: true,
    },
    decision: {
      scopedClosedBetaPilotEligible: totals.validatedExchangePilots >= 4 && totals.blocked === 0,
      broadComplexProductSelfServiceEligible: broadSelfServiceEligible,
      manufacturingReleaseGuaranteed: false,
      failClosed: true,
      statement: broadSelfServiceEligible
        ? 'All governed complex-product evidence is complete for the assessed scope.'
        : 'Only explicitly passed families are validated; partial and not-run assertions must not be marketed as supported or manufacturing-ready.',
    },
    referencePilot: { totals, families },
    internalRobot: {
      classification: robotProduct.classification ?? null,
      editableParts: robotProduct.editableParts ?? null,
      mates: robotProduct.mates ?? null,
      rankDoF: robotAssembly.certificate?.rankDoF ?? null,
      allowedDoF: robotAssembly.certificate?.allowedDoF ?? null,
      preciseInterferences: robotAssembly.flaggedInterferences ?? null,
      unresolvedCatalogComponents: robotProduct.unresolvedCatalogComponents ?? null,
      releaseReady: robot.value.releaseReady === true,
      blockers: robotBlockers,
      requiredNextEvidence: [
        'traceable_component_catalog_and_housing_fit',
        'collision_free_full_motion_reverification',
        'nexyfab_exact_cad_signed_evidence',
        'signed_manufacturing_validation',
        'independent_dual_expert_final_review',
      ],
    },
    invariants: {
      referenceFilesModified: false,
      closedBetaRecordsModified: false,
      unsupportedAssertionsConvertedToPass: false,
      releaseExecuted: false,
    },
  };
}

const render = value => `${JSON.stringify(value, null, 2)}\n`;
export function checkOrWriteComplexProductScopeAssessment({ root, write }) {
  const output = path.join(root, ...OUTPUT_REL.split('/'));
  const expected = render(buildComplexProductScopeAssessment(root));
  if (write) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, expected);
    return { ok: true, output: OUTPUT_REL };
  }
  const actual = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  return { ok: actual === expected, output: OUTPUT_REL, error: actual === expected ? null : 'COMPLEX_PRODUCT_SCOPE_ASSESSMENT_STALE' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkOrWriteComplexProductScopeAssessment({ root: process.cwd(), write: process.argv.includes('--write') });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
