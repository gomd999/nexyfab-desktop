import { createHash, createHmac } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DbAdapter } from '@/lib/db-adapter';
import { loadExternalCommercialVerifierRegistry } from '@/lib/ai/externalCommercialVerifierRegistry';
import {
  COMMERCIAL_POSTGRES_MIGRATIONS,
  commercialPostgresMigrationChecksumEnvKey,
} from '@/lib/commercial-readiness';

const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const RAILWAY_DEPLOYMENT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const COMMERCIAL_PRECISION_RUNTIME_SCHEMA = 'nexyfab.commercial-precision-runtime-evidence.v2';
const COMMERCIAL_PRECISION_EXECUTION_CONTRACT = 'nexyfab.precision-cad-commercial-execution.v3';
const COMMERCIAL_PRECISION_MIGRATION_VERSION = 2026082502;
const COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS = [
  'postgresMigration', 'redisAvailability', 'immutableInputWriteReadback',
  'transactionalOutboxEnqueue', 'leaseClaim', 'nativeExecution',
  'threeOutputCommitReadback', 'workerReceiptSignature', 'signedCallback',
  'authoritativePersistence', 'workspaceCasCommit', 'wrongWorkerRejected',
  'inputSubstitutionRejected', 'outputSubstitutionRejected', 'callbackReplayRejected',
] as const;
const COMMERCIAL_PRECISION_GA_CHECKS = [
  'multiInstanceClaimExclusion', 'expiredLeaseRecovery', 'crashAfterClaimRecovery',
  'verifiedUnknownNoReplay', 'credentialRotation',
] as const;
const COMMERCIAL_PRECISION_EVIDENCE_ROLES = [
  'databaseSnapshot', 'objectStorageManifest', 'workerReceipt',
  'negativeCampaign', 'recoveryCampaign',
] as const;

type EvidenceStatus = 'PASS' | 'HOLD' | 'NOT_RUN';
type Environment = Readonly<Record<string, string | undefined>>;
type SignedReceipt = Record<string, unknown> & {
  generatedAt?: unknown;
  receiptSha256?: unknown;
  receiptHmacSha256?: unknown;
  signature?: unknown;
};
type EvidenceBinding = { file?: unknown; path?: unknown; sha256?: unknown };
type OperationService = {
  coverageHours?: number; spanHours?: number; samples?: number; uniqueWindows?: number;
  invalidWindows?: number; overlaps?: number; gaps?: number; durationMismatches?: number;
  maxMemoryMb?: number; minimumRuntimeMemoryLimitMb?: number;
  totalRequests?: number; total5xx?: number; errorRatePercent?: number;
};
type SevenDayReceipt = SignedReceipt & {
  schema?: unknown; ok?: unknown; blockers?: unknown[];
  policy?: { requiredCoverageHours?: number; requiredSampleCount?: number; expectedWindowHours?: number; http5xxMaxPercent?: number; requireRuntimeMemoryLimitEvidence?: boolean; monthlyCostBudgetUsd?: number; memoryLimitsMb?: Record<string, number> };
  services?: Record<string, OperationService>;
  cost?: { ok?: boolean; blockers?: unknown[]; samples?: number; coverageHours?: number; projectedMonthlyDollars?: number; monthlyBudgetDollars?: number; scopedServices?: string[] };
  release?: { environment?: string; buildId?: string; head?: string; qualifyingFrom?: string; deployments?: Record<string, string> };
  evidenceBindings?: { release?: EvidenceBinding; policy?: EvidenceBinding; samples?: EvidenceBinding[]; costSnapshots?: EvidenceBinding[] };
};

export interface ReleaseEvidenceOptions {
  env?: Environment;
  now?: number;
  db?: Pick<DbAdapter, 'backend' | 'queryOne'>;
  i18nReceipt?: unknown;
  sevenDayReceipt?: unknown;
  precisionRuntimeReceipt?: unknown;
  registry?: { identities: readonly { role?: string; fingerprintSha256?: string }[] };
  evidenceRoot?: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.trim()) ? value.trim() : null;
}

