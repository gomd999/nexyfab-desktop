import { createHash } from 'node:crypto';
import { validateCadEvidenceIrV2, type CadEvidenceIrV2, type EvidenceAssertionStatus } from './cadEvidenceIrV2';
import { validateCadCorpusManifestV2, type CadCorpusFixtureV2, type CadCorpusManifestV2, type CadCorpusTierV2 } from './cadCorpusManifestV2';

export interface CadCorpusShardSpec {
  /** One-based shard index, matching the CLI form 1/4. */
  index: number;
  total: number;
}

export interface CadCorpusShardResultV2 {
  schema: 'nexyfab.cad-corpus-shard-result.v2';
  manifestSha256: string;
  shard: CadCorpusShardSpec;
  records: Array<{ fixtureId: string; evidence: CadEvidenceIrV2 }>;
}

export type CadCorpusMergeErrorCode =
  | 'INVALID_MANIFEST'
  | 'INVALID_SHARD'
  | 'DUPLICATE_SHARD'
  | 'MISSING_SHARD'
  | 'DUPLICATE_FIXTURE'
  | 'MISSING_FIXTURE'
  | 'UNEXPECTED_FIXTURE'
  | 'WRONG_SHARD'
  | 'HASH_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'INVALID_EVIDENCE'
  | 'SIDE_EFFECT_DETECTED';

export class CadCorpusMergeError extends Error {
  constructor(readonly code: CadCorpusMergeErrorCode, message: string, readonly fixtureId?: string) {
    super(message);
    this.name = 'CadCorpusMergeError';
  }
}

export interface CadCorpusSummaryCount {
  pass: number;
  fail: number;
  notRun: number;
  total: number;
}

export interface CadCorpusSummaryReportV2 {
  schema: 'nexyfab.cad-corpus-summary.v2';
  manifestSha256: string;
  fixtureCount: number;
  scoringUnitCount: number;
  fixtures: CadCorpusSummaryCount;
  scoringUnits: CadCorpusSummaryCount;
  tiers: Record<CadCorpusTierV2, CadCorpusSummaryCount>;
  releaseBlocking: boolean;
  failedFixtureIds: string[];
  notRunFixtureIds: string[];
  duplicateGroups: Array<{ groupId: string; fixtureIds: string[]; status: EvidenceAssertionStatus }>;
}

const STATUS_RANK: Record<EvidenceAssertionStatus, number> = { pass: 0, not_run: 1, fail: 2 };

function emptyCount(): CadCorpusSummaryCount {
  return { pass: 0, fail: 0, notRun: 0, total: 0 };
}

function addStatus(count: CadCorpusSummaryCount, status: EvidenceAssertionStatus): void {
  count.total++;
  if (status === 'not_run') count.notRun++;
  else count[status]++;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) result[key] = canonicalize(source[key]);
  }
  return result;
}

export function hashCadCorpusManifestV2(manifest: CadCorpusManifestV2): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(manifest))).digest('hex');
}

function assertFrozenManifest(manifest: CadCorpusManifestV2): void {
  const issues = validateCadCorpusManifestV2(manifest);
  if (manifest.lifecycle !== 'frozen' || issues.length > 0) {
    throw new CadCorpusMergeError('INVALID_MANIFEST', manifest.lifecycle !== 'frozen'
      ? 'Shard and merge operations require a frozen Manifest v2.'
      : issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
  }
}

function assertShardSpec(spec: CadCorpusShardSpec): void {
  if (!Number.isSafeInteger(spec.index) || !Number.isSafeInteger(spec.total) ||
      spec.total < 1 || spec.index < 1 || spec.index > spec.total) {
    throw new CadCorpusMergeError('INVALID_SHARD', 'Shard must use one-based integers satisfying 1 <= index <= total.');
  }
}

/** Stable round-robin assignment after fixture-id sorting; input array order cannot affect it. */
export function assignCadCorpusShardV2(manifest: CadCorpusManifestV2, shard: CadCorpusShardSpec): CadCorpusFixtureV2[] {
  assertFrozenManifest(manifest);
  assertShardSpec(shard);
  return [...manifest.fixtures]
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId, 'en'))
    .filter((_fixture, position) => position % shard.total === shard.index - 1);
}

