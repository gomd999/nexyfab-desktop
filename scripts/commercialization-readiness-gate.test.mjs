import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { authenticatedE2EReceiptEligible, closedBetaIntegrityReceiptEligible, enterpriseSsoReadinessStatus, evaluateCommercializationReadiness, expertReviewReceiptEligible, expertReviewSignoffPayload, largeUploadStagingReadinessStatus, liveSmokeReceiptEligible, productReleaseScopeFor, productionMigrationReceiptEligible, productionProtectedStateReceiptEligible, releaseContractFor, resourceBaselineReceiptEligible, restoreReceiptEligible, sevenDayOperationsReceiptEligible, syntheticCampaignReceiptEligible, windowsSeaReleaseStatus } from './commercialization-readiness-gate.mjs';
import { buildCommercialSyntheticCampaignReceipt } from './build-commercial-synthetic-campaign-receipt.mjs';
import { buildRailwayResourceBaseline } from './build-railway-resource-baseline-v2.mjs';
import { buildOpenScadHttpSmokeReceipt } from './build-openscad-http-smoke-v2.mjs';
import { buildRailwayStagingIsolationEvidenceV2 } from './build-railway-staging-isolation-evidence-v2.mjs';
import { buildCommercialSecurityEvidenceReceipt, SECURITY_SOURCE_SPECS } from './build-commercial-security-evidence-receipt-v2.mjs';
import { attachReceiptSha256, sha256 } from './immutable-receipt-binding.mjs';
import { SPECIALTY_RELEASE_CHANNELS, SPECIALTY_RELEASE_REVIEW_ROLES, attachSpecialtyIndependentReleaseReceiptSha256, specialtyIndependentReleaseCanonical, specialtyIndependentReleaseSha256, specialtyIndependentReleaseTargetSha256, specialtyIndependentReviewerPayload } from './verify-specialty-independent-release-receipt.mjs';
import { writeArchitectureInteriorRecoveryEvidence } from '../e2e/architecture-interior-recovery-evidence.mjs';
import { buildReadinessReceipt } from './agent-sidecar/windows-sea-readiness.mjs';
import {
  AUTHENTICODE_RESULT_SCHEMA,
  INSTALLER_EVIDENCE_SCHEMA,
  PARITY_EVIDENCE_SCHEMA,
  RELEASE_ATTESTATION_SCHEMA,
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_SOURCE_PATHS,
  SIGNING_EVIDENCE_SCHEMA,
  VM_PROVIDER_ATTESTATION_SCHEMA,
  VM_STAGE_OBSERVATION_SCHEMA,
  buildWindowsSeaReleaseReceipt,
  canonicalJson,
  fileBinding as windowsSeaFileBinding,
} from './agent-sidecar/windows-sea-release-evidence.mjs';
import {
  LARGE_UPLOAD_MIN_BYTES, buildLargeUploadStagingReadinessReceipt,
  largeUploadCollectorAttestationPayload, largeUploadFileBinding,
} from './build-large-upload-staging-readiness-receipt.mjs';
import {
  DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH,
  ENTERPRISE_SSO_CASE_SCHEMA, ENTERPRISE_SSO_CASE_SPECS, ENTERPRISE_SSO_COLLECTOR_ALLOWLIST_SCHEMA,
  ENTERPRISE_SSO_EVIDENCE_SCHEMA, ENTERPRISE_SSO_ISOLATION_SCHEMA,
  attachEvidenceSha256, buildEnterpriseSsoReadinessReceipt, enterpriseSsoCaseEvidenceRoot,
  enterpriseSsoCollectorAttestationPayload, fileBinding as enterpriseSsoFileBinding,
} from './build-enterprise-sso-readiness-receipt.mjs';