function gitCommitSha(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return GIT_COMMIT_SHA.test(candidate) ? candidate.toLowerCase() : null;
}

function railwayDeploymentId(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return RAILWAY_DEPLOYMENT_ID.test(candidate) ? candidate.toLowerCase() : null;
}

function containedRegularFile(root: string, absolute: string, maxBytes?: number): boolean {
  try {
    const resolvedRoot = path.resolve(root);
    const resolvedFile = path.resolve(absolute);
    const lexicalRelative = path.relative(resolvedRoot, resolvedFile);
    if (!lexicalRelative || lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) return false;
    if (!existsSync(resolvedFile) || lstatSync(resolvedFile).isSymbolicLink()) return false;
    const realRoot = realpathSync.native(resolvedRoot);
    const realFile = realpathSync.native(resolvedFile);
    const realRelative = path.relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) return false;
    const stat = statSync(realFile);
    return stat.isFile() && (maxBytes === undefined || stat.size <= maxBytes);
  } catch {
    return false;
  }
}

function fresh(value: unknown, now: number): boolean {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) && timestamp <= now + 5 * 60 * 1000 && now - timestamp <= MAX_EVIDENCE_AGE_MS;
}

function signedReceiptValid(receipt: SignedReceipt, env: Environment, now: number): boolean {
  const withoutSignature = { ...receipt };
  delete withoutSignature.receiptSha256;
  delete withoutSignature.receiptHmacSha256;
  delete withoutSignature.signature;
  const digest = createHash('sha256').update(canonical(withoutSignature)).digest('hex');
  const secret = env.GENERATION_EVIDENCE_SIGNING_SECRET?.trim() ?? '';
  const signature = typeof receipt.receiptHmacSha256 === 'string' ? receipt.receiptHmacSha256 : '';
  const expected = secret.length >= 32
    ? createHmac('sha256', secret).update(canonical({ ...withoutSignature, receiptSha256: receipt.receiptSha256 })).digest('hex')
    : '';
  return fresh(receipt.generatedAt, now)
    && receipt.receiptSha256 === digest
    && SHA256.test(signature)
    && signature === expected;
}

function verifyI18n(receipt: unknown, buildId: string | null, head: string | null, env: Environment, now: number) {
  const value = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt as SignedReceipt & {
    schema?: unknown; status?: unknown; gaReady?: unknown; buildId?: unknown; head?: unknown;
    catalog?: { sourcePairs?: number; translatedPairs?: number; qualified?: boolean };
  } : null;
  const catalog = value?.catalog;
  const sourcePairs = typeof catalog?.sourcePairs === 'number' && Number.isInteger(catalog.sourcePairs) ? catalog.sourcePairs : null;
  const translatedPairs = typeof catalog?.translatedPairs === 'number' && Number.isInteger(catalog.translatedPairs) ? catalog.translatedPairs : null;
  const ok = Boolean(value
    && value.schema === 'nexyfab.commercial-i18n-release-receipt.v2'
    && value.status === 'QUALIFIED'
    && value.gaReady === true
    && catalog?.qualified === true
    && sourcePairs !== null && sourcePairs >= 2711
    && translatedPairs === sourcePairs
    && buildId && value.buildId === buildId
    && head && value.head === head
    && signedReceiptValid(value, env, now));
  return { status: ok ? 'QUALIFIED' : (value ? 'HOLD' : 'NOT_RUN') as EvidenceStatus, sourcePairs, translatedPairs };
}

function validBinding(value: unknown, root = process.cwd()): boolean {
  const binding = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const relativeValue = typeof binding?.file === 'string' ? binding.file : binding?.path;
  const relative = typeof relativeValue === 'string' ? relativeValue.replaceAll('\\', '/') : '';
  if (!binding || !relative || path.isAbsolute(relative) || relative.split('/').includes('..') || !SHA256.test(String(binding.sha256 ?? ''))) return false;
  try {
    const resolvedRoot = path.resolve(root);
    const absolute = path.resolve(resolvedRoot, ...relative.split('/'));
    if (!containedRegularFile(resolvedRoot, absolute)) return false;
    const bytes = readFileSync(absolute);
    return createHash('sha256').update(bytes).digest('hex') === binding.sha256;
  } catch {
    return false;
  }
}