export function createCadCorpusShardResultV2(
  manifest: CadCorpusManifestV2,
  shard: CadCorpusShardSpec,
  records: CadCorpusShardResultV2['records'],
): CadCorpusShardResultV2 {
  const assigned = new Set(assignCadCorpusShardV2(manifest, shard).map(item => item.fixtureId));
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.fixtureId)) throw new CadCorpusMergeError('DUPLICATE_FIXTURE', `Duplicate fixture ${record.fixtureId} in shard.`, record.fixtureId);
    seen.add(record.fixtureId);
    if (!assigned.has(record.fixtureId)) throw new CadCorpusMergeError('WRONG_SHARD', `Fixture ${record.fixtureId} is not assigned to shard ${shard.index}/${shard.total}.`, record.fixtureId);
  }
  return {
    schema: 'nexyfab.cad-corpus-shard-result.v2',
    manifestSha256: hashCadCorpusManifestV2(manifest),
    shard: { ...shard },
    records: [...records].sort((left, right) => left.fixtureId.localeCompare(right.fixtureId, 'en')),
  };
}

function worstStatus(statuses: EvidenceAssertionStatus[]): EvidenceAssertionStatus {
  return statuses.reduce((worst, status) => STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst, 'pass');
}

export function buildCadCorpusSummaryReportV2(
  manifest: CadCorpusManifestV2,
  records: ReadonlyArray<{ fixtureId: string; evidence: CadEvidenceIrV2 }>,
): CadCorpusSummaryReportV2 {
  assertFrozenManifest(manifest);
  const fixtureById = new Map(manifest.fixtures.map(item => [item.fixtureId, item]));
  const seen = new Set<string>();
  const validatedRecords: Array<{ fixtureId: string; evidence: CadEvidenceIrV2 }> = [];
  for (const record of records) {
    const fixture = fixtureById.get(record.fixtureId);
    if (!fixture) throw new CadCorpusMergeError('UNEXPECTED_FIXTURE', `Unknown fixture ${record.fixtureId}.`, record.fixtureId);
    if (seen.has(record.fixtureId)) throw new CadCorpusMergeError('DUPLICATE_FIXTURE', `Fixture ${record.fixtureId} appears more than once.`, record.fixtureId);
    const checked = validateCadEvidenceIrV2(record.evidence);
    if (!checked.ok || record.evidence.scenarioId !== record.fixtureId) {
      throw new CadCorpusMergeError('INVALID_EVIDENCE', `Fixture ${record.fixtureId} has invalid or mismatched evidence.`, record.fixtureId);
    }
    if (checked.value.input.sha256 !== fixture.sha256) throw new CadCorpusMergeError('HASH_MISMATCH', `Fixture ${record.fixtureId} input hash differs from the frozen manifest.`, record.fixtureId);
    if (checked.value.input.sizeBytes !== fixture.bytes) throw new CadCorpusMergeError('SIZE_MISMATCH', `Fixture ${record.fixtureId} input size differs from the frozen manifest.`, record.fixtureId);
    if (checked.value.sideEffects.quoteCreated || checked.value.sideEffects.rfqSent || checked.value.sideEffects.sourceModified || checked.value.sideEffects.additional.length > 0) {
      throw new CadCorpusMergeError('SIDE_EFFECT_DETECTED', `Fixture ${record.fixtureId} evidence records a forbidden side effect.`, record.fixtureId);
    }
    seen.add(record.fixtureId);
    validatedRecords.push({ fixtureId: record.fixtureId, evidence: checked.value });
  }
  const missing = [...fixtureById.keys()].filter(id => !seen.has(id)).sort((a, b) => a.localeCompare(b, 'en'));
  if (missing.length > 0) throw new CadCorpusMergeError('MISSING_FIXTURE', `Missing fixtures: ${missing.join(', ')}.`, missing[0]);

  const fixtures = emptyCount();
  const scoringUnits = emptyCount();
  const tiers: CadCorpusSummaryReportV2['tiers'] = { 'core-a': emptyCount(), 'challenge-b': emptyCount() };
  const failedFixtureIds: string[] = [];
  const notRunFixtureIds: string[] = [];
  const groups = new Map<string, Array<{ fixtureId: string; status: EvidenceAssertionStatus }>>();

  for (const record of validatedRecords.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId, 'en'))) {
    const fixture = fixtureById.get(record.fixtureId)!;
    addStatus(fixtures, record.evidence.status);
    addStatus(tiers[fixture.tier], record.evidence.status);
    if (record.evidence.status === 'fail') failedFixtureIds.push(record.fixtureId);
    if (record.evidence.status === 'not_run') notRunFixtureIds.push(record.fixtureId);
    const scoringId = fixture.duplicateGroup ? `duplicate:${fixture.duplicateGroup}` : `fixture:${fixture.fixtureId}`;
    const group = groups.get(scoringId) ?? [];
    group.push({ fixtureId: fixture.fixtureId, status: record.evidence.status });
    groups.set(scoringId, group);
  }

  const duplicateGroups: CadCorpusSummaryReportV2['duplicateGroups'] = [];
  for (const [id, group] of [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const status = worstStatus(group.map(item => item.status));
    addStatus(scoringUnits, status);
    if (id.startsWith('duplicate:')) {
      duplicateGroups.push({ groupId: id.slice('duplicate:'.length), fixtureIds: group.map(item => item.fixtureId).sort(), status });
    }
  }
  return {
    schema: 'nexyfab.cad-corpus-summary.v2', manifestSha256: hashCadCorpusManifestV2(manifest),
    fixtureCount: validatedRecords.length, scoringUnitCount: groups.size, fixtures, scoringUnits, tiers,
    releaseBlocking: fixtures.fail > 0 || fixtures.notRun > 0,
    failedFixtureIds, notRunFixtureIds, duplicateGroups,
  };
}

