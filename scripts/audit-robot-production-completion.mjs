#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const relative = value => path.relative(root, value).replaceAll('\\', '/');
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const sha256File = relativePath => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex');

const outputPath = path.resolve(root, valueAfter('--out', `validation-reports/robot-production-completion-audit-v3-${Date.now()}.json`));
const integrityPath = valueAfter('--integrity', 'validation-reports/closed-beta-integrity-260809-cad-independent-core.json');
const scopePath = 'docs/evidence/cad-independent/complex-product-scope-assessment.json';
const conceptReportPath = 'docs/evidence/ai-robot6axis-demonstrator-260809/report.json';
const manifestPath = '.next/server/app-paths-manifest.json';
const requiredSources = [
  'src/lib/ai/robot/robotReleaseEvidenceAuditV2.ts',
  'src/lib/ai/robot/robotReleaseWorkPacketV2.ts',
  'src/lib/ai/robot/robotFinalReleaseReview.ts',
  'src/app/api/cad/v1/robot/release/work-packet/route.ts',
  'src/app/api/cad/v1/robot/release/audit/route.ts',
  'src/app/api/cad/v1/robot/release/final-review/route.ts',
];
for (const requiredPath of [integrityPath, scopePath, conceptReportPath, manifestPath, ...requiredSources]) {
  if (!fs.existsSync(path.join(root, requiredPath))) throw new Error(`Required evidence missing: ${requiredPath}`);
}

const integrity = readJson(integrityPath);
const scope = readJson(scopePath);
const concept = readJson(conceptReportPath);
const conceptArtifactPath = path.join(path.dirname(conceptReportPath), String(concept.product?.programArtifact ?? ''));
const routes = Object.keys(readJson(manifestPath));
const requiredRoutes = [
  '/api/cad/v1/robot/release/work-packet/route',
  '/api/cad/v1/robot/release/audit/route',
  '/api/cad/v1/robot/release/final-review/route',
];
const routeChecks = Object.fromEntries(requiredRoutes.map(route => [route, routes.includes(route)]));

const evidenceSchemas = new Set([
  'nexyfab.robot-exact-cad-evidence.v1',
  'nexyfab.robot-manufacturing-validation.v1',
  'nexyfab.robot-final-release-review.v1',
]);
const evidenceFiles = [];
for (const searchRoot of ['validation-reports', 'docs/evidence']) {
  const pending = [path.join(root, searchRoot)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const value = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if (evidenceSchemas.has(value?.schema)) evidenceFiles.push({ path: relative(fullPath), schema: value.schema, sha256: sha256File(relative(fullPath)) });
        } catch { /* malformed JSON cannot be evidence */ }
      }
    }
  }
}

const exactCadEvidencePresent = evidenceFiles.some(file => file.schema === 'nexyfab.robot-exact-cad-evidence.v1');
const manufacturingEvidencePresent = evidenceFiles.some(file => file.schema === 'nexyfab.robot-manufacturing-validation.v1');
const finalReviewPresent = evidenceFiles.some(file => file.schema === 'nexyfab.robot-final-release-review.v1');
const conceptDiagnosticVerified = fs.existsSync(path.join(root, conceptArtifactPath))
  && concept.schema === 'nexyfab.ai-complex-product-demonstrator.v1'
  && concept.product?.family === 'robot'
  && concept.product?.revision === 2
  && concept.product?.driveTopology === 'coaxial_parent_drive_output_link'
  && concept.product?.editableParts === 25
  && concept.product?.mates === 60
  && concept.product?.unresolvedCatalogComponents === 22
  && concept.product?.classification === 'concept_only'
  && /^[a-f0-9]{64}$/.test(concept.product?.programSha256 ?? '')
  && sha256File(conceptArtifactPath) === concept.product.programSha256
  && concept.assembly?.releaseReady === false
  && concept.assembly?.releaseContactCount === 24
  && concept.assembly?.flaggedInterferences === 0
  && concept.assembly?.certificate?.rankDoF === 6
  && concept.assembly?.certificate?.dofAccepted === true
  && concept.assembly?.certificate?.intendedContactsDocumented === true
  && concept.motionStudy?.allConverged === true
  && concept.motionStudy?.axisCount === 6
  && concept.motionStudy?.frameCount === 156
  && concept.motionStudy?.checkedFrames === 156
  && concept.motionStudy?.collisionFrameCount === 0
  && Array.isArray(concept.motionStudy?.axes)
  && concept.motionStudy.axes.length === 6
  && concept.motionStudy.axes.every((axis, index) => axis.mateId === `J${index + 1}`
    && axis.frameCount === 26 && axis.checkedFrames === 26
    && axis.collisionFrameCount === 0 && axis.allConverged === true)
  && concept.motionStudy?.releaseEvidence === false
  && concept.releaseReady === false
  && concept.policy?.placeholdersAreManufacturingEvidence === false
  && concept.policy?.expertApprovalGranted === false;