function verifySevenDay(receipt: unknown, buildId: string | null, head: string | null, deploymentId: string | null, env: Environment, now: number, evidenceRoot = process.cwd()) {
  const value = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt as SevenDayReceipt : null;
  const release = value?.release;
  const policy = value?.policy;
  const services = value?.services;
  const serviceNames = ['web', 'openscad-worker', 'fea-worker'];
  const presentServices = services && typeof services === 'object' && !Array.isArray(services) ? Object.keys(services).sort() : [];
  const serviceEvidence = JSON.stringify(presentServices) === JSON.stringify([...serviceNames].sort()) && serviceNames.every(name => {
    const service = services?.[name];
    const memoryLimit = Number(policy?.memoryLimitsMb?.[name]);
    const samples = service?.samples;
    const uniqueWindows = service?.uniqueWindows;
    const maxMemoryMb = service?.maxMemoryMb;
    return Number(service?.coverageHours) >= 168
      && Number(service?.spanHours) >= 168
      && typeof samples === 'number' && Number.isInteger(samples) && samples >= 28
      && typeof uniqueWindows === 'number' && Number.isInteger(uniqueWindows) && uniqueWindows >= 28
      && service?.invalidWindows === 0 && service?.overlaps === 0 && service?.gaps === 0 && service?.durationMismatches === 0
      && typeof maxMemoryMb === 'number' && Number.isFinite(maxMemoryMb) && maxMemoryMb >= 0
      && Number.isFinite(memoryLimit) && memoryLimit > 0 && maxMemoryMb <= memoryLimit
      && Number(service?.minimumRuntimeMemoryLimitMb) >= memoryLimit
      && (name !== 'web' || (Number(service?.totalRequests) > 0
        && Number(service?.total5xx) >= 0 && Number(service.total5xx) <= Number(service.totalRequests)
        && Number(service?.errorRatePercent) >= 0 && Number(service.errorRatePercent) <= Number(policy?.http5xxMaxPercent)));
  });
  const bindings = value?.evidenceBindings;
  const bindingIdentity = (item: unknown) => {
    const binding = item && typeof item === 'object' ? item as EvidenceBinding : {};
    return `${binding.file ?? binding.path ?? ''}:${binding.sha256 ?? ''}`;
  };
  const boundSamples = Array.isArray(bindings?.samples) && bindings.samples.length >= 28
    && new Set(bindings.samples.map(bindingIdentity)).size === bindings.samples.length
    && bindings.samples.every((item: unknown) => validBinding(item, evidenceRoot));
  const boundCost = Array.isArray(bindings?.costSnapshots) && bindings.costSnapshots.length >= 2
    && new Set(bindings.costSnapshots.map(bindingIdentity)).size === bindings.costSnapshots.length
    && bindings.costSnapshots.every((item: unknown) => validBinding(item, evidenceRoot));
  const qualifyingFrom = Date.parse(String(release?.qualifyingFrom ?? ''));
  const generatedAt = Date.parse(String(value?.generatedAt ?? ''));
  const costServices = Array.isArray(value?.cost?.scopedServices) ? [...value.cost.scopedServices].sort() : [];
  const expectedCostServices = ['nexyfab.com', 'nexyfab-openscad-worker', 'nexyfab-fea-worker', 'Postgres-KN2x', 'Redis-IrVt'].sort();
  const ok = Boolean(value
    && value.schema === 'nexyfab.seven-day-operations-receipt.v3'
    && value.ok === true
    && Array.isArray(value.blockers) && value.blockers.length === 0
    && fresh(value.generatedAt, now)
    && release?.environment === 'production'
    && buildId && release.buildId === buildId
    && head && release.head === head
    && deploymentId && release?.deployments?.web === deploymentId
    && Number.isFinite(qualifyingFrom) && Number.isFinite(generatedAt) && generatedAt >= qualifyingFrom + 168 * 60 * 60 * 1000
    && Number(policy?.requiredCoverageHours) >= 168
    && typeof policy?.requiredSampleCount === 'number' && Number.isInteger(policy.requiredSampleCount) && policy.requiredSampleCount >= 28
    && Number(policy?.expectedWindowHours) === 6
    && Number(policy?.http5xxMaxPercent) >= 0 && Number(policy?.http5xxMaxPercent) <= 1
    && policy?.requireRuntimeMemoryLimitEvidence === true
    && serviceEvidence && value.cost?.ok === true
    && Array.isArray(value.cost?.blockers) && value.cost.blockers.length === 0
    && Number(value.cost?.samples) >= 2 && Number(value.cost?.coverageHours) >= 168
    && Number(value.cost?.projectedMonthlyDollars) >= 0
    && Number(value.cost?.projectedMonthlyDollars) <= Number(value.cost?.monthlyBudgetDollars)
    && Number(value.cost?.monthlyBudgetDollars) === Number(policy?.monthlyCostBudgetUsd)
    && JSON.stringify(costServices) === JSON.stringify(expectedCostServices)
    && validBinding(bindings?.release, evidenceRoot) && validBinding(bindings?.policy, evidenceRoot) && boundSamples && boundCost
    && signedReceiptValid(value, env, now));
  return { status: ok ? 'QUALIFIED' : (value ? 'HOLD' : 'NOT_RUN') as EvidenceStatus };
}

