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

const outputPath = path.resolve(root, valueAfter('--out', `validation-reports/robot-production-completion-audit-v2-${Date.now()}.json`));
const integrityPath = valueAfter('--integrity', 'validation-reports/closed-beta-integrity-260809-cad-independent-core.json');
const scopePath = 'docs/evidence/cad-independent/complex-product-scope-assessment.json';
const manifestPath = '.next/server/app-paths-manifest.json';
const requiredSources = [
  'src/lib/ai/robot/robotReleaseEvidenceAuditV2.ts',
  'src/lib/ai/robot/robotReleaseWorkPacketV2.ts',
  'src/lib/ai/robot/robotFinalReleaseReview.ts',
  'src/app/api/cad/v1/robot/release/work-packet/route.ts',
  'src/app/api/cad/v1/robot/release/audit/route.ts',
  'src/app/api/cad/v1/robot/release/final-review/route.ts',
];
for (const requiredPath of [integrityPath, scopePath, manifestPath, ...requiredSources]) {
  if (!fs.existsSync(path.join(root, requiredPath))) throw new Error(`Required evidence missing: ${requiredPath}`);
}

const integrity = readJson(integrityPath);
const scope = readJson(scopePath);
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
const closedBetaIntact = integrity.summary?.protectedTableCount === 17
  && integrity.summary?.protectedRowCount === 13
  && integrity.summary?.fileCount === 15
  && integrity.summary?.fileBytes === 15429420
  && sha256File('nexyfab.db') === 'e678f7957facbf783f42e261ea5cab14208f27d1a31f2d6e3a0af217775ebb11';
const internalPipelineVerified = Object.values(routeChecks).every(Boolean)
  && requiredSources.every(file => fs.statSync(path.join(root, file)).size > 0)
  && scope.externalCadInstallationRequired === false
  && closedBetaIntact;
const exactReleaseEvidenceComplete = exactCadEvidencePresent && manufacturingEvidencePresent && finalReviewPresent;
const objectiveComplete = internalPipelineVerified && exactReleaseEvidenceComplete;

const report = {
  schema: 'nexyfab.robot-production-completion-audit.v2',
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
    ...(!exactCadEvidencePresent ? ['nexyfab_exact_cad_signed_evidence_required'] : []),
    ...(!manufacturingEvidencePresent ? ['signed_manufacturing_validation_required'] : []),
    ...(!finalReviewPresent ? ['independent_final_dual_signoff_required'] : []),
  ],
  nextActions: objectiveComplete ? [] : [
    'Resolve the traceable catalog, housing, motion, and interference blockers for the exact robot revision.',
    'Run the integrated NexyFab exact-CAD checks and sign the evidence for the exact release target.',
    'Obtain signed manufacturing validation for the exact selected drive occurrences.',
    'Obtain distinct domain and independent reviewer signatures for the exact release target.',
    'Re-run this audit; release execution remains a separate explicitly authorized operation.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, output: relative(outputPath), objectiveComplete, status: report.status, blockers: report.blockers }));
