import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildComplexProductScopeAssessment,
  canonicalText,
  canonicalTextSha256,
} from './build-complex-product-scope-assessment.mjs';

test('complex-product evidence text is stable across LF and CRLF checkouts', () => {
  const lf = '{\n  "status": "pass"\n}\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(canonicalText(crlf), lf);
  assert.equal(canonicalTextSha256(crlf), canonicalTextSha256(lf));
});

test('complex-product scope evidence stays fail-closed and CAD-independent', () => {
  const result = buildComplexProductScopeAssessment(process.cwd());
  assert.equal(result.externalCadInstallationRequired, false);
  assert.equal(result.platformExecutionContract.objective, 'complete_manufacturing_product');
  assert.equal(result.platformExecutionContract.aiDraftOnly, false);
  assert.equal(result.platformExecutionContract.precisionCadIsConditional, true);
  assert.equal(result.platformExecutionContract.generalUserWorkflow, 'ai_guided');
  assert.equal(result.platformExecutionContract.precisionCadForGeneralUsers, 'ai_managed');
  assert.equal(result.platformExecutionContract.expertUserWorkflow, 'ai_or_manual_precision');
  assert.equal(result.platformExecutionContract.expertPrecisionWorkspaceAvailable, true);
  assert.equal(result.platformExecutionContract.expertPrecisionWorkspaceRequired, false);
  assert.equal(result.platformExecutionContract.manualAdjustmentDuringAiWorkflow, true);
  assert.equal(result.platformExecutionContract.exactManualParameterEntry, true);
  assert.equal(result.platformExecutionContract.userLockedValuesOverrideLaterAiChanges, true);
  assert.equal(result.platformExecutionContract.manualValuesPreservedToExpertHandoff, true);
  assert.equal(result.platformExecutionContract.modelReportedConfidenceIsSufficient, false);
  assert.equal(result.platformExecutionContract.serverValidatedProductPlan, true);
  assert.equal(result.platformExecutionContract.requirementToPartTraceRequired, true);
  assert.equal(result.platformExecutionContract.authoritativeInputsRequiredBeforeExactGeometry, true);
  assert.equal(result.platformExecutionContract.assemblyMateConnectivityRequired, true);
  assert.equal(result.platformExecutionContract.repeatedDefinitionsMustRemainIdentical, true);
  assert.equal(result.platformExecutionContract.inventedEvidenceReferencesRejected, true);
  assert.equal(result.referencePilot.totals.families, 8);
  assert.equal(result.referencePilot.totals.validatedExchangePilots, 4);
  assert.equal(result.referencePilot.totals.partiallyValidated, 4);
  assert.equal(result.referencePilot.totals.blocked, 0);
  assert.equal(result.decision.scopedClosedBetaPilotEligible, true);
  assert.equal(result.decision.broadComplexProductSelfServiceEligible, false);
  assert.equal(result.decision.manufacturingReleaseGuaranteed, false);
  assert.equal(result.internalRobot.editableParts, 25);
  assert.equal(result.internalRobot.mates, 60);
  assert.equal(result.internalRobot.revision, 2);
  assert.equal(result.internalRobot.driveTopology, 'coaxial_parent_drive_output_link');
  assert.equal(result.internalRobot.rankDoF, 6);
  assert.equal(result.internalRobot.intendedContacts, 24);
  assert.equal(result.internalRobot.preciseInterferences, 0);
  assert.equal(result.internalRobot.exploratoryMotionAxes, 6);
  assert.equal(result.internalRobot.exploratoryMotionFrames, 156);
  assert.equal(result.internalRobot.exploratoryCheckedMotionFrames, 156);
  assert.equal(result.internalRobot.exploratoryCollisionFrames, 0);
  assert.equal(result.internalRobot.unresolvedCatalogComponents, 22);
  assert.equal(result.internalRobot.releaseReady, false);
  assert.ok(result.referencePilot.families.filter(item => item.scope === 'partially_validated').every(item => item.unresolvedAssertions.length > 0));
});