function verifyCommercialPrecisionRuntime(
  receipt: unknown,
  buildId: string | null,
  head: string | null,
  deploymentId: string | null,
  migration: { migrationVersion: number | null; migrationChecksums: Record<string, string> },
  env: Environment,
  now: number,
) {
  const value = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt as SignedReceipt & {
    schema?: unknown; status?: unknown; environment?: unknown;
    release?: { buildId?: unknown; gitHead?: unknown; productionDeploymentId?: unknown; evidenceDeploymentId?: unknown };
    execution?: { contract?: unknown; workerIdentity?: unknown; workerPublicKeyFingerprint?: unknown };
    migration?: { version?: unknown; checksum?: unknown };
    migrationSource?: { sha256?: unknown };
    evidenceBindings?: Record<string, { path?: unknown; bytes?: unknown; sha256?: unknown } | null>;
    workerTrust?: {
      signatureVerified?: unknown; workerIdentity?: unknown;
      fingerprintSha256?: unknown; registrySha256?: unknown;
    };
    checks?: Record<string, unknown>;
    decision?: {
      privateBeta?: { eligible?: unknown; blockers?: unknown[] };
      commercialGa?: { eligible?: unknown; blockers?: unknown[] };
    };
    claimBoundary?: {
      sourceTestsAreRuntimeEvidence?: unknown; fixtureWorkerIsCommercialEvidence?: unknown;
      stagingCanQualifyCommercialGa?: unknown; productionRequiresSameDeployment?: unknown;
      independentCadOrManufacturingCertified?: unknown;
    };
  } : null;
  const allChecks = [...COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS, ...COMMERCIAL_PRECISION_GA_CHECKS];
  const checkKeys = value?.checks && typeof value.checks === 'object' && !Array.isArray(value.checks)
    ? Object.keys(value.checks).sort() : [];
  const evidenceKeys = value?.evidenceBindings && typeof value.evidenceBindings === 'object'
    && !Array.isArray(value.evidenceBindings) ? Object.keys(value.evidenceBindings).sort() : [];
  const bindingsValid = JSON.stringify(evidenceKeys) === JSON.stringify([...COMMERCIAL_PRECISION_EVIDENCE_ROLES].sort())
    && COMMERCIAL_PRECISION_EVIDENCE_ROLES.every(role => {
      const binding = value?.evidenceBindings?.[role];
      return Boolean(binding
        && typeof binding.path === 'string' && binding.path.length > 0
        && !path.isAbsolute(binding.path) && !binding.path.replaceAll('\\', '/').split('/').includes('..')
        && typeof binding.bytes === 'number' && Number.isSafeInteger(binding.bytes) && binding.bytes > 0
        && SHA256.test(String(binding.sha256 ?? '')));
    });
  const expectedMigrationChecksum = migration.migrationChecksums[String(COMMERCIAL_PRECISION_MIGRATION_VERSION)];
  const ok = Boolean(value
    && value.schema === COMMERCIAL_PRECISION_RUNTIME_SCHEMA
    && value.status === 'COMMERCIAL_GA_PASS'
    && value.environment === 'production'
    && buildId && value.release?.buildId === buildId
    && head && value.release?.gitHead === head
    && deploymentId && value.release?.productionDeploymentId === deploymentId
    && value.release?.evidenceDeploymentId === deploymentId
    && value.execution?.contract === COMMERCIAL_PRECISION_EXECUTION_CONTRACT
    && value.workerTrust?.signatureVerified === true
    && value.workerTrust?.workerIdentity === value.execution?.workerIdentity
    && value.workerTrust?.fingerprintSha256 === value.execution?.workerPublicKeyFingerprint
    && SHA256.test(String(value.workerTrust?.registrySha256 ?? ''))
    && migration.migrationVersion === COMMERCIAL_PRECISION_MIGRATION_VERSION
    && SHA256.test(String(expectedMigrationChecksum ?? ''))
    && value.migration?.version === COMMERCIAL_PRECISION_MIGRATION_VERSION
    && value.migration?.checksum === expectedMigrationChecksum
    && value.migrationSource?.sha256 === expectedMigrationChecksum
    && JSON.stringify(checkKeys) === JSON.stringify([...allChecks].sort())
    && allChecks.every(key => value.checks?.[key] === 'PASS')
    && bindingsValid
    && value.decision?.privateBeta?.eligible === true
    && Array.isArray(value.decision.privateBeta.blockers) && value.decision.privateBeta.blockers.length === 0
    && value.decision?.commercialGa?.eligible === true
    && Array.isArray(value.decision.commercialGa.blockers) && value.decision.commercialGa.blockers.length === 0
    && value.claimBoundary?.sourceTestsAreRuntimeEvidence === false
    && value.claimBoundary?.fixtureWorkerIsCommercialEvidence === false
    && value.claimBoundary?.stagingCanQualifyCommercialGa === false
    && value.claimBoundary?.productionRequiresSameDeployment === true
    && value.claimBoundary?.independentCadOrManufacturingCertified === false
    && signedReceiptValid(value, env, now));
  return {
    status: ok ? 'QUALIFIED' : (value ? 'HOLD' : 'NOT_RUN') as EvidenceStatus,
    receiptSha256: typeof value?.receiptSha256 === 'string' && SHA256.test(value.receiptSha256)
      ? value.receiptSha256 : null,
    environment: typeof value?.environment === 'string' ? value.environment : null,
    executionContract: typeof value?.execution?.contract === 'string' ? value.execution.contract : null,
  };
}

