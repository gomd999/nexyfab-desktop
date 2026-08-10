import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { REQUIRED_TECHNICAL_CAPABILITIES, type RequiredTechnicalCapabilityId } from '../src/lib/cad-technical-release-audit-v3';
import {
  buildTechnicalPrivatePilotReadiness,
  type CapabilityEvidenceObservation,
  type TechnicalPrivatePilotCandidateInput,
} from '../src/lib/technicalPrivatePilotReadiness';

const root = process.cwd();
const baselinePath = resolve(root, process.env.CLOSED_BETA_BASELINE ?? 'validation-reports/closed-beta-integrity-260809-commercial-v1-baseline.json');
const currentPath = resolve(root, process.env.CLOSED_BETA_CURRENT ?? 'validation-reports/closed-beta-integrity-260810-active-master-wp9-security-final.json');
const referencePath = resolve(root, 'docs/evidence/cad-independent/reference-utilization-manifest-260809.json');
const outputPath = resolve(root, process.env.TECHNICAL_PILOT_CANDIDATE_OUT ?? 'docs/evidence/release/technical-private-pilot-candidate-260810.json');
const auditOutputPath = resolve(root, process.env.TECHNICAL_PILOT_AUDIT_OUT ?? 'docs/evidence/release/cad-technical-release-audit-v3-candidate-260810.json');

type Snapshot = {
  source?: { readonly?: boolean; databasePathSha256?: string };
  tables?: Record<string, { columns?: string[]; rowCount?: number; contentSha256?: string }>;
  files?: Array<{ relativePath: string; pathSha256?: string; size?: number; contentSha256?: string }>;
};

const sourceSets: Record<RequiredTechnicalCapabilityId, string[]> = {
  'ai-complex-product': [
    'docs/evidence/ai-robot6axis-demonstrator-260809/report.json',
    'docs/evidence/fea/multibody-contact-260810.json',
  ],
  'manual-parametric-editing': ['docs/evidence/workspace/design-workspace-revision-260810.json'],
  'expert-precision-cad': [
    'docs/evidence/workspace/design-workspace-revision-260810.json',
    'docs/evidence/topology-survival-260806/run-8.json',
  ],
  'assembly-motion': [
    'docs/evidence/joint-motion-clearance-260807/specimen-run-1.json',
    'docs/evidence/ai-robot6axis-demonstrator-260809/report.json',
  ],
  'continuous-collision': [
    'docs/evidence/external-step-structure-coverage-260806/ifc-collision-capability-run-1.json',
    'docs/evidence/fea/multibody-contact-260810.json',
  ],
  'step-exchange': [
    'docs/evidence/step-body-membership-260806/run-1.json',
    'docs/evidence/scad-native-step-assembly-260806/run-5.json',
  ],
  'drawing-bom-manufacturing': [
    'docs/evidence/bim-guideline/ifc-deep-roundtrip-260810.json',
    'docs/evidence/fea/multibody-contact-260810.json',
  ],
};

async function bytes(path: string): Promise<Buffer> {
  return readFile(resolve(root, path));
}

async function digestPath(path: string): Promise<string> {
  return createHash('sha256').update(await bytes(path)).digest('hex');
}