const closedBetaIntact = integrity.summary?.protectedTableCount === 17
  && integrity.summary?.protectedRowCount === 13
  && integrity.summary?.fileCount === 15
  && integrity.summary?.fileBytes === 15429420
  && sha256File('nexyfab.db') === 'e678f7957facbf783f42e261ea5cab14208f27d1a31f2d6e3a0af217775ebb11';
const internalPipelineVerified = Object.values(routeChecks).every(Boolean)
  && requiredSources.every(file => fs.statSync(path.join(root, file)).size > 0)
  && scope.externalCadInstallationRequired === false
  && conceptDiagnosticVerified
  && closedBetaIntact;
const exactReleaseEvidenceComplete = exactCadEvidencePresent && manufacturingEvidencePresent && finalReviewPresent;
const objectiveComplete = internalPipelineVerified && exactReleaseEvidenceComplete;

const report = {
  schema: 'nexyfab.robot-production-completion-audit.v3',
  generatedAt: new Date().toISOString(),
  objectiveComplete,
  status: objectiveComplete ? 'complete' : 'blocked_exact_release_evidence',
  productBoundary: {
    externalCadInstallationRequired: false,
    proprietaryCadWorkersRequired: false,
    nexyFabIntegratedKernelRequired: true,
    releaseExecutionImplemented: false,
  },
  internal: {
    pipelineVerified: internalPipelineVerified,
    releaseRoutes: routeChecks,
    complexScopeAssessment: { path: scopePath, sha256: sha256File(scopePath), broadSelfServiceEligible: scope.decision?.broadComplexProductSelfServiceEligible === true },
    conceptDiagnostic: {
      verified: conceptDiagnosticVerified,
      path: conceptReportPath,
      sha256: sha256File(conceptReportPath),
      revision: concept.product?.revision ?? null,
      programSha256: concept.product?.programSha256 ?? null,
      driveTopology: concept.product?.driveTopology ?? null,
      unresolvedCatalogComponents: concept.product?.unresolvedCatalogComponents ?? null,
      rankDoF: concept.assembly?.certificate?.rankDoF ?? null,
      documentedContacts: concept.assembly?.releaseContactCount ?? null,
      preciseInterferences: concept.assembly?.flaggedInterferences ?? null,
      exploratoryMotionFrames: concept.motionStudy?.frameCount ?? null,
      exploratoryCheckedMotionFrames: concept.motionStudy?.checkedFrames ?? null,
      exploratoryMotionAxes: concept.motionStudy?.axisCount ?? null,
      exploratoryCollisionFrames: concept.motionStudy?.collisionFrameCount ?? null,
      classification: concept.product?.classification ?? null,
      releaseReady: concept.releaseReady === true,
    },
  },
  closedBeta: {
    intact: closedBetaIntact,
    snapshot: integrityPath,
    snapshotSha256: sha256File(integrityPath),
    protectedTableCount: integrity.summary?.protectedTableCount,
    protectedRowCount: integrity.summary?.protectedRowCount,
    fileCount: integrity.summary?.fileCount,
    fileBytes: integrity.summary?.fileBytes,
    databaseSha256: sha256File('nexyfab.db'),
  },
  exactReleaseEvidence: {
    nexyFabExactCadEvidencePresent: exactCadEvidencePresent,
    manufacturingEvidencePresent,
    finalDualSignoffPresent: finalReviewPresent,
    discoveredEvidenceFiles: evidenceFiles,
  },
  blockers: objectiveComplete ? [] : [
    ...(concept.product?.unresolvedCatalogComponents > 0 ? ['traceable_robot_component_catalog_required'] : []),
    ...(concept.housingFit?.status !== 'passed' ? ['traceable_housing_fit_evidence_required'] : []),
    ...(concept.blockers?.includes('signed_governed_motion_release_evidence_required') ? ['signed_governed_motion_release_evidence_required'] : []),
    ...(!exactCadEvidencePresent ? ['nexyfab_exact_cad_signed_evidence_required'] : []),
    ...(!manufacturingEvidencePresent ? ['signed_manufacturing_validation_required'] : []),
    ...(!finalReviewPresent ? ['independent_final_dual_signoff_required'] : []),
  ],
  nextActions: objectiveComplete ? [] : [
    'Supply the traceable motor, reducer, bearing, brake, encoder, harness, and tool-connector catalog artifacts for the exact revision.',
    'Validate the selected drive envelopes against traceable housing capacities, integrate them into a new revision, and repeat the signed 156-frame governed motion check.',
    'Run the integrated NexyFab exact-CAD checks and sign the evidence for the exact release target.',
    'Obtain signed manufacturing validation for the exact selected drive occurrences.',
    'Obtain distinct domain and independent reviewer signatures for the exact release target.',
    'Re-run this audit; release execution remains a separate explicitly authorized operation.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, output: relative(outputPath), objectiveComplete, status: report.status, blockers: report.blockers }));