export async function loadReleaseEvidenceFile(file: string | undefined): Promise<unknown> {
  if (!file || path.isAbsolute(file) || file.replaceAll('\\', '/').split('/').includes('..')) return undefined;
  try {
    const root = path.resolve(process.cwd());
    const absolute = path.resolve(root, file);
    if (!containedRegularFile(root, absolute, 2_000_000)) return undefined;
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    return undefined;
  }
}

async function migrationEvidence(db: ReleaseEvidenceOptions['db'], env: Environment) {
  const migrationChecksums: Record<string, string> = {};
  if (!db) return { status: 'NOT_RUN' as EvidenceStatus, migrationVersion: null, migrationChecksums };
  if (db.backend !== 'postgres') return { status: 'HOLD' as EvidenceStatus, migrationVersion: null, migrationChecksums };
  try {
    const rows = await Promise.all(COMMERCIAL_POSTGRES_MIGRATIONS.map(version => db.queryOne<{ version: number; checksum?: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', version)));
    let valid = true;
    for (const [index, row] of rows.entries()) {
      const version = COMMERCIAL_POSTGRES_MIGRATIONS[index];
      const checksum = typeof row?.checksum === 'string' && SHA256.test(row.checksum) ? row.checksum : '';
      const expected = env[commercialPostgresMigrationChecksumEnvKey(version)]?.trim() ?? '';
      if (checksum) migrationChecksums[String(version)] = checksum;
      if (row?.version !== version || !checksum || !SHA256.test(expected) || checksum !== expected) valid = false;
    }
    return { status: valid ? 'PASS' : 'HOLD' as EvidenceStatus, migrationVersion: valid ? COMMERCIAL_POSTGRES_MIGRATIONS.at(-1)! : null, migrationChecksums };
  } catch {
    return { status: 'HOLD' as EvidenceStatus, migrationVersion: null, migrationChecksums };
  }
}

export async function buildReleaseEvidence(options: ReleaseEvidenceOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const gitHead = gitCommitSha(env.RAILWAY_GIT_COMMIT_SHA) ?? gitCommitSha(env.RELEASE_GIT_HEAD);
  const buildId = cleanId(env.NEXYFAB_BUILD_ID);
  const deploymentId = railwayDeploymentId(env.RAILWAY_DEPLOYMENT_ID);
  const railwayEnvironment = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() ?? null;
  const runtimeStatus: EvidenceStatus = railwayEnvironment === 'production' && env.NEXYFAB_COMMERCIAL_MODE === '1'
    ? 'PASS'
    : railwayEnvironment || env.NEXYFAB_COMMERCIAL_MODE ? 'HOLD' : 'NOT_RUN';
  const runtime = { status: runtimeStatus, environment: railwayEnvironment, commercialMode: env.NEXYFAB_COMMERCIAL_MODE === '1' };
  const build = { status: buildId ? 'PASS' as EvidenceStatus : 'NOT_RUN' as EvidenceStatus, buildId };
  const deployment = { status: deploymentId ? 'PASS' as EvidenceStatus : 'NOT_RUN' as EvidenceStatus, deploymentId };
  const git = { status: gitHead ? 'PASS' as EvidenceStatus : 'NOT_RUN' as EvidenceStatus, gitHead };
  const migration = await migrationEvidence(options.db, env);
  const i18n = verifyI18n(options.i18nReceipt, buildId, gitHead, env, now);
  const sevenDay = verifySevenDay(options.sevenDayReceipt, buildId, gitHead, deploymentId, env, now, options.evidenceRoot);
  const precisionRuntime = verifyCommercialPrecisionRuntime(
    options.precisionRuntimeReceipt, buildId, gitHead, deploymentId, migration, env, now,
  );
  const registry = options.registry ?? loadExternalCommercialVerifierRegistry(env);
  const verifierIdentities = registry?.identities.filter(item => item.role === 'external_verifier') ?? [];
  const fingerprints = verifierIdentities.map(item => item.fingerprintSha256);
  const registryRoles = verifierIdentities.length;
  const registryFingerprintsUnique = fingerprints.length === 3
    && fingerprints.every(value => typeof value === 'string' && SHA256.test(value))
    && new Set(fingerprints).size === 3;
  const statuses = [runtime.status, build.status, deployment.status, git.status, migration.status, i18n.status === 'QUALIFIED' ? 'PASS' : i18n.status, sevenDay.status === 'QUALIFIED' ? 'PASS' : sevenDay.status, precisionRuntime.status === 'QUALIFIED' ? 'PASS' : precisionRuntime.status];
  const allPass = statuses.every(status => status === 'PASS') && registryRoles === 3 && registryFingerprintsUnique;
  const hasHold = statuses.includes('HOLD') || (registryRoles > 0 && (registryRoles !== 3 || !registryFingerprintsUnique));
  const status = allPass ? 'PASS' : hasHold ? 'HOLD' : 'NOT_RUN';
  return {
    schema: 'nexyfab.health.release-evidence.v1', status,
    generatedAt: new Date(now).toISOString(),
    release: { buildId, deploymentId, gitHead, migrationVersion: migration.migrationVersion, migrationChecksums: migration.migrationChecksums, registryRoles, registryFingerprintsUnique, i18n, sevenDay, precisionRuntime },
    evidence: { runtime, build, deployment, git, migration: { status: migration.status }, i18n: { status: i18n.status }, sevenDay: { status: sevenDay.status }, precisionRuntime: { status: precisionRuntime.status } },
  };
}