async function digestBundle(paths: string[]): Promise<string> {
  const entries = await Promise.all([...paths].sort().map(async path => `${path}\0${await digestPath(path)}`));
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

function snapshotDifferences(before: Snapshot, after: Snapshot): { tableDiff: number; fileDiff: number; reasons: string[] } {
  const reasons: string[] = [];
  let tableDiff = 0;
  let fileDiff = 0;
  if (before.source?.readonly !== true || after.source?.readonly !== true) reasons.push('closed_beta_snapshot_not_readonly');
  if (before.source?.databasePathSha256 !== after.source?.databasePathSha256) reasons.push('closed_beta_database_path_changed');
  const beforeTables = before.tables ?? {};
  const afterTables = after.tables ?? {};
  for (const name of new Set([...Object.keys(beforeTables), ...Object.keys(afterTables)])) {
    if (JSON.stringify(beforeTables[name]) !== JSON.stringify(afterTables[name])) tableDiff += 1;
  }
  const index = (snapshot: Snapshot) => new Map((snapshot.files ?? []).map(file => [file.relativePath, file]));
  const beforeFiles = index(before);
  const afterFiles = index(after);
  for (const name of new Set([...beforeFiles.keys(), ...afterFiles.keys()])) {
    if (JSON.stringify(beforeFiles.get(name)) !== JSON.stringify(afterFiles.get(name))) fileDiff += 1;
  }
  if (tableDiff) reasons.push(`closed_beta_table_diff:${tableDiff}`);
  if (fileDiff) reasons.push(`closed_beta_file_diff:${fileDiff}`);
  return { tableDiff, fileDiff, reasons };
}

async function main(): Promise<void> {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as Snapshot;
  const current = JSON.parse(await readFile(currentPath, 'utf8')) as Snapshot;
  const reference = JSON.parse(await readFile(referencePath, 'utf8')) as {
    policy?: { sourceReadOnly?: boolean; sourceBytesCopied?: boolean; sourceArchivesExtractedInPlace?: boolean };
  };
  const closedBeta = snapshotDifferences(baseline, current);
  const referenceVerified = reference.policy?.sourceReadOnly === true
    && reference.policy.sourceBytesCopied === false
    && reference.policy.sourceArchivesExtractedInPlace === false;

  const capabilities = {} as Record<RequiredTechnicalCapabilityId, CapabilityEvidenceObservation>;
  for (const id of Object.keys(REQUIRED_TECHNICAL_CAPABILITIES) as RequiredTechnicalCapabilityId[]) {
    capabilities[id] = {
      maturity: 'code_verified',
      evidenceSha256: await digestBundle(sourceSets[id]),
      samples: 0,
      passed: 0,
      independentHoldout: false,
      limitations: ['Local deterministic evidence exists but is not an approved independent holdout campaign.'],
      reasons: [`collect_approved_independent_holdout:${id}`],
    };
  }

  const generationSources = [
    'src/lib/ai/generationStateStore.ts',
    'src/lib/ai/productDecompositionAccuracy.ts',
    'src/lib/ai/designWorkspaceRevision.ts',
  ];
  const operationSources = [
    'docs/evidence/release/dependency-security-audit-260810.json',
    'src/lib/technicalCanaryPolicy.ts',
    'scripts/verify-backup-restore.mjs',
    'scripts/verify-rollback-target.mjs',
    'scripts/perf-benchmark.mjs',
  ];
  const input: TechnicalPrivatePilotCandidateInput = {
    releaseId: process.env.TECHNICAL_RELEASE_ID ?? '2026.08.10-technical-candidate',
    closedBeta: {
      maturity: closedBeta.tableDiff === 0 && closedBeta.fileDiff === 0 && closedBeta.reasons.length === 0 ? 'verified' : 'blocked',
      evidenceSha256: await digestPath(currentPath),
      tableDiff: closedBeta.tableDiff,
      fileDiff: closedBeta.fileDiff,
      reasons: closedBeta.reasons,
    },
    referenceCorpus: {
      maturity: referenceVerified ? 'verified' : 'blocked',
      evidenceSha256: await digestPath(referencePath),
      sourceWrites: referenceVerified ? 0 : 1,
      reasons: referenceVerified ? [] : ['reference_corpus_read_only_policy_failed'],
    },
    generationState: {
      ownerIsolation: 'code_verified',
      compareAndSwap: 'code_verified',
      durableProductionStore: 'not_run',
      browserCannotRecordPassedStages: 'code_verified',
      evidenceSha256: await digestBundle(generationSources),
      reasons: ['production_redis_cas_receipt_missing', 'multi_instance_resume_drill_missing'],
    },
    generationAccuracy: {
      deepSchemaValidation: 'code_verified',
      trustedEvidenceBinding: 'code_verified',
      numericParameterCoverage: 0,
      missingInputFailsClosed: 'code_verified',
      localRepairPreservesLockedParameters: 'code_verified',
      evidenceSha256: await digestBundle(generationSources),
      reasons: ['approved_holdout_numeric_parameter_provenance_missing'],
    },
    capabilities,
    operations: {
      rollback: 'code_verified',
      canary: 'dry_run',
      monitoring: 'code_verified',
      workerResume: 'code_verified',
      performanceBudget: 'code_verified',
      evidenceSha256: await digestBundle(operationSources),
      reasons: [
        'staging_rollback_receipt_missing',
        'production_like_canary_windows_missing',
        'monitor_alert_delivery_receipt_missing',
        'production_worker_resume_receipt_missing',
        'production_like_load_budget_receipt_missing',
      ],
    },
    // The existing five-domain directories are explicitly DRYRUN fixtures.
    // They prove the machinery, not commercial accuracy, and therefore remain excluded.
    domainEvidence: {},
  };

  const report = buildTechnicalPrivatePilotReadiness(input);
  const sourceArtifacts = Object.fromEntries((await Promise.all([
    baselinePath,
    currentPath,
    referencePath,
    ...generationSources.map(path => resolve(root, path)),
    ...operationSources.map(path => resolve(root, path)),
    ...Object.values(sourceSets).flat().map(path => resolve(root, path)),
  ].map(async absolutePath => [absolutePath.slice(root.length + 1).replaceAll('\\', '/'), await digestPath(absolutePath)] as const)))
    .sort(([a], [b]) => a.localeCompare(b)));
  const output = {
    ...report,
    generatedAt: new Date().toISOString(),
    evidencePolicy: {
      localTestsMayProveImplementationButNotIndependentAccuracy: true,
      dryRunsMayNotCertifyRelease: true,
      sourceCorpusReadOnly: true,
      endUserExternalCadRequired: false,
      noAutomaticReleaseMutation: true,
    },
    sourceArtifacts,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await writeFile(auditOutputPath, `${JSON.stringify(report.audit, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output: outputPath, auditOutput: auditOutputPath, decision: report.decision, auditIssues: report.auditIssues.length, domainVerified: report.domains.filter(item => item.status === 'verified').length, closedBeta: report.evidenceMaturity.closedBeta, referenceCorpus: report.evidenceMaturity.referenceCorpus }, null, 2)}\n`);
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