export function mergeCadCorpusShardResultsV2(
  manifest: CadCorpusManifestV2,
  shardResults: readonly CadCorpusShardResultV2[],
): { records: CadCorpusShardResultV2['records']; report: CadCorpusSummaryReportV2 } {
  assertFrozenManifest(manifest);
  const expectedManifestHash = hashCadCorpusManifestV2(manifest);
  const fixtureById = new Map(manifest.fixtures.map(item => [item.fixtureId, item]));
  const seenFixtures = new Set<string>();
  const seenShards = new Set<number>();
  let total: number | undefined;
  const records: CadCorpusShardResultV2['records'] = [];

  for (const result of shardResults) {
    assertShardSpec(result.shard);
    if (result.schema !== 'nexyfab.cad-corpus-shard-result.v2' || result.manifestSha256 !== expectedManifestHash) {
      throw new CadCorpusMergeError('HASH_MISMATCH', 'Shard result was produced from a different manifest.');
    }
    if (total !== undefined && total !== result.shard.total) throw new CadCorpusMergeError('INVALID_SHARD', 'All shard totals must match.');
    total = result.shard.total;
    if (seenShards.has(result.shard.index)) throw new CadCorpusMergeError('DUPLICATE_SHARD', `Shard ${result.shard.index} is duplicated.`);
    seenShards.add(result.shard.index);
    const assigned = new Set(assignCadCorpusShardV2(manifest, result.shard).map(item => item.fixtureId));

    for (const record of result.records) {
      const fixture = fixtureById.get(record.fixtureId);
      if (!fixture) throw new CadCorpusMergeError('UNEXPECTED_FIXTURE', `Unknown fixture ${record.fixtureId}.`, record.fixtureId);
      if (!assigned.has(record.fixtureId)) throw new CadCorpusMergeError('WRONG_SHARD', `Fixture ${record.fixtureId} is in the wrong shard.`, record.fixtureId);
      if (seenFixtures.has(record.fixtureId)) throw new CadCorpusMergeError('DUPLICATE_FIXTURE', `Fixture ${record.fixtureId} appears more than once.`, record.fixtureId);
      const checked = validateCadEvidenceIrV2(record.evidence);
      if (!checked.ok || record.evidence.scenarioId !== record.fixtureId) {
        throw new CadCorpusMergeError('INVALID_EVIDENCE', `Fixture ${record.fixtureId} has invalid or mismatched evidence.`, record.fixtureId);
      }
      if (record.evidence.input.sha256 !== fixture.sha256) throw new CadCorpusMergeError('HASH_MISMATCH', `Fixture ${record.fixtureId} input hash differs from the frozen manifest.`, record.fixtureId);
      if (record.evidence.input.sizeBytes !== fixture.bytes) throw new CadCorpusMergeError('SIZE_MISMATCH', `Fixture ${record.fixtureId} input size differs from the frozen manifest.`, record.fixtureId);
      if (record.evidence.sideEffects.quoteCreated || record.evidence.sideEffects.rfqSent || record.evidence.sideEffects.sourceModified || record.evidence.sideEffects.additional.length > 0) {
        throw new CadCorpusMergeError('SIDE_EFFECT_DETECTED', `Fixture ${record.fixtureId} evidence records a forbidden side effect.`, record.fixtureId);
      }
      seenFixtures.add(record.fixtureId);
      records.push({ fixtureId: record.fixtureId, evidence: checked.value });
    }
  }

  const missing = [...fixtureById.keys()].filter(id => !seenFixtures.has(id)).sort();
  if (missing.length > 0) throw new CadCorpusMergeError('MISSING_FIXTURE', `Missing fixtures: ${missing.join(', ')}.`, missing[0]);
  const missingShards = total === undefined
    ? [1]
    : Array.from({ length: total }, (_value, index) => index + 1).filter(index => !seenShards.has(index));
  if (missingShards.length > 0) {
    throw new CadCorpusMergeError('MISSING_SHARD', `Missing shard results: ${missingShards.join(', ')}.`);
  }
  records.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId, 'en'));
  return { records, report: buildCadCorpusSummaryReportV2(manifest, records) };
}