const domains = Object.fromEntries(['mechanical', 'building', 'civil', 'landscape', 'interior'].map(domain => [domain, {
  requiredCases: 20,
  approvedCases: 20,
  requiredIndependentReviewers: 2,
  independentReviewers: 2,
  releaseEligible: true,
  sourceReviewKit: { path: `${domain}-review-kit.json`, sha256: 'b'.repeat(64) },
  sourceReviewKitVerified: true,
}]));
const syntheticDomains = Object.fromEntries(['mechanical', 'building', 'civil', 'landscape', 'interior'].map(domain => [domain, {
  cases: 20, campaigns: 3, repeats: 5, runs: 300, gatePasses: 300,
}]));
const complexFamilies = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'machine_skid', 'welded_enclosure', 'interior'];
const complexHoldoutCases = complexFamilies.flatMap((family, familyIndex) => Array.from({ length: 20 }, (_, index) => ({
  schema: 'nexyfab.complex-benchmark-case.v2',
  caseId: `${family}-${index + 1}`,
  family,
  split: 'holdout',
  sourceHash: `${familyIndex}-${index}`.padEnd(64, 'a'),
  holdoutGroup: `${family}:independent-${index + 1}`,
  assertions: [{ id: 'geometry', required: true }],
})));
const complexGroundTruthValidation = {
  schema: 'nexyfab.complex-ground-truth-approval-validation.v1',
  summary: { cases: 160, records: 160, approved: 160, pending: 0, invalid: 0, rejected: 0, changesRequested: 0 },
  byFamily: Object.fromEntries(complexFamilies.map(family => [family, { cases: 20, approved: 20 }])),
  results: complexHoldoutCases.map(item => ({ caseId: item.caseId, family: item.family, status: 'approved', scoreEligible: true })),
};
const commercialMigrations = [
  2026082202, 2026082203, 2026082204, 2026082205, 2026082206, 2026082207, 2026082208,
  2026082301, 2026082401, 2026082402, 2026082403,
];
const expertCorpusHash = 'c'.repeat(64);
const expertRelease = { buildId: 'b', gitHead: '1'.repeat(40) };
const expertExpectedRelease = { buildId: 'b', head: expertRelease.gitHead };
const expertReviewers = [
  ['reviewer-a', 'domain-reviewer'],
  ['reviewer-b', 'independent-reviewer'],
].map(([reviewerId, role]) => ({ reviewerId, role, keys: generateKeyPairSync('ed25519') }));
const expertTrustedReviewers = Object.fromEntries(expertReviewers.map(({ reviewerId, role, keys }) => [reviewerId, {
  roles: [role],
  publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
}]));
const expertReviewReceiptBase = {
  schema: 'nexyfab.independent-domain-expert-review.v1',
  ok: true,
  releaseChannel: 'platform',
  release: expertRelease,
  generatedAt: new Date().toISOString(),
  holdoutCorpusSha256: expertCorpusHash,
};
const expertReviewSignoff = ({ reviewerId, role, keys }) => {
  const unsigned = { reviewerId, role, decision: 'approved', signedAt: expertReviewReceiptBase.generatedAt };
  return {
    ...unsigned,
    independentFromBuild: true,
    signature: sign(null, Buffer.from(expertReviewSignoffPayload(expertReviewReceiptBase, unsigned)), keys.privateKey).toString('base64'),
  };
};
const expertReviewReceipt = {
  ...expertReviewReceiptBase,
  reviewers: expertReviewers.map(expertReviewSignoff),
  summary: { cases: 100, dualApproved: 100, pending: 0, rejected: 0, changesRequested: 0 },
};
function rebindExpertReviewReceipt(releaseChannel) {
  const receipt = structuredClone(expertReviewReceipt);
  receipt.releaseChannel = releaseChannel;
  receipt.reviewers = receipt.reviewers.map(item => {
    const source = expertReviewers.find(candidate => candidate.reviewerId === item.reviewerId);
    const unsigned = { reviewerId: item.reviewerId, role: item.role, decision: item.decision, signedAt: item.signedAt };
    return { ...item, signature: sign(null, Buffer.from(expertReviewSignoffPayload(receipt, unsigned)), source.keys.privateKey).toString('base64') };
  });
  return receipt;
}
const releaseBinding = { buildId: 'b', deploymentId: 'd', gitHead: '1'.repeat(40) };
const expectedReleaseBinding = { buildId: 'b', deploymentId: 'd', head: releaseBinding.gitHead };
const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-commercial-gate-'));
const writeEvidence = (name, value) => {
  const target = path.join(evidenceRoot, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value)}\n`, 'utf8');
  return name;
};
const writeRawEvidence = (name, value) => {
  const target = path.join(evidenceRoot, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  fs.writeFileSync(target, bytes);
  return { path: name, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const writeBoundEvidence = (name, value) => {
  const binding = writeRawEvidence(name, value);
  return { ...binding, bytes: fs.statSync(path.join(evidenceRoot, name)).size };
};
const fixtureNow = Date.now();
const resourceSourcePath = writeEvidence('resource-source.json', {
  capturedAt: new Date(fixtureNow - 1_000).toISOString(),
  samples: [{ memoryMb: 420, limitMb: 8192 }, { memoryMb: 488, limitMb: 8192 }],
});
const resourceBaselineReceipt = buildRailwayResourceBaseline({
  root: evidenceRoot,
  sourcePath: resourceSourcePath,
  release: releaseBinding,
  generatedAt: new Date(fixtureNow).toISOString(),
  now: fixtureNow,
});
const syntheticCases = [];
const syntheticRuns = [];
for (const domain of Object.keys(syntheticDomains)) {
  for (let caseIndex = 1; caseIndex <= 20; caseIndex++) {
    const caseId = `${domain}-case-${caseIndex}`;
    const sourceHash = createHash('sha256').update(`${domain}:${caseIndex}`).digest('hex');
    syntheticCases.push({ caseId, domain, sourceHash, split: 'candidate' });
    for (let campaign = 1; campaign <= 3; campaign++) {
      for (let repeat = 1; repeat <= 5; repeat++) {
        syntheticRuns.push({ caseId, domain, sourceHash, campaign, repeat, usedForTuning: false, requiredGatesPassed: true });
      }
    }
  }
}
const syntheticSourcePath = writeEvidence('synthetic-source.json', { cases: syntheticCases });
const syntheticResultsPath = writeEvidence('synthetic-results.json', { results: syntheticRuns });
const syntheticCorpusPath = writeEvidence('synthetic-corpus.json', {
  schema: 'nexyfab.commercial-validation-corpus.v1',
  lanes: { synthetic: { cases: syntheticCases } },
});
const syntheticCampaignReceipt = buildCommercialSyntheticCampaignReceipt({
  root: evidenceRoot,
  sourcePath: syntheticSourcePath,
  resultPath: syntheticResultsPath,
  corpusPath: syntheticCorpusPath,
  release: releaseBinding,
  generatedAt: new Date(fixtureNow).toISOString(),
  now: fixtureNow,
});
const scopedSyntheticReceipts = new Map();
function scopedSyntheticCampaignReceipt(requiredDomains) {
  const key = [...requiredDomains].sort().join('-');
  if (scopedSyntheticReceipts.has(key)) return scopedSyntheticReceipts.get(key);
  const selectedCases = syntheticCases.filter(item => requiredDomains.includes(item.domain));
  const selectedRuns = syntheticRuns.filter(item => requiredDomains.includes(item.domain));
  const sourcePath = writeEvidence(`synthetic-source-${key}.json`, { cases: selectedCases });
  const resultPath = writeEvidence(`synthetic-results-${key}.json`, { results: selectedRuns });
  const corpusPath = writeEvidence(`synthetic-corpus-${key}.json`, {
    schema: 'nexyfab.commercial-validation-corpus.v1',
    lanes: { synthetic: { cases: selectedCases } },
  });
  const receipt = buildCommercialSyntheticCampaignReceipt({
    root: evidenceRoot,
    sourcePath,
    resultPath,
    corpusPath,
    release: releaseBinding,
    requiredDomains,
    generatedAt: new Date(fixtureNow).toISOString(),
    now: fixtureNow,
  });
  scopedSyntheticReceipts.set(key, receipt);
  return receipt;
}
const openscadBytes = Buffer.alloc(134);
openscadBytes.write('NexyFab gate fixture', 0, 'ascii');
openscadBytes.writeUInt32LE(1, 80);
const openscadArtifact = writeRawEvidence('artifacts/openscad-gate.stl', openscadBytes);
const openscadHttpSmokeReceipt = buildOpenScadHttpSmokeReceipt({
  root: evidenceRoot,
  artifactPath: openscadArtifact.path,
  request: { scad: 'cube([2,3,4]);', format: 'stl', async: true },
  response: {
    startedAt: new Date(fixtureNow - 2_000).toISOString(),
    completedAt: new Date(fixtureNow - 1_000).toISOString(),
    submitStatus: 200,
    pollStatus: 200,
    submitted: { mode: 'async', pollUrl: '/api/nexyfab/openscad-render/job/gate-job-1' },
    completed: { status: 'complete', format: 'stl', dataBase64: openscadBytes.toString('base64') },
  },
  release: releaseBinding,
  generatedAt: new Date(fixtureNow).toISOString(),
  now: fixtureNow,
});
const evidenceSigningSecret = 'commercial-gate-evidence-signing-secret-at-least-32-bytes';
const isolationCredentials = {
  JWT_SECRET: 'jwt', ADMIN_SECRET: 'admin', AUTH_SYNC_SECRET: 'auth', CRON_SECRET: 'cron',
  DEV_SEED_KEY: 'seed', NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'action', SELFTEST_TOKEN: 'selftest',
  ADMIN_PASSWORD_HASH: 'password', NEXYFAB_CAD_INDEPENDENT_MODE: '1',
};
const environmentIsolationReceipt = buildRailwayStagingIsolationEvidenceV2({
  production: {
    service: 'nexyfab.com', environment: 'production', environmentId: 'prod-env', deploymentId: 'd',
    variables: { ...isolationCredentials, DATABASE_URL: 'postgres://prod@db-prod/nexyfab', REDIS_URL: 'redis://redis-prod', NEXT_PUBLIC_SITE_URL: 'https://nexyfab.com' },
  },
  staging: {
    service: 'nexyfab.com', environment: 'staging', environmentId: 'stage-env', deploymentId: 'staging-d',
    variables: Object.fromEntries(Object.entries({ ...isolationCredentials, DATABASE_URL: 'postgres://stage@db-stage/nexyfab', REDIS_URL: 'redis://redis-stage', NEXT_PUBLIC_SITE_URL: 'https://nexyfab-staging.example.com' })
      .map(([key, value]) => [key, ['DATABASE_URL', 'REDIS_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXYFAB_CAD_INDEPENDENT_MODE'].includes(key) ? value : `stage-${value}`])),
  },
  release: { buildId: 'b', productionDeploymentId: 'd', evidenceDeploymentId: 'staging-d', gitHead: releaseBinding.gitHead },
  generatedAt: new Date(fixtureNow).toISOString(),
  now: fixtureNow,
  signingSecret: evidenceSigningSecret,
});
const routeSource = writeRawEvidence('src/app/api/example/route.ts', 'export function GET() {}\n');
const cadSource = writeRawEvidence('src/proxy.ts', 'export const proxy = true;\n');
const packageLockSource = writeRawEvidence('package-lock.json', '{"lockfileVersion":3}\n');
const securityGeneratedAt = new Date(fixtureNow).toISOString();
const securityDocuments = {
  routeSecurityMatrix: {
    schema: 'nexyfab.route-security-matrix.v1', generatedAt: securityGeneratedAt, status: 'pass',
    summary: {
      routeFiles: 1, exportedHandlers: 1, classifiedRoutes: 1, unknownClassifications: 0,
      routesWithGaps: 0, gapCounts: {},
      byClassification: { public: 1, authenticated: 0, admin: 0, webhook: 0, 'internal-worker': 0, disabled: 0 },
      publicMutationPolicies: 0, policyConfigIssues: [],
    },
    routes: [{
      route: '/api/example', methods: ['GET'], mutation: false, classification: 'public', gaps: [],
      controls: { publicMutationPolicy: null }, file: routeSource.path, sourceSha256: routeSource.sha256,
    }],
  },
  cadApiControls: {
    schema: 'nexyfab.cad-api-control-evidence.v1', generatedAt: securityGeneratedAt, status: 'pass', externalCadRequired: false,
    routeFiles: 1, exportedHandlers: 1, documentedCadOperations: 1,
    publicExceptions: [{ method: 'GET', path: '/api/cad/v1/capabilities' }], issues: [],
    checks: {
      allCadRoutesBehindActiveProxy: true, onlyCapabilityGetIsPublic: true, accountQuotaPresent: true,
      distributedQuotaFailClosedInCommercial: true, productionAccessMeteringPresent: true,
      openApiHasNoAnonymousCadOverride: true, everyDocumentedCadOperationUsesBearer: true,
      allCadRequestBodiesUseBoundedReaders: true, allCadMutationRoutesDeclareBoundedIngress: true,
      regressionTestsCoverBoundary: true,
    },
    sources: [{ file: cadSource.path, sha256: cadSource.sha256 }],
  },
  secretScan: {
    schema: 'nexyfab-secret-scan-v1', generatedAt: securityGeneratedAt, status: 'pass',
    filesScanned: 1, bytesScanned: 10, findingCount: 0, findings: [],
  },
  dependencyAudit: {
    schema: 'nexyfab-dependency-audit-v1', generatedAt: securityGeneratedAt,
    command: 'npm audit --audit-level=low --json', packageLockSha256: packageLockSource.sha256, status: 'pass',
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    dependencies: { prod: 1, dev: 1, optional: 0, peer: 0, peerOptional: 0, total: 2 },
  },
};
for (const [id, target] of Object.entries(SECURITY_SOURCE_SPECS)) writeEvidence(target, securityDocuments[id]);
const securityReceipt = buildCommercialSecurityEvidenceReceipt({
  root: evidenceRoot,
  release: releaseBinding,
  generatedAt: securityGeneratedAt,
});
test.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
const liveSmokeRequiredChecks = ['live', 'ready', 'capabilities', 'scad-agent-route', 'openscad'];
const authenticatedE2ERequiredChecks = ['login', 'session', 'project_create', 'project_read', 'cad_verify', 'storage_state_reconnect', 'expert_workspace_visible', 'project_cleanup', 'logout'];
const readySnapshot = {
  status: 'ok',
  db: { status: 'ok', required: true, backend: 'postgres' },
  redis: { status: 'ok', required: true, backend: null },
  commercialBoundary: { status: 'ok', required: true, backend: null },
};
const bindReceipt = receipt => ({ ...receipt, sha256: createHash('sha256').update(JSON.stringify(receipt)).digest('hex') });
const rebindReceipt = receipt => {
  const unsigned = { ...receipt };
  delete unsigned.sha256;
  return bindReceipt(unsigned);
};
const receiptEvidence = {
  baselineSnapshot: { path: 'fixtures/closed-beta-baseline.json', bytes: 10, sha256: 'a'.repeat(64) },
  candidateSnapshot: { path: 'fixtures/closed-beta-candidate.json', bytes: 10, sha256: 'b'.repeat(64) },
};
const closedBetaReceipt = attachReceiptSha256({
  schema: 'nexyfab.closed-beta-integrity-comparison.v2',
  generatedAt: new Date().toISOString(),
  ok: true,
  differences: [],
  summary: { protectedTableCount: 1, protectedRowCount: 1, protectedFileCount: 0, protectedFileBytes: 0 },
  release: releaseBinding,
  evidence: receiptEvidence,
  comparisonSha256: sha256({ differences: [], summary: { protectedTableCount: 1, protectedRowCount: 1, protectedFileCount: 0, protectedFileBytes: 0 }, evidence: receiptEvidence }),
});
const productionProtectedStateReceipt = attachReceiptSha256({
  schema: 'nexyfab.production-protected-state-compare.v2',
  generatedAt: new Date().toISOString(),
  ok: true,
  blockers: [],
  protectedTableCount: 1,
  tables: { nf_users: { baselineStateSha256: 'c'.repeat(64), candidateStateSha256: 'd'.repeat(64) } },
  release: releaseBinding,
  evidence: {
    baseline: { identitySha256: 'a'.repeat(64), stateSha256: 'e'.repeat(64) },
    candidate: { identitySha256: 'b'.repeat(64), stateSha256: 'f'.repeat(64) },
  },
  comparisonSha256: sha256({
    tables: { nf_users: { baselineStateSha256: 'c'.repeat(64), candidateStateSha256: 'd'.repeat(64) } },
    blockers: [],
    evidence: {
      baseline: { identitySha256: 'a'.repeat(64), stateSha256: 'e'.repeat(64) },
      candidate: { identitySha256: 'b'.repeat(64), stateSha256: 'f'.repeat(64) },
    },
  }),
});
const liveSmokeReceipt = bindReceipt({
  schema: 'nexyfab.deployment-ai-cad-smoke.v2', generatedAt: new Date().toISOString(), target: 'https://nexyfab.com',
  release: releaseBinding, requiredChecks: liveSmokeRequiredChecks, ready: readySnapshot, status: 'pass',
  credentials: { applicationAuthPresent: true, adminSecretPresent: true },
  results: [
    { id: 'live', status: 'pass', httpStatus: 200 },
    { id: 'ready', status: 'pass', httpStatus: 200 },
    { id: 'capabilities', status: 'pass', httpStatus: 200 },
    { id: 'scad-agent-route', status: 'pass', httpStatus: 405 },
    { id: 'openscad', status: 'pass', httpStatus: 200 },
  ],
});
const authenticatedE2EReceipt = bindReceipt({
  schema: 'nexyfab.authenticated-commercial-e2e.v2', generatedAt: new Date().toISOString(), ok: true,
  environment: 'staging', target: 'https://staging.nexyfab.com',
  release: { buildId: releaseBinding.buildId, productionDeploymentId: releaseBinding.deploymentId, evidenceDeploymentId: 'staging-d', gitHead: releaseBinding.gitHead },
  requiredChecks: authenticatedE2ERequiredChecks,
  checks: authenticatedE2ERequiredChecks, ready: readySnapshot, credentialsPersisted: false, transientProjectRetained: false,
});
const recoveryBody = body => {
  const bytes = Buffer.from(JSON.stringify(body));
  return { bodyBytes: bytes.byteLength, bodySha256: createHash('sha256').update(bytes).digest('hex'), bodyBase64: bytes.toString('base64') };
};
const recoveryRaw = (id, method, pathname, httpStatus, body) => ({
  id, request: { method, pathname }, httpStatus, contentType: 'application/json; charset=utf-8', ...recoveryBody(body),
});
const recoveryWorkspace = (revision, contentHash, heightMm) => ({
  workspace: { revision }, contentHash,
  architecture: { documentId: 'architecture-document-1', document: { walls: [{ id: 'wall-1', heightMm, widthMm: 200 }] } },
  interior: { documentId: 'interior-document-1', document: { furniture: [{ id: 'desk-1', widthMm: 1200 }] } },
});
const recoveryProjectId = 'commercial-gate-recovery-project';
const recoveryProjectPath = `/api/nexyfab/projects/${recoveryProjectId}`;
const recoveryAgentPath = `${recoveryProjectPath}/architecture-interior-agent`;
const recoveryHistoryPath = `${recoveryProjectPath}/architecture-interior-history`;
const recoveryInitial = recoveryWorkspace(10, '1'.repeat(64), 3000);
const recoveryApplied = recoveryWorkspace(11, '2'.repeat(64), 3050);
const recoveryUndone = recoveryWorkspace(12, '3'.repeat(64), 3000);
const recoveryRedone = recoveryWorkspace(13, '4'.repeat(64), 3050);
const architectureInteriorRecoveryReceipt = writeArchitectureInteriorRecoveryEvidence({
  root: evidenceRoot,
  artifactPath: 'architecture-interior-recovery.json',
  generatedAt: new Date().toISOString(),
  target: authenticatedE2EReceipt.target,
  release: authenticatedE2EReceipt.release,
  projectId: recoveryProjectId,
  editedObjectId: 'wall-1',
  observations: [
    recoveryRaw('owner_login', 'POST', '/api/auth/login', 200, { ok: true }),
    recoveryRaw('project_create', 'POST', '/api/nexyfab/projects', 201, { project: { id: recoveryProjectId } }),
    recoveryRaw('workspace_initialized', 'GET', recoveryAgentPath, 200, { session: { role: 'owner' }, workspace: recoveryInitial }),
    recoveryRaw('apply_edit', 'POST', recoveryAgentPath, 200, { ok: true, workspace: recoveryApplied }),
    recoveryRaw('undo', 'POST', recoveryHistoryPath, 200, { ok: true, workspace: recoveryUndone }),
    recoveryRaw('reconnect_before_reload', 'GET', recoveryAgentPath, 200, { session: { role: 'owner' }, workspace: recoveryUndone }),
    recoveryRaw('reconnect_after_reload', 'GET', recoveryAgentPath, 200, { session: { role: 'owner' }, workspace: recoveryUndone }),
    recoveryRaw('redo', 'POST', recoveryHistoryPath, 200, { ok: true, workspace: recoveryRedone }),
    recoveryRaw('viewer_agent_denied', 'POST', recoveryAgentPath, 403, { ok: false, code: 'EDITOR_REQUIRED' }),
    recoveryRaw('viewer_history_denied', 'POST', recoveryHistoryPath, 403, { ok: false, code: 'EDITOR_REQUIRED' }),
    recoveryRaw('project_cleanup', 'DELETE', recoveryProjectPath, 200, { ok: true }),
    recoveryRaw('project_cleanup_confirm', 'GET', recoveryProjectPath, 404, { ok: false, code: 'PROJECT_NOT_FOUND' }),
  ],
});
const restoreNow = Date.now();
const migrationGeneratedAt = new Date().toISOString();
const restoreReceipt = bindReceipt({
  schema: 'nexyfab.backup-isolated-restore-drill.v2', generatedAt: new Date(restoreNow).toISOString(), ok: true, target: 'production',
  release: releaseBinding,
  safety: {
    environment: 'staging', sourceEnvironment: 'production', restoredEnvironment: 'staging', sourceDatabase: 'nexyfab',
    restoreDatabase: 'nexyfab_restore_drill_260823', isolatedDatabaseIdentity: true, sourceWasReadOnly: true, productionRestorePerformed: false,
  },
  backup: { file: 'backups/restore.sql.gz', bytes: 100, sha256: 'f'.repeat(64), objectSha256: 'f'.repeat(64), sourceSnapshotSha256: 'a'.repeat(64), completedAt: new Date(restoreNow - 2_000).toISOString() },
  source: { tableContentSha256: 'a'.repeat(64) },
  restored: { tableContentSha256: 'a'.repeat(64), exactSourceMatch: true, businessDataSha256: 'a'.repeat(64) },
  migration: { targetVersion: 2026082403, migrations: [{ version: 2026082403, checksum: 'b'.repeat(64), decision: 'already_applied' }] },
  migrationTarget: 2026082403,
  migrated: { tableContentSha256: 'a'.repeat(64), businessRowsPreserved: true, businessDataSha256: 'a'.repeat(64) },
  timing: {
    drillStartedAt: new Date(restoreNow - 3_000).toISOString(), backupCapturedAt: new Date(restoreNow - 2_000).toISOString(),
    restoreStartedAt: new Date(restoreNow - 1_000).toISOString(), completedAt: new Date(restoreNow).toISOString(),
  },
  objectives: { rpoAgeAtDrillStartMs: 0, rtoRestoreMigrateValidateMs: 1_000, totalDrillMs: 3_000, measurement: 'wall_clock' },
});
const productReceiptGeneratedAt = new Date(fixtureNow).toISOString();
const seaCanonicalSha256 = value => createHash('sha256').update(Buffer.from(canonicalJson(value), 'utf8')).digest('hex');
for (const sourcePath of [
  'scripts/build-enterprise-sso-readiness-receipt.mjs',
  'src/lib/saml-sso-verifier.ts',
  'src/lib/oidc-sso-readiness.ts',
  'src/app/api/nexyfab/sso/callback/route.ts',
]) writeEvidence(sourcePath, { fixture: sourcePath });
writeEvidence('docs/evidence/release/commercial-release-baseline-current.json', {
  release: { buildId: releaseBinding.buildId, deploymentId: releaseBinding.deploymentId, head: releaseBinding.gitHead },
});
const enterpriseSsoKeyPair = generateKeyPairSync('ed25519');
const enterpriseSsoPublicKeyPem = enterpriseSsoKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
writeEvidence(DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH, attachEvidenceSha256({
  schema: ENTERPRISE_SSO_COLLECTOR_ALLOWLIST_SCHEMA,
  collectors: [{
    id: 'commercial-gate-sso-collector', status: 'ACTIVE', publicKeyPem: enterpriseSsoPublicKeyPem,
    publicKeySha256: sha256(enterpriseSsoPublicKeyPem),
    allowedStagingOrigins: ['https://staging.nexyfab.com'], allowedDeploymentIds: [releaseBinding.deploymentId],
  }],
}, 'allowlistSha256'));
const enterpriseSsoCases = ENTERPRISE_SSO_CASE_SPECS.map(spec => {
  const accepted = spec.outcome === 'ACCEPTED';
  const raw = attachEvidenceSha256({
    schema: ENTERPRISE_SSO_CASE_SCHEMA,
    caseId: spec.id,
    protocol: spec.protocol,
    capturedAt: productReceiptGeneratedAt,
    environment: 'staging',
    target: 'https://staging.nexyfab.com',
    release: releaseBinding,
    runId: 'commercial-gate-sso-run',
    stimulus: spec.stimulus,
    request: { correlationId: `gate-${spec.id}`, safeSha256: '1'.repeat(64) },
    response: { safeSha256: '2'.repeat(64) },
    transaction: {
      id: `transaction-${spec.id}`,
      ...(spec.predecessorCaseId ? {
        predecessorCaseId: spec.predecessorCaseId,
        predecessorTransactionId: `transaction-${spec.predecessorCaseId}`,
      } : {}),
    },
    observation: {
      httpStatus: accepted ? 302 : 400,
      outcome: spec.outcome,
      errorCode: spec.errorCode,
      sessionIssued: spec.session,
      validatedControls: spec.validated ?? [],
      rejectedControls: spec.rejected ?? [],
      ...(spec.replayAttempt ? { attempt: spec.replayAttempt } : {}),
    },
    sessionEvidence: accepted
      ? { lookup: 'FOUND', cleanup: 'CONFIRMED', sessionIdSha256: '3'.repeat(64) }
      : { lookup: 'NOT_FOUND', cleanup: 'NOT_REQUIRED', sessionIdSha256: null },
    ...(spec.protocol === 'saml' ? {
      samlEvidence: {
        certificateSha256: '4'.repeat(64), referenceIdSha256: '5'.repeat(64), digestSha256: '6'.repeat(64),
        signedElement: 'Response', signatureAlgorithm: 'rsa-sha256',
      },
    } : {
      oidcEvidence: {
        issuer: 'https://idp.example.test', issuerSha256: sha256('https://idp.example.test'),
        discoverySha256: '7'.repeat(64), jwksSha256: '8'.repeat(64), kidSha256: '9'.repeat(64),
        algorithm: spec.oidcAlgorithm, idTokenSha256: 'a'.repeat(64), userinfoSubjectSha256: 'b'.repeat(64),
      },
    }),
  }, 'artifactSha256');
  const artifactPath = writeEvidence(`product-evidence/sso/${spec.id}.json`, raw);
  return { id: spec.id, artifact: enterpriseSsoFileBinding(evidenceRoot, artifactPath) };
});
const enterpriseSsoIsolationPath = writeEvidence('product-evidence/sso/isolation.json', attachEvidenceSha256({
  schema: ENTERPRISE_SSO_ISOLATION_SCHEMA,
  capturedAt: productReceiptGeneratedAt,
  environment: 'staging', target: 'https://staging.nexyfab.com', deploymentId: releaseBinding.deploymentId,
  release: releaseBinding,
  controls: { databaseIsolated: true, redisIsolated: true, sessionStoreIsolated: true, productionMutationDisabled: true },
}, 'isolationSha256'));
const enterpriseSsoManifestBody = {
  schema: ENTERPRISE_SSO_EVIDENCE_SCHEMA,
  capturedAt: productReceiptGeneratedAt,
  environment: 'staging',
  target: 'https://staging.nexyfab.com',
  release: releaseBinding,
  run: {
    id: 'commercial-gate-sso-run',
    runner: 'nexyfab-staging-sso-e2e',
    startedAt: new Date(fixtureNow - 1_000).toISOString(),
    completedAt: productReceiptGeneratedAt,
  },
  cases: enterpriseSsoCases,
  caseEvidenceRootSha256: enterpriseSsoCaseEvidenceRoot(enterpriseSsoCases),
  isolationReceipt: enterpriseSsoFileBinding(evidenceRoot, enterpriseSsoIsolationPath),
};
const enterpriseSsoManifest = attachEvidenceSha256({
  ...enterpriseSsoManifestBody,
  attestation: {
    collectorId: 'commercial-gate-sso-collector', algorithm: 'Ed25519', signedAt: productReceiptGeneratedAt,
    signature: sign(null, Buffer.from(enterpriseSsoCollectorAttestationPayload(enterpriseSsoManifestBody)), enterpriseSsoKeyPair.privateKey).toString('base64'),
  },
});
const enterpriseSsoManifestPath = writeEvidence('product-evidence/sso/manifest.json', enterpriseSsoManifest);
const enterpriseSsoReceipt = buildEnterpriseSsoReadinessReceipt({
  root: evidenceRoot,
  inputPath: enterpriseSsoManifestPath,
  generatedAt: productReceiptGeneratedAt,
});
const minimalWindowsPe = ({ signed = false, marker = 1 } = {}) => {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ', 0, 'ascii');
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write('PE\0\0', 0x80, 'binary');
  bytes.writeUInt16LE(0x14c, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  bytes.writeUInt16LE(0xe0, 0x94);
  const optional = 0x98;
  bytes.writeUInt16LE(0x10b, optional);
  bytes.writeUInt32LE(16, optional + 92);
  bytes[0x40] = marker;
  if (signed) {
    bytes.writeUInt32LE(480, optional + 128);
    bytes.writeUInt32LE(32, optional + 132);
    bytes.writeUInt32LE(32, 480);
    bytes.writeUInt16LE(0x0200, 484);
    bytes.writeUInt16LE(0x0002, 486);
    bytes[488] = 0x30;
    bytes[489] = 0x16;
    bytes.fill(0x42, 490, 512);
  }
  return bytes;
};
for (const relative of RELEASE_SOURCE_PATHS) {
  writeRawEvidence(relative, fs.readFileSync(path.resolve(relative)));
}
const seaBundle = writeBoundEvidence('.tmp/agent-sidecar/agent-gateway.cjs', 'fixture-sidecar-bundle');
const seaUnsigned = writeBoundEvidence(
  'src-tauri/binaries/nexyfab-agent-gateway-x86_64-pc-windows-msvc.exe',
  minimalWindowsPe(),
);
const seaUnsignedManifest = writeBoundEvidence(`${seaUnsigned.path}.sha256.json`, `${JSON.stringify({
  schema: RELEASE_MANIFEST_SCHEMA,
  unsigned: true,
  file: { name: path.basename(seaUnsigned.path), bytes: seaUnsigned.bytes, sha256: seaUnsigned.sha256 },
})}\n`);
const seaReadiness = buildReadinessReceipt({
  root: evidenceRoot,
  generatedAt: productReceiptGeneratedAt,
  probes: {
    nodeVersion: 'v25.2.1', platform: 'win32', arch: 'x64', targetTriple: 'x86_64-pc-windows-msvc',
    nativeBuildSea: true, legacySeaConfig: false, postjectPath: null, signtoolPath: 'signtool.exe',
    bundleCheck: { ran: true, ok: true, status: 0, error: null, artifact: seaBundle },
  },
});
const seaReadinessBinding = writeBoundEvidence(
  'docs/evidence/agent-sidecar/windows-sea-readiness-260823.json',
  `${JSON.stringify(seaReadiness, null, 2)}\n`,
);
const seaSigned = writeBoundEvidence('product-evidence/nexyfab-agent-gateway-signed.exe', minimalWindowsPe({ signed: true, marker: 2 }));
const seaSignedManifest = writeBoundEvidence(`${seaSigned.path}.sha256.json`, `${JSON.stringify({
  schema: RELEASE_MANIFEST_SCHEMA,
  unsigned: false,
  file: { name: path.basename(seaSigned.path), bytes: seaSigned.bytes, sha256: seaSigned.sha256 },
})}\n`);
const parityCalls = [
  ['mcp-tools-list', 'mcp'],
  ['mcp-tool-call', 'mcp'],
  ['cli-health', 'cli'],
].map(([id, surface], index) => {
  const input = { designId: index + 1 };
  const output = { ok: true, result: index + 1 };
  const transcript = [
    { kind: 'request', callId: id, surface, operation: surface === 'mcp' ? 'tools/call' : 'agent inspect', executableSha256: seaSigned.sha256, payload: input },
    { kind: 'baseline_response', callId: id, payload: output },
    { kind: 'sea_response', callId: id, payload: output },
    { kind: 'exit', callId: id, executableSha256: seaSigned.sha256, code: 0 },
  ];
  return {
    id,
    surface,
    inputSha256: seaCanonicalSha256(input),
    baselineOutputSha256: seaCanonicalSha256(output),
    seaOutputSha256: seaCanonicalSha256(output),
    exact: true,
    transcript: writeBoundEvidence(`product-evidence/${id}.jsonl`, `${transcript.map(JSON.stringify).join('\n')}\n`),
  };
});
const seaParity = writeBoundEvidence('product-evidence/sea-parity.json', `${JSON.stringify({
  schema: PARITY_EVIDENCE_SCHEMA,
  generatedAt: productReceiptGeneratedAt,
  status: 'PASS',
  release: releaseBinding,
  executableSha256: seaSigned.sha256,
  executableInvoked: true,
  mcpToolsExact: true,
  cliCommandsExact: true,
  representativeCalls: parityCalls,
})}\n`);
const seaCertificateSha256 = 'a'.repeat(64);
const seaTimestampTokenSha256 = 'b'.repeat(64);
const seaTimestampMessageImprint = 'c'.repeat(64);
const seaSigningLog = writeBoundEvidence('product-evidence/authenticode-machine-result.json', `${JSON.stringify({
  schema: AUTHENTICODE_RESULT_SCHEMA,
  tool: { name: 'Get-AuthenticodeSignature', version: 'PowerShell 7.5', command: 'Get-AuthenticodeSignature ./agent.exe | ConvertTo-Json' },
  exitCode: 0,
  peHashAlgorithm: 'sha256',
  peSha256: seaSigned.sha256,
  executableSha256: seaSigned.sha256,
  signatureStatus: 'Valid',
  chain: { trusted: true },
  certificate: { sha256: seaCertificateSha256, subject: 'CN=NexyFab Release Test' },
  timestamp: {
    verified: true, authority: 'NexyFab Test TSA', at: productReceiptGeneratedAt,
    tokenSha256: seaTimestampTokenSha256, imprintAlgorithm: 'sha256', messageImprint: seaTimestampMessageImprint,
  },
})}\n`);
const seaSigning = writeBoundEvidence('product-evidence/sea-signing.json', `${JSON.stringify({
  schema: SIGNING_EVIDENCE_SCHEMA,
  generatedAt: productReceiptGeneratedAt,
  status: 'PASS',
  release: releaseBinding,
  unsignedBinarySha256: seaUnsigned.sha256,
  signedBinarySha256: seaSigned.sha256,
  authenticodeVerified: true,
  chainTrusted: true,
  signatureStatus: 'Valid',
  certificateSha256: seaCertificateSha256,
  certificateSubject: 'CN=NexyFab Release Test',
  timestamp: {
    verified: true, authority: 'NexyFab Test TSA', at: productReceiptGeneratedAt,
    tokenSha256: seaTimestampTokenSha256, messageImprint: seaTimestampMessageImprint,
  },
  rawVerification: seaSigningLog,
})}\n`);
const seaVmProvider = writeBoundEvidence('product-evidence/vm-provider.json', `${JSON.stringify({
  schema: VM_PROVIDER_ATTESTATION_SCHEMA, generatedAt: productReceiptGeneratedAt, status: 'PASS',
  provider: 'trusted-ci-vm', attestationId: 'vm-attestation-gate', vmId: 'disposable-vm-fixture',
  unique: true, disposable: true, productionMachineTouched: false,
  createdAt: new Date(fixtureNow - 20 * 60_000).toISOString(),
  destroyedAt: new Date(fixtureNow + 20 * 60_000).toISOString(),
})}\n`);
const seaVmStageSpecs = {
  install: { start: -10, end: -8, before: null, after: '1.0.0' },
  upgrade: { start: -7, end: -5, before: '1.0.0', after: '2.0.0' },
  rollback: { start: -4, end: -2, before: '2.0.0', after: '1.0.0', inducedFailure: true, recoveryVerified: true },
  uninstall: { start: -1, end: 0, before: '1.0.0', after: null, residueCount: 0 },
};
const seaVmLifecycle = Object.fromEntries(Object.entries(seaVmStageSpecs).map(([stage, spec]) => [stage, {
  status: 'PASS', exitCode: 0,
  rawLog: writeBoundEvidence(`product-evidence/vm-${stage}.json`, `${JSON.stringify({
    schema: VM_STAGE_OBSERVATION_SCHEMA, stage, vmId: 'disposable-vm-fixture',
    providerAttestationId: 'vm-attestation-gate',
    startedAt: new Date(fixtureNow + spec.start * 60_000).toISOString(),
    completedAt: new Date(fixtureNow + spec.end * 60_000).toISOString(),
    command: `installer.exe ${stage}`, executedBinarySha256: seaSigned.sha256,
    status: 'PASS', exitCode: 0, versionBefore: spec.before, versionAfter: spec.after,
    ...(spec.inducedFailure ? { inducedFailure: true, recoveryVerified: true } : {}),
    ...(spec.residueCount === 0 ? { residueCount: 0 } : {}),
  })}\n`),
}]));
const seaInstaller = writeBoundEvidence('product-evidence/sea-installer.json', `${JSON.stringify({
  schema: INSTALLER_EVIDENCE_SCHEMA,
  generatedAt: productReceiptGeneratedAt,
  status: 'PASS',
  release: releaseBinding,
  signedBinarySha256: seaSigned.sha256,
  disposableVm: true,
  uniqueDisposableVm: true,
  vmId: 'disposable-vm-fixture',
  productionMachineTouched: false,
  provider: 'trusted-ci-vm',
  providerAttestationId: 'vm-attestation-gate',
  providerAttestation: seaVmProvider,
  installVersion: '1.0.0',
  upgradeVersion: '2.0.0',
  lifecycle: seaVmLifecycle,
})}\n`);
const seaSourceBindings = RELEASE_SOURCE_PATHS.map(relative => windowsSeaFileBinding(evidenceRoot, relative));
const seaAttestationKeys = generateKeyPairSync('ed25519');
const seaAttestationKeyId = 'commercial-gate-ci-test-key';
const seaAttestationPublicKey = writeBoundEvidence(
  'product-evidence/ci-release-public.pem',
  seaAttestationKeys.publicKey.export({ type: 'spki', format: 'pem' }),
);
const windowsSeaTrustedKeyAllowlist = {
  [seaAttestationKeyId]: createHash('sha256').update(seaAttestationKeys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
};
const seaAttestation = {
  schema: RELEASE_ATTESTATION_SCHEMA,
  generatedAt: productReceiptGeneratedAt,
  status: 'PASS',
  keyId: seaAttestationKeyId,
  release: releaseBinding,
  runner: {
    trusted: true, environment: 'release', provider: 'github-actions', identity: 'repo:nexyfab/release',
    workflow: 'windows-sea-release', runId: 'commercial-gate-run', repository: 'nexyfab/release',
  },
  source: {
    gitHead: releaseBinding.gitHead, gitTreeVerified: true, gitTreeOid: '2'.repeat(40),
    treeSha256: seaCanonicalSha256(seaSourceBindings),
  },
  artifacts: { unsignedPeSha256: seaUnsigned.sha256, signedPeSha256: seaSigned.sha256 },
  evidence: { readinessReceipt: seaReadinessBinding, parity: seaParity, signing: seaSigning, installer: seaInstaller },
  authenticode: {
    peSha256: seaSigned.sha256, certificateSha256: seaCertificateSha256,
    timestampTokenSha256: seaTimestampTokenSha256, timestampMessageImprint: seaTimestampMessageImprint,
  },
  parity: { callsSha256: seaCanonicalSha256(parityCalls) },
  vm: { provider: 'trusted-ci-vm', providerAttestationId: 'vm-attestation-gate', vmId: 'disposable-vm-fixture' },
};
const seaAttestationBinding = writeBoundEvidence('product-evidence/ci-release-attestation.json', `${JSON.stringify(seaAttestation)}\n`);
const seaAttestationSignature = writeBoundEvidence(
  'product-evidence/ci-release-attestation.sig',
  sign(null, Buffer.from(canonicalJson(seaAttestation)), seaAttestationKeys.privateKey),
);
const windowsSeaReceipt = buildWindowsSeaReleaseReceipt({
  root: evidenceRoot,
  generatedAt: productReceiptGeneratedAt,
  release: releaseBinding,
  now: fixtureNow,
  trustedKeyAllowlist: windowsSeaTrustedKeyAllowlist,
  evidencePaths: {
    readinessReceipt: seaReadinessBinding.path,
    unsignedBinary: seaUnsigned.path,
    unsignedManifest: seaUnsignedManifest.path,
    signedBinary: seaSigned.path,
    signedManifest: seaSignedManifest.path,
    parity: seaParity.path,
    signing: seaSigning.path,
    installer: seaInstaller.path,
    attestation: seaAttestationBinding.path,
    attestationSignature: seaAttestationSignature.path,
    attestationPublicKey: seaAttestationPublicKey.path,
  },
});
const largeUploadPrefix = 'product-evidence/large-upload';
const largeUploadSourcePath = `${largeUploadPrefix}/source.bin`;
const largeUploadSourceAbsolute = path.join(evidenceRoot, ...largeUploadSourcePath.split('/'));
fs.mkdirSync(path.dirname(largeUploadSourceAbsolute), { recursive: true });
{
  const descriptor = fs.openSync(largeUploadSourceAbsolute, 'w');
  const chunk = Buffer.alloc(1024 * 1024, 0x5a);
  try {
    for (let offset = 0; offset < LARGE_UPLOAD_MIN_BYTES; offset += chunk.length) fs.writeSync(descriptor, chunk);
    fs.writeSync(descriptor, Buffer.from('nexyfab-commercial-gate-large-upload-proof'));
  } finally { fs.closeSync(descriptor); }
}
const largeUploadRoundtripPath = `${largeUploadPrefix}/roundtrip-readback.bin`;
const largeUploadResumePath = `${largeUploadPrefix}/resume-readback.bin`;
fs.copyFileSync(largeUploadSourceAbsolute, path.join(evidenceRoot, ...largeUploadRoundtripPath.split('/')));
fs.copyFileSync(largeUploadSourceAbsolute, path.join(evidenceRoot, ...largeUploadResumePath.split('/')));
const largeUploadSource = largeUploadFileBinding(evidenceRoot, largeUploadSourcePath);
const largeUploadRunId = 'commercial-gate-large-upload-run';
const largeUploadTarget = 'https://staging.nexyfab.com';
const largeUploadDeploymentId = 'staging-large-upload-d';
const largeUploadCompletedAt = new Date(fixtureNow - 1_000).toISOString();
const largeUploadArtifacts = {
  sourceFile: largeUploadSourcePath,
  roundtripReadbackFile: largeUploadRoundtripPath,
  resumeReadbackFile: largeUploadResumePath,
  roundtripResponse: `${largeUploadPrefix}/roundtrip.json`,
  resumeResponse: `${largeUploadPrefix}/resume.json`,
  abortResponse: `${largeUploadPrefix}/abort.json`,
  workerSamples: `${largeUploadPrefix}/worker.json`,
  runtimeLimit: `${largeUploadPrefix}/runtime-limit.json`,
  stagingIsolation: `${largeUploadPrefix}/isolation.json`,
};
const largeUploadCommon = {
  runId: largeUploadRunId, target: largeUploadTarget,
  evidenceDeploymentId: largeUploadDeploymentId, capturedAt: largeUploadCompletedAt,
};
writeEvidence(largeUploadArtifacts.roundtripResponse, {
  schema: 'nexyfab.large-upload-roundtrip-response.v1', ...largeUploadCommon,
  requestId: 'gate-roundtrip-request', uploadIdFingerprint: '1'.repeat(64), objectKeyFingerprint: '2'.repeat(64),
  completeHttpStatus: 200, readbackHttpStatus: 200, partCount: 9,
  uploadedBytes: largeUploadSource.bytes, readbackBytes: largeUploadSource.bytes,
  sourceSha256: largeUploadSource.sha256, readbackSha256: largeUploadSource.sha256, etag: 'roundtrip-etag',
});
writeEvidence(largeUploadArtifacts.resumeResponse, {
  schema: 'nexyfab.large-upload-resume-response.v1', ...largeUploadCommon,
  requestId: 'gate-resume-request', uploadIdFingerprint: '3'.repeat(64), objectKeyFingerprint: '4'.repeat(64),
  completeHttpStatus: 200, readbackHttpStatus: 200, interruptedAtBytes: 16 * 1024 * 1024,
  resumedFromBytes: 16 * 1024 * 1024, completedBytes: largeUploadSource.bytes, readbackBytes: largeUploadSource.bytes,
  sourceSha256: largeUploadSource.sha256, readbackSha256: largeUploadSource.sha256,
  partsBeforeInterruption: 2, partsAfterResume: 7, etag: 'resume-etag',
});
writeEvidence(largeUploadArtifacts.abortResponse, {
  schema: 'nexyfab.large-upload-abort-response.v1', ...largeUploadCommon,
  requestId: 'gate-abort-request', uploadIdFingerprint: '5'.repeat(64), objectKeyFingerprint: '6'.repeat(64),
  abortHttpStatus: 204, uploadedBeforeAbortBytes: 8 * 1024 * 1024,
  headAfterAbortHttpStatus: 404, headRequestId: 'gate-head-request', objectExistsAfterAbort: false,
  listedPartsAfterAbort: 0, listPartsRequestId: 'gate-list-request',
});
writeEvidence(largeUploadArtifacts.workerSamples, {
  schema: 'nexyfab.large-upload-worker-samples.v1', runId: largeUploadRunId,
  evidenceDeploymentId: largeUploadDeploymentId, service: 'large-upload-worker',
  samples: [
    { capturedAt: new Date(fixtureNow - 8_000).toISOString(), rssBytes: 310 * 1024 * 1024, heapUsedBytes: 120 * 1024 * 1024 },
    { capturedAt: new Date(fixtureNow - 3_000).toISOString(), rssBytes: 430 * 1024 * 1024, heapUsedBytes: 180 * 1024 * 1024 },
  ],
});
writeEvidence(largeUploadArtifacts.runtimeLimit, {
  schema: 'nexyfab.large-upload-runtime-limit.v1', runId: largeUploadRunId,
  evidenceDeploymentId: largeUploadDeploymentId, service: 'large-upload-worker',
  source: 'platform-runtime-config-export', capturedAt: largeUploadCompletedAt, limitBytes: 768 * 1024 * 1024,
});
writeEvidence(largeUploadArtifacts.stagingIsolation, {
  schema: 'nexyfab.large-upload-staging-isolation.v1', runId: largeUploadRunId, capturedAt: largeUploadCompletedAt,
  environment: 'staging', target: largeUploadTarget, productionDeploymentId: releaseBinding.deploymentId,
  evidenceDeploymentId: largeUploadDeploymentId, productionEnvironmentId: 'production-environment',
  stagingEnvironmentId: 'staging-environment', objectStorageBucketFingerprint: '7'.repeat(64),
  databaseIsolated: true, objectStorageIsolated: true,
});
const largeUploadCollectorKeys = generateKeyPairSync('ed25519');
const largeUploadTrustedCollectorsPath = writeEvidence(`${largeUploadPrefix}/trusted-collectors.json`, {
  schema: 'nexyfab.large-upload-trusted-collectors.v1',
  collectors: [{
    id: 'commercial-gate-large-upload-collector',
    publicKeyPem: largeUploadCollectorKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    allowedOrigins: [largeUploadTarget],
  }],
});
const largeUploadObservation = {
  schema: 'nexyfab.large-upload-staging-observations.v2', status: 'COMPLETED',
  captureMode: 'external-staging-object-storage-probe', runId: largeUploadRunId,
  startedAt: new Date(fixtureNow - 10_000).toISOString(), completedAt: largeUploadCompletedAt,
  capturedAt: largeUploadCompletedAt, environment: 'staging', target: largeUploadTarget,
  release: { buildId: releaseBinding.buildId, productionDeploymentId: releaseBinding.deploymentId, gitHead: releaseBinding.gitHead },
  evidenceDeploymentId: largeUploadDeploymentId,
  storage: { backend: 'object-storage', provider: 'test-s3-compatible', bucketFingerprint: '7'.repeat(64) },
  artifacts: largeUploadArtifacts,
  attestation: { collectorId: 'commercial-gate-large-upload-collector', signedAt: productReceiptGeneratedAt },
};
const largeUploadArtifactBindings = Object.values(largeUploadArtifacts).map(file => largeUploadFileBinding(evidenceRoot, file));
largeUploadObservation.attestation.signatureBase64 = sign(
  null,
  Buffer.from(largeUploadCollectorAttestationPayload(largeUploadObservation, largeUploadArtifactBindings)),
  largeUploadCollectorKeys.privateKey,
).toString('base64');
const largeUploadObservationPath = writeEvidence(`${largeUploadPrefix}/observation.json`, largeUploadObservation);
const largeUploadStagingReceipt = buildLargeUploadStagingReadinessReceipt({
  root: evidenceRoot, observationPath: largeUploadObservationPath,
  trustedCollectorsPath: largeUploadTrustedCollectorsPath,
  expectedRelease: expectedReleaseBinding, generatedAt: productReceiptGeneratedAt, now: fixtureNow,
});
const passingReleaseBaseline = {
  release: {
    branch: 'release/test', head: '1'.repeat(40), baselineStatus: 'committed', workingTreeChanges: 0,
    deploymentId: 'd', buildId: 'b', rollbackDeploymentId: 'r', dockerImageDigest: 'sha256:x',
    dbSchemaVersion: 2026082403, railwayIgnore: { missing: [] },
  },
};
const passingReleaseBaselinePath = writeEvidence('fixtures/commercial-release-baseline.json', passingReleaseBaseline);
const passingReleaseBaselineBytes = fs.readFileSync(path.join(evidenceRoot, passingReleaseBaselinePath));
const passingReleaseBaselineBinding = {
  path: passingReleaseBaselinePath,
  bytes: passingReleaseBaselineBytes.byteLength,
  sha256: createHash('sha256').update(passingReleaseBaselineBytes).digest('hex'),
};
const passing = {
  releaseChannel: 'platform',
  productReleaseScope: 'web',
  evidenceRoot,
  windowsSeaTrustedKeyAllowlist,
  evidenceSigningSecret,
  currentRelease: { branch: 'release/test', head: '1'.repeat(40), workingTreeChanges: 0 },
  releaseBaseline: passingReleaseBaseline,
  releaseBaselineBinding: passingReleaseBaselineBinding,
  closedBeta: closedBetaReceipt, closedBetaEvidenceVerified: true, closedBetaReceiptVerified: true, liveSmoke: liveSmokeReceipt, liveSmokeReceiptVerified: true,
  productionProtectedState: productionProtectedStateReceipt, productionProtectedStateReceiptVerified: true, openscadHttpSmoke: openscadHttpSmokeReceipt, authenticatedE2E: authenticatedE2EReceipt, authenticatedE2EReceiptVerified: true,
  architectureInteriorRecovery: architectureInteriorRecoveryReceipt, architectureInteriorRecoveryReceiptVerified: true,
  resourceBaseline: resourceBaselineReceipt,
  migrationReceipt: attachReceiptSha256({
    schema: 'nexyfab.postgres-migration-receipt.v2', ok: true, status: 'PASS',
    generatedAt: migrationGeneratedAt, target: 'production',
    freshness: {
      generatedAt: migrationGeneratedAt,
      maxAgeMs: 24 * 60 * 60_000,
      expiresAt: new Date(Date.parse(migrationGeneratedAt) + 24 * 60 * 60_000).toISOString(),
    },
    release: { buildId: 'b', deploymentId: 'd', gitHead: '1'.repeat(40) },
    migrations: commercialMigrations.map(version => ({
      version, sourceSha256: String(version).padEnd(64, 'a'),
      databaseChecksum: String(version).padEnd(64, 'a'), decision: 'already_applied', checksumMatchesSource: true,
    })),
    before: { tableCount: 10, totalRows: 100, businessRowCountSha256: 'a'.repeat(64) },
    after: { tableCount: 17, totalRows: 107, businessRowCountSha256: 'a'.repeat(64) },
    changedBusinessTables: [], blockers: [],
  }),
  migrationReceiptSourceBindingsVerified: true,
  restoreReceipt,
  environmentIsolationReceipt,
  syntheticCampaignReceipt,
  syntheticCampaignCorpusSha256: syntheticCampaignReceipt.corpus.sha256,
  complexHoldoutCases,
  complexGroundTruthValidation,
  complexProductScope: { decision: { broadComplexProductSelfServiceEligible: true, manufacturingReleaseGuaranteed: true }, families: Object.fromEntries(complexFamilies.filter(family => family !== 'interior').map(family => [family, { selfServiceEligible: true, manufacturingReleaseVerified: true }])) },
  mechanicalProductScope: {
    schema: 'nexyfab.mechanical-product-scope-assessment.v3',
    releaseChannel: 'mechanical-core',
    assessedAt: '2026-08-11T00:00:00.000Z',
    sources: [{ path: 'evidence.json', sha256: 'a'.repeat(64) }],
    evidence: {
      internalRegressionVerified: true,
      coreThirtyFeatureClosedLoopVerified: true,
      directDesignCandidateVerified: true,
      directDesignThirtyVerified: true,
      intentCampaign150Verified: true,
      standardStepConformanceVerified: true,
      artifactRevisionConsistencyVerified: true,
      blindProductChallengeVerified: true,
      manufacturingReceiptVerified: true,
    },
    decision: { privateBetaEligible: true, selfServiceEligible: true, manufacturingReleaseVerified: true, failClosed: true, status: 'manufacturing_release_verified' },
    blockers: [],
    claimBoundary: {
      internalRegressionCertifiesCommercialAccuracy: false,
      syntheticEvidenceCertifiesCommercialAccuracy: false,
      stepExportAloneCertifiesManufacturability: false,
      kernelSelfRoundtripCertifiesCommercialCadCompatibility: false,
      featureRegistrationAloneCertifiesClosedLoop: false,
      spatialLabsEvidenceMaySatisfyMechanicalCore: false,
      vendorSpecificCadValidationRequiredForBaseRelease: false,
      internalRoleSeparatedReviewMayBeMarketedAsExternal: false,
    },
  },
  validationCorpus: { lanes: { synthetic: { summary: { byDomain: { mechanical: 20, building: 20, civil: 20, landscape: 20, interior: 20 } } }, reference: { sourceReadOnly: true }, independentHoldout: { domains } } },
  security: { routeMatrixOk: true, cadApiControlsOk: true, secretFindings: 0, dependencyVulnerabilities: 0 },
  securityReceipt,
  sevenDayOperationsReceipt: {
    schema: 'nexyfab.seven-day-operations-receipt.v3', ok: true, blockers: [],
    generatedAt: '2026-08-08T00:00:00.000Z',
    policy: {
      requiredCoverageHours: 168, requiredSampleCount: 28, expectedWindowHours: 6,
      http5xxMaxPercent: 1, requireRuntimeMemoryLimitEvidence: true, monthlyCostBudgetUsd: 50,
      memoryLimitsMb: { web: 768, 'openscad-worker': 512, 'fea-worker': 2048 },
    },
    services: Object.fromEntries(['web', 'openscad-worker', 'fea-worker'].map(name => [name, {
      coverageHours: 168, spanHours: 168, samples: 28, uniqueWindows: 28,
      invalidWindows: 0, overlaps: 0, gaps: 0, durationMismatches: 0,
      maxMemoryMb: 100, minimumRuntimeMemoryLimitMb: name === 'web' ? 768 : name === 'openscad-worker' ? 512 : 2048,
      ...(name === 'web' ? { totalRequests: 2800, total5xx: 0, errorRatePercent: 0 } : {}),
    }])),
    cost: {
      ok: true, blockers: [], samples: 2, coverageHours: 168,
      projectedMonthlyDollars: 20, monthlyBudgetDollars: 50,
      scopedServices: ['nexyfab.com', 'nexyfab-openscad-worker', 'nexyfab-fea-worker', 'Postgres-KN2x', 'Redis-IrVt'],
    },
    release: {
      buildId: 'b', qualifyingFrom: '2026-08-01T00:00:00.000Z', environment: 'production',
      deployments: { web: 'd', 'openscad-worker': 'openscad-d', 'fea-worker': 'fea-d' },
    },
  },
  sevenDayOperationsEvidenceVerified: true,
  expertReviewReceipt,
  expertReviewExpectedHoldoutCorpusSha256: expertCorpusHash,
  expertReviewTrustedReviewers: expertTrustedReviewers,
};

const fullProductSpecialtyChannels = {
  'sheet-metal': 'verified-sheet-metal',
  'welded-fabrication': 'verified-welded-fabrication',
  'mold-tooling': 'verified-mold-tooling',
  piping: 'verified-piping',
  hvac: 'verified-hvac',
  'ecad-mcad': 'verified-ecad-mcad',
};

function buildSpecialtyGateFixture(channel = 'verified-sheet-metal') {
  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const definition = SPECIALTY_RELEASE_CHANNELS[channel];
  assert.ok(definition, channel);
  const qualification = definition.schema === 'nexyfab.specialty-manufacturing-qualification.v1'
    ? {
      schema: definition.schema, track: definition.track, status: 'QUALIFIED', releaseReady: true,
      contract: { valid: true }, readback: { valid: true }, externalAxes: { valid: true, missing: [] },
      reviewers: { independent_parser_cad_reviewer: { valid: true }, manufacturing_reviewer: { valid: true } },
      blockers: [],
    }
    : definition.schema === 'nexyfab.mep-fabrication-qualification.v1'
      ? {
        schema: definition.schema, track: definition.track, status: 'QUALIFIED', qualified: true,
        internalValidation: { valid: true }, internalReadback: { valid: true }, independentAttestation: { valid: true },
        evidence: { valid: true }, blockers: [],
      }
      : {
        schema: definition.schema, track: definition.track, status: 'QUALIFIED', qualified: true,
        internalValidation: { valid: true }, internalReadback: { valid: true }, artifacts: { valid: true },
        nativeParsers: { valid: true }, reviewers: { valid: true }, evidence: { valid: true }, blockers: [],
      };
  const qualificationBytes = Buffer.from(`${JSON.stringify(qualification)}\n`);
  const qualificationPath = `specialty/${channel}/qualification.json`;
  fs.mkdirSync(path.dirname(path.join(evidenceRoot, qualificationPath)), { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, qualificationPath), qualificationBytes);
  const evidenceArtifacts = ['independent review', 'manufacturing release'].map((value, index) => {
    const bytes = Buffer.from(`${value}\n`);
    const relativePath = `specialty/${channel}/evidence-${index + 1}.txt`;
    fs.writeFileSync(path.join(evidenceRoot, relativePath), bytes);
    return {
      artifactId: `specialty-${index + 1}`,
      kind: index === 0 ? 'independent_review' : 'manufacturing_receipt',
      relativePath, bytes: bytes.byteLength, sha256: specialtyIndependentReleaseSha256(bytes),
    };
  });
  const receipt = {
    schema: 'nexyfab.specialty-independent-release-receipt.v1', channel, track: definition.track,
    release: { buildId: 'b', deploymentId: 'd', gitHead: '1'.repeat(40) }, generatedAt, expiresAt,
    qualificationArtifact: { relativePath: qualificationPath, bytes: qualificationBytes.byteLength, sha256: specialtyIndependentReleaseSha256(qualificationBytes) },
    evidenceArtifacts, reviewers: [],
  };
  const keys = SPECIALTY_RELEASE_REVIEW_ROLES.map((role, index) => {
    const pair = generateKeyPairSync('ed25519');
    const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    return {
      role, reviewerId: `${channel}-reviewer-${index + 1}`, privateKey: pair.privateKey, publicKeyPem,
      keyIdSha256: specialtyIndependentReleaseSha256(pair.publicKey.export({ type: 'spki', format: 'der' })),
    };
  });
  const targetSha256 = specialtyIndependentReleaseTargetSha256(receipt);
  receipt.reviewers = keys.map(key => {
    const reviewer = {
      role: key.role, reviewerId: key.reviewerId, publicKeyPem: key.publicKeyPem, keyIdSha256: key.keyIdSha256,
      issuedAt: generatedAt, expiresAt, targetSha256,
    };
    return { ...reviewer, signatureBase64: sign(null, Buffer.from(specialtyIndependentReleaseCanonical(specialtyIndependentReviewerPayload(receipt, reviewer))), key.privateKey).toString('base64') };
  });
  return {
    receipt: attachSpecialtyIndependentReleaseReceiptSha256(receipt),
    trustedReviewers: Object.fromEntries(keys.map(key => [key.reviewerId, { publicKeyPem: key.publicKeyPem, roles: [key.role] }])),
  };
}

test('rejects label-only operations and expert receipts', () => {
  assert.equal(sevenDayOperationsReceiptEligible({ ok: true }), false);
  assert.equal(expertReviewReceiptEligible({ ok: true }, 'platform'), false);
});

test('uses the bound security v2 receipt as promotion authority and keeps raw aggregates diagnostic', () => {
  const result = evaluateCommercializationReadiness(passing);
  assert.equal(result.securityEvidence.receiptVerified, true);
  assert.match(result.securityEvidence.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.securityEvidence.sourceBindings.length, 5);

  const rawMismatch = structuredClone(passing);
  rawMismatch.security = { routeMatrixOk: false, cadApiControlsOk: false, secretFindings: 9, dependencyVulnerabilities: 9 };
  const rawResult = evaluateCommercializationReadiness(rawMismatch);
  assert.equal(rawResult.privateBeta.blockers.includes('route_security_matrix_failed'), false);
  assert.equal(rawResult.privateBeta.blockers.includes('cad_api_controls_failed'), false);
  assert.equal(rawResult.privateBeta.blockers.includes('secret_scan_failed'), false);
  assert.equal(rawResult.privateBeta.blockers.includes('dependency_audit_failed'), false);
  assert.equal(rawResult.privateBeta.eligible, true);
  assert.deepEqual(rawResult.securityEvidence.rawDiagnostics, rawMismatch.security);
});

test('keeps missing, tampered, stale, and release-transplanted security receipts on HOLD', () => {
  const cases = [
    ['missing', null],
    ['tampered', (() => {
      const receipt = structuredClone(passing.securityReceipt);
      receipt.sourceBindings[0].sha256 = 'f'.repeat(64);
      return receipt;
    })()],
    ['stale', (() => {
      const receipt = structuredClone(passing.securityReceipt);
      receipt.generatedAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
      return attachReceiptSha256(receipt);
    })()],
    ['transplanted', (() => {
      const receipt = structuredClone(passing.securityReceipt);
      receipt.release.deploymentId = 'previous-deployment';
      return attachReceiptSha256(receipt);
    })()],
  ];
  for (const [label, securityReceipt] of cases) {
    const input = structuredClone(passing);
    input.securityReceipt = securityReceipt;
    const result = evaluateCommercializationReadiness(input);
    assert.equal(result.privateBeta.eligible, false, label);
    assert.ok(result.privateBeta.blockers.includes('commercial_security_receipt_missing'), label);
    assert.equal(result.securityEvidence.receiptVerified, false, label);
  }
});

test('requires immutable, fresh, release-bound resource evidence derived from measurements', () => {
  assert.equal(resourceBaselineReceiptEligible(passing.resourceBaseline, expectedReleaseBinding, { root: evidenceRoot }), true);

  const booleanOnly = { assessment: { currentMaxWithinTarget: true } };
  assert.equal(resourceBaselineReceiptEligible(booleanOnly, expectedReleaseBinding), false);

  const stale = structuredClone(passing.resourceBaseline);
  stale.generatedAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  stale.capturedAt = stale.generatedAt;
  assert.equal(resourceBaselineReceiptEligible(attachReceiptSha256(stale), expectedReleaseBinding, { root: evidenceRoot }), false);

  const transplanted = structuredClone(passing.resourceBaseline);
  transplanted.release.deploymentId = 'previous-deployment';
  assert.equal(resourceBaselineReceiptEligible(attachReceiptSha256(transplanted), expectedReleaseBinding, { root: evidenceRoot }), false);

  const tampered = structuredClone(passing.resourceBaseline);
  tampered.memory.maxMb = 769;
  assert.equal(resourceBaselineReceiptEligible(attachReceiptSha256(tampered), expectedReleaseBinding, { root: evidenceRoot }), false);

  const forgedButWithinTarget = structuredClone(passing.resourceBaseline);
  forgedButWithinTarget.memory.maxMb = 1;
  assert.equal(resourceBaselineReceiptEligible(attachReceiptSha256(forgedButWithinTarget), expectedReleaseBinding, { root: evidenceRoot }), false);
});

test('requires synthetic campaign aggregates bound to corpus/source files and release freshness', () => {
  assert.equal(syntheticCampaignReceiptEligible(passing.syntheticCampaignReceipt, expectedReleaseBinding, {
    expectedCorpusSha256: passing.syntheticCampaignCorpusSha256,
    root: evidenceRoot,
  }), true);

  const labelOnly = { ok: true, domains: syntheticDomains };
  assert.equal(syntheticCampaignReceiptEligible(labelOnly, expectedReleaseBinding), false);

  const wrongAggregate = structuredClone(passing.syntheticCampaignReceipt);
  wrongAggregate.totalRuns -= 1;
  assert.equal(syntheticCampaignReceiptEligible(attachReceiptSha256(wrongAggregate), expectedReleaseBinding, {
    expectedCorpusSha256: passing.syntheticCampaignCorpusSha256,
    root: evidenceRoot,
  }), false);

  const missingSource = structuredClone(passing.syntheticCampaignReceipt);
  missingSource.sourceBindings[0].sha256 = 'f'.repeat(64);
  assert.equal(syntheticCampaignReceiptEligible(attachReceiptSha256(missingSource), expectedReleaseBinding, {
    expectedCorpusSha256: passing.syntheticCampaignCorpusSha256,
    root: evidenceRoot,
  }), false);
});

test('requires immutable, fresh release-bound Closed Beta and protected-state receipts', () => {
  assert.equal(closedBetaIntegrityReceiptEligible(closedBetaReceipt, expectedReleaseBinding, Date.now(), true), true);
  assert.equal(productionProtectedStateReceiptEligible(productionProtectedStateReceipt, expectedReleaseBinding), true);
  assert.equal(closedBetaIntegrityReceiptEligible({ ok: true, differences: [] }, expectedReleaseBinding, Date.now(), true), false);

  const tamperedClosedBeta = { ...closedBetaReceipt, summary: { ...closedBetaReceipt.summary, protectedRowCount: 2 } };
  assert.equal(closedBetaIntegrityReceiptEligible(tamperedClosedBeta, expectedReleaseBinding, Date.now(), true), false);
  const staleProtectedState = attachReceiptSha256({ ...productionProtectedStateReceipt, generatedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString() });
  assert.equal(productionProtectedStateReceiptEligible(staleProtectedState, expectedReleaseBinding), false);
  const sameDatabaseEvidence = {
    ...productionProtectedStateReceipt.evidence,
    candidate: { ...productionProtectedStateReceipt.evidence.candidate, identitySha256: productionProtectedStateReceipt.evidence.baseline.identitySha256 },
  };
  const sameDatabase = attachReceiptSha256({
    ...productionProtectedStateReceipt,
    evidence: sameDatabaseEvidence,
    comparisonSha256: sha256({ tables: productionProtectedStateReceipt.tables, blockers: [], evidence: sameDatabaseEvidence }),
  });
  assert.equal(productionProtectedStateReceiptEligible(sameDatabase, expectedReleaseBinding), false);
});

test('requires fresh production smoke and same-build isolated staging authenticated E2E receipts', () => {
  assert.equal(liveSmokeReceiptEligible(liveSmokeReceipt, expectedReleaseBinding), true);
  assert.equal(authenticatedE2EReceiptEligible(authenticatedE2EReceipt, expectedReleaseBinding), true);

  const legacySmoke = { status: 'pass', target: 'https://nexyfab.com' };
  assert.equal(liveSmokeReceiptEligible(legacySmoke, expectedReleaseBinding), false);
  const legacyE2E = { ok: true, target: 'https://nexyfab.com' };
  assert.equal(authenticatedE2EReceiptEligible(legacyE2E, expectedReleaseBinding), false);

  const staleSmoke = structuredClone(liveSmokeReceipt);
  staleSmoke.generatedAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  staleSmoke.sha256 = createHash('sha256').update(JSON.stringify({ ...staleSmoke, sha256: undefined })).digest('hex');
  assert.equal(liveSmokeReceiptEligible(staleSmoke, expectedReleaseBinding), false);

  const productionE2E = structuredClone(authenticatedE2EReceipt);
  productionE2E.target = 'https://nexyfab.com';
  assert.equal(authenticatedE2EReceiptEligible(productionE2E, expectedReleaseBinding), false);

  const transplantedSmoke = structuredClone(liveSmokeReceipt);
  transplantedSmoke.release.deploymentId = 'previous-deployment';
  assert.equal(liveSmokeReceiptEligible(transplantedSmoke, expectedReleaseBinding), false);

  const badReady = structuredClone(authenticatedE2EReceipt);
  badReady.ready.redis.status = 'error';
  assert.equal(authenticatedE2EReceiptEligible(badReady, expectedReleaseBinding), false);
});

test('requires source-bound architecture/interior recovery only for affected release domains', () => {
  const valid = evaluateCommercializationReadiness(structuredClone(passing));
  assert.equal(valid.architectureInteriorRecoveryEvidence.receiptVerified, true);
  assert.equal(valid.privateBeta.blockers.includes('architecture_interior_recovery_not_passed'), false);

  const missing = structuredClone(passing);
  missing.architectureInteriorRecovery = null;
  missing.architectureInteriorRecoveryReceiptVerified = false;
  const missingResult = evaluateCommercializationReadiness(missing);
  assert.ok(missingResult.privateBeta.blockers.includes('architecture_interior_recovery_not_passed'));

  const targetMismatch = structuredClone(passing);
  targetMismatch.authenticatedE2E.target = 'https://other-staging.nexyfab.com';
  const targetMismatchResult = evaluateCommercializationReadiness(targetMismatch);
  assert.ok(targetMismatchResult.privateBeta.blockers.includes('architecture_interior_recovery_not_passed'));

  const mechanical = structuredClone(passing);
  mechanical.releaseChannel = 'mechanical-core';
  mechanical.validationCorpus.lanes.synthetic.summary.byDomain = { mechanical: 20 };
  mechanical.validationCorpus.lanes.independentHoldout.domains = { mechanical: structuredClone(domains.mechanical) };
  mechanical.syntheticCampaignReceipt = scopedSyntheticCampaignReceipt(['mechanical']);
  mechanical.syntheticCampaignCorpusSha256 = mechanical.syntheticCampaignReceipt.corpus.sha256;
  mechanical.architectureInteriorRecovery = null;
  mechanical.architectureInteriorRecoveryReceiptVerified = false;
  const mechanicalResult = evaluateCommercializationReadiness(mechanical);
  assert.equal(mechanicalResult.architectureInteriorRecoveryEvidence.required, false);
  assert.equal(mechanicalResult.privateBeta.blockers.includes('architecture_interior_recovery_not_passed'), false);
});

test('requires a fresh production-bound isolated restore drill through migration 2208', () => {
  assert.equal(restoreReceiptEligible(restoreReceipt, expectedReleaseBinding), true);
  assert.equal(restoreReceiptEligible({ ok: true }, expectedReleaseBinding), false);

  const stale = rebindReceipt({ ...restoreReceipt, generatedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString() });
  assert.equal(restoreReceiptEligible(stale, expectedReleaseBinding), false);

  const stagingTarget = rebindReceipt({ ...restoreReceipt, target: 'staging' });
  assert.equal(restoreReceiptEligible(stagingTarget, expectedReleaseBinding), false);

  const transplanted = rebindReceipt({ ...restoreReceipt, release: { ...restoreReceipt.release, deploymentId: 'previous-deployment' } });
  assert.equal(restoreReceiptEligible(transplanted, expectedReleaseBinding), false);

  const selfAsserted = rebindReceipt({
    ...restoreReceipt,
    source: { ...restoreReceipt.source, tableContentSha256: 'c'.repeat(64) },
  });
  assert.equal(restoreReceiptEligible(selfAsserted, expectedReleaseBinding), false);

  const wrongMigration = rebindReceipt({
    ...restoreReceipt,
    migration: { ...restoreReceipt.migration, targetVersion: 2026082402 },
  });
  assert.equal(restoreReceiptEligible(wrongMigration, expectedReleaseBinding), false);
});

test('accepts only trusted Ed25519 expert signoffs bound to the release and corpus', () => {
  const context = {
    expectedRelease: expertExpectedRelease,
    expectedHoldoutCorpusSha256: expertCorpusHash,
    trustedReviewers: expertTrustedReviewers,
    now: Date.now(),
  };
  assert.equal(expertReviewReceiptEligible(expertReviewReceipt, 'platform', context), true);

  const forged = structuredClone(expertReviewReceipt);
  forged.reviewers[0].signature = Buffer.from('forged').toString('base64');
  assert.equal(expertReviewReceiptEligible(forged, 'platform', context), false);

  const stale = structuredClone(expertReviewReceipt);
  stale.generatedAt = new Date(Date.now() - 91 * 86_400_000).toISOString();
  assert.equal(expertReviewReceiptEligible(stale, 'platform', context), false);

  const transplantedCorpus = structuredClone(expertReviewReceipt);
  transplantedCorpus.holdoutCorpusSha256 = 'd'.repeat(64);
  assert.equal(expertReviewReceiptEligible(transplantedCorpus, 'platform', {
    ...context,
    expectedHoldoutCorpusSha256: transplantedCorpus.holdoutCorpusSha256,
  }), false);

  const transplantedRelease = structuredClone(expertReviewReceipt);
  transplantedRelease.release.buildId = 'other-build';
  assert.equal(expertReviewReceiptEligible(transplantedRelease, 'platform', {
    ...context,
    expectedRelease: { buildId: transplantedRelease.release.buildId, head: transplantedRelease.release.gitHead },
  }), false);
});

test('rejects stale, incomplete, or release-transplanted production migration receipts', () => {
  const expected = { buildId: 'b', deploymentId: 'd', head: '1'.repeat(40) };
  assert.equal(productionMigrationReceiptEligible(passing.migrationReceipt, expected, Date.now(), true), true);

  const stale = structuredClone(passing.migrationReceipt);
  stale.generatedAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  assert.equal(productionMigrationReceiptEligible(stale, expected, Date.now(), true), false);

  const incomplete = structuredClone(passing.migrationReceipt);
  incomplete.migrations.pop();
  assert.equal(productionMigrationReceiptEligible(incomplete, expected, Date.now(), true), false);

  const transplanted = structuredClone(passing.migrationReceipt);
  transplanted.release.deploymentId = 'other-deployment';
  assert.equal(productionMigrationReceiptEligible(transplanted, expected, Date.now(), true), false);

  assert.equal(productionMigrationReceiptEligible(passing.migrationReceipt, expected, Date.now(), false), false);
});

test('rejects weakened, incomplete, or replayed seven-day receipts', () => {
  assert.equal(sevenDayOperationsReceiptEligible(passing.sevenDayOperationsReceipt, passing.releaseBaseline.release), false);

  const weakened = structuredClone(passing.sevenDayOperationsReceipt);
  weakened.policy.requiredSampleCount = 1;
  assert.equal(sevenDayOperationsReceiptEligible(weakened, passing.releaseBaseline.release, Date.now(), true), false);

  const incomplete = structuredClone(passing.sevenDayOperationsReceipt);
  delete incomplete.services['fea-worker'];
  assert.equal(sevenDayOperationsReceiptEligible(incomplete, passing.releaseBaseline.release, Date.now(), true), false);

  const replayed = structuredClone(passing.sevenDayOperationsReceipt);
  replayed.release.buildId = 'previous-build';
  assert.equal(sevenDayOperationsReceiptEligible(replayed, passing.releaseBaseline.release, Date.now(), true), false);
});

test('passes both tiers only with complete evidence', () => {
  const result = evaluateCommercializationReadiness(passing);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, true);
});

test('keeps private beta and GA fail-closed independently', () => {
  const input = structuredClone(passing);
  input.liveSmoke.status = 'fail';
  input.validationCorpus.lanes.independentHoldout.domains.building.releaseEligible = false;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('production_smoke_not_passed'));
  assert.ok(result.commercialGa.blockers.includes('independent_holdout_not_eligible:building'));
});

test('requires an isolated distributed quota store for a commercial runtime', () => {
  const input = structuredClone(passing);
  input.environmentIsolationReceipt.checks.find(check => check.id === 'redis_url_isolated').pass = false;
  input.environmentIsolationReceipt.ok = false;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('distributed_quota_environment_not_verified'));
});

test('blocks a committed baseline that does not describe the current release head', () => {
  const input = structuredClone(passing);
  input.currentRelease.head = 'head-2';
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('release_baseline_head_mismatch'));
  assert.ok(result.commercialGa.blockers.includes('release_baseline_head_mismatch'));
});

test('does not trust an old clean baseline after release files become dirty', () => {
  const input = structuredClone(passing);
  input.currentRelease.workingTreeChanges = 1;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('current_release_working_tree_dirty'));
});

test('commercial GA requires the complete complex-product corpus, dual approvals, and manufacturing scope', () => {
  const input = structuredClone(passing);
  input.complexHoldoutCases.pop();
  input.complexGroundTruthValidation.summary.approved = 119;
  input.complexGroundTruthValidation.byFamily.interior.approved = 19;
  input.complexProductScope.decision.broadComplexProductSelfServiceEligible = false;
  input.complexProductScope.decision.manufacturingReleaseGuaranteed = false;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, false);
  for (const blocker of [
    'complex_holdout_integrity_incomplete',
    'complex_holdout_family_incomplete:interior:19/20',
    'complex_ground_truth_dual_approval_incomplete',
    'complex_product_self_service_not_eligible',
    'complex_manufacturing_release_not_verified',
  ]) assert.ok(result.commercialGa.blockers.includes(blocker), `missing blocker: ${blocker}`);
});

test('mechanical-core is independent from spatial Labs and complex-product evidence', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'mechanical-core';
  input.validationCorpus.lanes.synthetic.summary.byDomain = { mechanical: 20 };
  input.validationCorpus.lanes.independentHoldout.domains = { mechanical: structuredClone(domains.mechanical) };
  input.syntheticCampaignReceipt = scopedSyntheticCampaignReceipt(['mechanical']);
  input.syntheticCampaignCorpusSha256 = input.syntheticCampaignReceipt.corpus.sha256;
  input.complexHoldoutCases = [];
  input.complexGroundTruthValidation = null;
  input.complexProductScope = null;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.releaseChannel, 'mechanical-core');
  assert.deepEqual(result.requiredDomains, ['mechanical']);
  assert.deepEqual(result.requiredComplexFamilies, []);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, true);
});

test('promotes one Verified Systems family without borrowing another family evidence', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'verified-machine-skid';
  input.expertReviewReceipt = rebindExpertReviewReceipt(input.releaseChannel);
  input.complexHoldoutCases = input.complexHoldoutCases.filter(item => item.family === 'machine_skid');
  input.complexGroundTruthValidation.results.filter(item => item.family !== 'machine_skid').forEach(item => { item.status = 'pending'; item.scoreEligible = false; });
  input.complexGroundTruthValidation.summary.pending = 140;
  input.complexGroundTruthValidation.summary.approved = 20;
  const result = evaluateCommercializationReadiness(input);
  assert.deepEqual(result.requiredComplexFamilies, ['machine_skid']);
  assert.equal(result.commercialGa.eligible, true);
  input.complexGroundTruthValidation.results.find(item => item.family === 'machine_skid').status = 'pending';
  input.complexGroundTruthValidation.results.find(item => item.family === 'machine_skid').scoreEligible = false;
  const approvalBlocked = evaluateCommercializationReadiness(input);
  assert.ok(approvalBlocked.commercialGa.blockers.includes('complex_ground_truth_dual_approval_incomplete'));
  input.complexGroundTruthValidation.results.filter(item => item.family === 'machine_skid').forEach(item => { item.status = 'approved'; item.scoreEligible = true; });
  input.complexProductScope.families.machine_skid.manufacturingReleaseVerified = false;
  const blocked = evaluateCommercializationReadiness(input);
  assert.ok(blocked.commercialGa.blockers.includes('complex_family_manufacturing_not_verified:machine_skid'));
});

test('spatial-labs never borrows mechanical or complex-product evidence', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'spatial-labs';
  input.expertReviewReceipt = rebindExpertReviewReceipt(input.releaseChannel);
  delete input.validationCorpus.lanes.synthetic.summary.byDomain.mechanical;
  delete input.validationCorpus.lanes.independentHoldout.domains.mechanical;
  input.syntheticCampaignReceipt = scopedSyntheticCampaignReceipt(['building', 'civil', 'landscape', 'interior']);
  input.syntheticCampaignCorpusSha256 = input.syntheticCampaignReceipt.corpus.sha256;
  input.mechanicalProductScope = null;
  input.complexHoldoutCases = [];
  input.complexGroundTruthValidation = null;
  input.complexProductScope = null;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.releaseChannel, 'spatial-labs');
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, true);
});

test('a verified spatial discipline can graduate without sibling-domain evidence', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'verified-building';
  input.expertReviewReceipt = rebindExpertReviewReceipt(input.releaseChannel);
  input.validationCorpus.lanes.synthetic.summary.byDomain = { building: 20 };
  input.validationCorpus.lanes.independentHoldout.domains = { building: structuredClone(domains.building) };
  input.syntheticCampaignReceipt = scopedSyntheticCampaignReceipt(['building']);
  input.syntheticCampaignCorpusSha256 = input.syntheticCampaignReceipt.corpus.sha256;
  input.mechanicalProductScope = null;
  input.complexHoldoutCases = [];
  input.complexGroundTruthValidation = null;
  input.complexProductScope = null;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.releaseChannel, 'verified-building');
  assert.deepEqual(result.requiredDomains, ['building']);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, true);

  input.validationCorpus.lanes.independentHoldout.domains.building.releaseEligible = false;
  const blocked = evaluateCommercializationReadiness(input);
  assert.equal(blocked.privateBeta.eligible, true);
  assert.equal(blocked.commercialGa.eligible, false);
  assert.ok(blocked.commercialGa.blockers.includes('independent_holdout_not_eligible:building'));
});

test('specialty channels require their own signed release evidence and borrow no product-scope boolean', () => {
  const channels = [
    'verified-sheet-metal', 'verified-welded-fabrication', 'verified-mold-tooling',
    'verified-piping', 'verified-hvac', 'verified-ecad-mcad',
  ];
  for (const channel of channels) {
    const contract = releaseContractFor(channel);
    assert.equal(contract?.channel, channel);
    assert.deepEqual(contract?.domains, []);
    assert.deepEqual(contract?.complexFamilies, []);
    assert.ok(contract?.specialtyTrack);

    const missing = structuredClone(passing);
    missing.releaseChannel = channel;
    missing.mechanicalProductScope = null;
    missing.complexProductScope = null;
    const result = evaluateCommercializationReadiness(missing);
    assert.equal(result.privateBeta.eligible, false, channel);
    assert.ok(result.privateBeta.blockers.some(item => item.startsWith('specialty_independent_release_receipt_missing:')), channel);
    assert.equal(result.specialtyEvidence.receiptVerified, false, channel);
  }

  const fixture = buildSpecialtyGateFixture();
  const valid = structuredClone(passing);
  valid.releaseChannel = 'verified-sheet-metal';
  valid.specialtyReleaseReceipt = fixture.receipt;
  valid.specialtyReleaseTrustedReviewers = fixture.trustedReviewers;
  valid.mechanicalProductScope = null;
  valid.complexProductScope = null;
  valid.complexHoldoutCases = [];
  valid.complexGroundTruthValidation = null;
  const accepted = evaluateCommercializationReadiness(valid);
  assert.equal(accepted.privateBeta.eligible, true, accepted.privateBeta.blockers.join(','));
  assert.equal(accepted.commercialGa.eligible, true, accepted.commercialGa.blockers.join(','));
  assert.equal(accepted.specialtyEvidence.receiptVerified, true);

  valid.specialtyReleaseReceipt.release.deploymentId = 'transplanted-deployment';
  const transplanted = evaluateCommercializationReadiness(valid);
  assert.equal(transplanted.privateBeta.eligible, false);
  assert.ok(transplanted.privateBeta.blockers.includes('specialty_independent_release_receipt_missing:sheet-metal'));
});

test('an unknown release channel fails closed', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'unknown';
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('release_channel_invalid:unknown'));
});

test('mechanical-core rejects unbound decision booleans without the evidence contract', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'mechanical-core';
  input.mechanicalProductScope = { decision: { privateBetaEligible: true, selfServiceEligible: true, manufacturingReleaseVerified: true } };
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.equal(result.commercialGa.eligible, false);
  assert.ok(result.commercialGa.blockers.includes('mechanical_product_scope_contract_incomplete'));
});

test('mechanical-core reports precise direct-design evidence gaps for a valid pending assessment', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'mechanical-core';
  input.validationCorpus.lanes.synthetic.summary.byDomain = { mechanical: 20 };
  input.validationCorpus.lanes.independentHoldout.domains = { mechanical: { ...structuredClone(domains.mechanical), releaseEligible: false } };
  input.syntheticCampaignReceipt = scopedSyntheticCampaignReceipt(['mechanical']);
  input.syntheticCampaignCorpusSha256 = input.syntheticCampaignReceipt.corpus.sha256;
  input.mechanicalProductScope.evidence = {
    internalRegressionVerified: true,
    coreThirtyFeatureClosedLoopVerified: true,
    directDesignCandidateVerified: true,
    directDesignThirtyVerified: false,
    intentCampaign150Verified: false,
    standardStepConformanceVerified: false,
    artifactRevisionConsistencyVerified: true,
    blindProductChallengeVerified: false,
    manufacturingReceiptVerified: false,
  };
  input.mechanicalProductScope.decision = {
    privateBetaEligible: true,
    selfServiceEligible: false,
    manufacturingReleaseVerified: false,
    failClosed: true,
    status: 'ga_evidence_pending',
  };
  input.mechanicalProductScope.blockers = [
    'thirty_direct_design_packages_required',
    'mechanical_intent_campaign_150_required',
    'standard_step_conformance_required',
    'twenty_blind_product_challenges_required',
    'three_manufactured_pilot_receipts_required',
  ];
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, false);
  assert.equal(result.commercialGa.blockers.includes('mechanical_product_scope_contract_incomplete'), false);
  assert.equal(result.commercialGa.blockers.includes('independent_holdout_not_eligible:mechanical'), false);
  for (const blocker of [
    'mechanical_scope_thirty_direct_designs_incomplete',
    'mechanical_scope_intent_campaign_150_incomplete',
    'mechanical_scope_standard_step_conformance_incomplete',
    'mechanical_scope_blind_product_challenge_incomplete',
    'mechanical_scope_manufacturing_receipt_incomplete',
    'mechanical_product_self_service_not_eligible',
    'mechanical_manufacturing_release_not_verified',
  ]) assert.ok(result.commercialGa.blockers.includes(blocker), `missing blocker: ${blocker}`);
  assert.equal(result.commercialGa.blockers.includes('mechanical_scope_revision_consistency_incomplete'), false);
});

test('mechanical-core refuses legacy v2 scope receipts instead of reinterpreting them under v3 policy', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'mechanical-core';
  input.mechanicalProductScope.schema = 'nexyfab.mechanical-product-scope-assessment.v2';
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('mechanical_product_scope_contract_incomplete'));
});

test('keeps the implicit scope compatible with web private beta but refuses an ambiguous GA claim', () => {
  const input = structuredClone(passing);
  delete input.productReleaseScope;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.productReleaseScope.explicit, false);
  assert.deepEqual(result.productReleaseScope.surfaces, ['web']);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, false);
  assert.ok(result.commercialGa.blockers.includes('product_release_scope_not_explicit_for_ga'));
});

test('delegates Windows desktop release evidence to the strict SEA verifier', () => {
  const accepted = windowsSeaReleaseStatus(windowsSeaReceipt, passing.releaseBaseline.release, {
    root: evidenceRoot,
    now: fixtureNow,
    trustedKeyAllowlist: windowsSeaTrustedKeyAllowlist,
  });
  assert.deepEqual(accepted, { ok: true, blockers: [] });

  const untrusted = windowsSeaReleaseStatus(windowsSeaReceipt, passing.releaseBaseline.release, {
    root: evidenceRoot,
    now: fixtureNow,
    trustedKeyAllowlist: {},
  });
  assert.equal(untrusted.ok, false);
  assert.ok(untrusted.blockers.includes('trusted_release_attestation_invalid'));

  const invented = attachReceiptSha256({
    ...windowsSeaReceipt,
    signing: { ...windowsSeaReceipt.signing, timestampAuthority: 'invented-tsa' },
  });
  const blocked = windowsSeaReleaseStatus(invented, passing.releaseBaseline.release, {
    root: evidenceRoot,
    now: fixtureNow,
    trustedKeyAllowlist: windowsSeaTrustedKeyAllowlist,
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.includes('authenticode_not_verified'));
});

test('requires all product receipts for an explicit full-product release scope', () => {
  const missing = structuredClone(passing);
  missing.productReleaseScope = 'full-product';
  const blocked = evaluateCommercializationReadiness(missing);
  assert.equal(blocked.privateBeta.eligible, false);
  for (const blocker of [
    'enterprise_sso_readiness_receipt_missing',
    'windows_sea_release_receipt_missing',
    'large_upload_staging_readiness_receipt_missing',
  ]) assert.ok(blocked.privateBeta.blockers.includes(blocker), blocker);
  assert.equal(blocked.productEvidence.enterpriseSso.receiptVerified, false);
  assert.ok(blocked.productEvidence.windowsAgentSidecar.blockers.includes('sea_mcp_cli_parity_not_verified'));
  const expectedLargeUploadBlockers = largeUploadStagingReadinessStatus(null, passing.releaseBaseline.release, {
    root: evidenceRoot,
    now: fixtureNow,
  }).blockers;
  assert.deepEqual(blocked.productEvidence.largeUpload.blockers, expectedLargeUploadBlockers);
  assert.ok(blocked.productEvidence.largeUpload.blockers.includes('large_upload_worker_memory_not_verified'));
  for (const track of Object.keys(fullProductSpecialtyChannels)) {
    assert.ok(blocked.privateBeta.blockers.includes(`full_product_specialty_receipt_missing:${track}`), track);
    assert.equal(blocked.productEvidence.specialtyTracks[track].required, true);
    assert.equal(blocked.productEvidence.specialtyTracks[track].receiptVerified, false);
    assert.ok(blocked.productEvidence.specialtyTracks[track].blockers.includes('receipt_missing'));
  }
  assert.deepEqual(blocked.evaluatedReleaseBaseline, passingReleaseBaselineBinding);
  assert.deepEqual(blocked.release, {
    branch: 'release/test', gitHead: '1'.repeat(40), baselineStatus: 'committed', workingTreeChanges: 0,
    deploymentId: 'd', buildId: 'b', rollbackDeploymentId: 'r', dockerImageDigest: 'sha256:x',
    dbSchemaVersion: 2026082403,
  });

  const complete = structuredClone(passing);
  complete.productReleaseScope = 'full-product';
  complete.enterpriseSsoReceipt = enterpriseSsoReceipt;
  complete.windowsSeaReceipt = windowsSeaReceipt;
  complete.largeUploadStagingReceipt = largeUploadStagingReceipt;
  const specialtyFixtures = Object.fromEntries(Object.entries(fullProductSpecialtyChannels)
    .map(([track, channel]) => [track, buildSpecialtyGateFixture(channel)]));
  complete.fullProductSpecialtyReceipts = Object.fromEntries(Object.entries(specialtyFixtures)
    .map(([track, fixture]) => [track, fixture.receipt]));
  complete.specialtyReleaseTrustedReviewers = Object.assign(
    {},
    ...Object.values(specialtyFixtures).map(fixture => fixture.trustedReviewers),
  );
  assert.equal(complete.windowsSeaReceipt.status, 'PASS', complete.windowsSeaReceipt.blockers.join(','));
  const accepted = evaluateCommercializationReadiness(complete);
  assert.equal(accepted.privateBeta.eligible, true, accepted.privateBeta.blockers.join(','));
  assert.equal(accepted.commercialGa.eligible, true, accepted.commercialGa.blockers.join(','));
  assert.equal(accepted.productEvidence.enterpriseSso.receiptVerified, true);
  assert.equal(accepted.productEvidence.windowsAgentSidecar.receiptVerified, true);
  assert.equal(accepted.productEvidence.largeUpload.receiptVerified, true);
  for (const track of Object.keys(fullProductSpecialtyChannels)) {
    assert.equal(accepted.productEvidence.specialtyTracks[track].receiptVerified, true, track);
    assert.deepEqual(accepted.productEvidence.specialtyTracks[track].blockers, [], track);
  }
  assert.deepEqual(accepted.productEvidence.windowsAgentSidecar.sourceBindings, windowsSeaReceipt.sourceBindings);

  const missingPiping = structuredClone(complete);
  delete missingPiping.fullProductSpecialtyReceipts.piping;
  const missingPipingResult = evaluateCommercializationReadiness(missingPiping);
  assert.equal(missingPipingResult.privateBeta.eligible, false);
  assert.ok(missingPipingResult.privateBeta.blockers.includes('full_product_specialty_receipt_missing:piping'));
  assert.ok(missingPipingResult.productEvidence.specialtyTracks.piping.blockers.includes('receipt_missing'));
  assert.equal(missingPipingResult.productEvidence.specialtyTracks.hvac.receiptVerified, true);

  const tamperedLargeUpload = structuredClone(complete);
  tamperedLargeUpload.largeUploadStagingReceipt = attachReceiptSha256({
    ...tamperedLargeUpload.largeUploadStagingReceipt,
    workerMemory: { ...tamperedLargeUpload.largeUploadStagingReceipt.workerMemory, peakRssMb: 900 },
  });
  const tamperedResult = evaluateCommercializationReadiness(tamperedLargeUpload);
  assert.equal(tamperedResult.productEvidence.largeUpload.receiptVerified, false);
  assert.ok(tamperedResult.productEvidence.largeUpload.blockers.includes('receipt_not_derived_from_bound_artifacts'));
});

test('rejects a full-product claim on a release channel without the platform domain contract', () => {
  const input = structuredClone(passing);
  input.releaseChannel = 'mechanical-core';
  input.productReleaseScope = 'full-product';
  input.enterpriseSsoReceipt = enterpriseSsoReceipt;
  input.windowsSeaReceipt = windowsSeaReceipt;
  input.largeUploadStagingReceipt = largeUploadStagingReceipt;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.equal(result.commercialGa.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('full_product_scope_release_channel_incompatible'));
  assert.ok(result.commercialGa.blockers.includes('full_product_scope_release_channel_incompatible'));
  assert.deepEqual(result.requiredDomains, ['mechanical']);
  assert.deepEqual(result.requiredComplexFamilies, []);
});

test('fails closed on ambiguous scopes and receipt tampering without synthesizing PASS', () => {
  const ambiguous = structuredClone(passing);
  ambiguous.productReleaseScope = 'platform-ga-ish';
  ambiguous.enterpriseSsoReceipt = enterpriseSsoReceipt;
  ambiguous.windowsSeaReceipt = windowsSeaReceipt;
  ambiguous.largeUploadStagingReceipt = largeUploadStagingReceipt;
  const ambiguousResult = evaluateCommercializationReadiness(ambiguous);
  assert.equal(ambiguousResult.productReleaseScope.valid, false);
  assert.deepEqual(ambiguousResult.productReleaseScope.surfaces, ['web', 'enterprise', 'desktop', 'large-upload']);
  assert.ok(ambiguousResult.privateBeta.blockers.includes('product_release_scope_invalid_or_ambiguous'));

  const cases = [
    ['sso release transplant', 'enterprise', 'enterpriseSsoReceipt', enterpriseSsoReceipt, receipt => { receipt.release.buildId = 'other'; }, enterpriseSsoReadinessStatus],
    ['sso source binding tamper', 'enterprise', 'enterpriseSsoReceipt', enterpriseSsoReceipt, receipt => { receipt.sourceBindings[0].sha256 = 'c'.repeat(64); }, enterpriseSsoReadinessStatus],
    ['SEA parity not executed', 'desktop', 'windowsSeaReceipt', windowsSeaReceipt, receipt => { receipt.parity.executableInvoked = false; }, windowsSeaReleaseStatus],
    ['large upload memory over limit', 'large-upload', 'largeUploadStagingReceipt', largeUploadStagingReceipt, receipt => { receipt.workerMemory.peakRssMb = 900; }, largeUploadStagingReadinessStatus],
  ];
  for (const [label, scope, field, source, mutate, statusFn] of cases) {
    const input = structuredClone(passing);
    input.productReleaseScope = scope;
    const receipt = structuredClone(source);
    mutate(receipt);
    input[field] = attachReceiptSha256(receipt);
    const direct = statusFn(input[field], passing.releaseBaseline.release, {
      root: evidenceRoot,
      now: fixtureNow,
      trustedKeyAllowlist: windowsSeaTrustedKeyAllowlist,
    });
    assert.equal(direct.ok, false, label);
    const result = evaluateCommercializationReadiness(input);
    assert.equal(result.privateBeta.eligible, false, label);
  }
});

test('normalizes only explicit, unambiguous product release scopes', () => {
  assert.deepEqual(productReleaseScopeFor('enterprise,desktop').surfaces, ['web', 'enterprise', 'desktop']);
  assert.deepEqual(productReleaseScopeFor('all').surfaces, ['web', 'enterprise', 'desktop', 'large-upload']);
  assert.equal(productReleaseScopeFor('').explicit, false);
  assert.equal(productReleaseScopeFor('full-product,web').valid, false);
});
