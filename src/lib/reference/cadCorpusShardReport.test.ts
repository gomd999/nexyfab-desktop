import { describe, expect, it } from 'vitest';
import type { CadEvidenceIrV2, EvidenceAssertionStatus } from './cadEvidenceIrV2';
import type { CadCorpusFixtureV2, CadCorpusManifestV2 } from './cadCorpusManifestV2';
import {
  assignCadCorpusShardV2,
  createCadCorpusShardResultV2,
  buildCadCorpusSummaryReportV2,
  hashCadCorpusManifestV2,
  mergeCadCorpusShardResultsV2,
} from './cadCorpusShardReport';

const hashes = { A01: 'a'.repeat(64), A02: 'b'.repeat(64), A03: 'c'.repeat(64), B01: 'd'.repeat(64) };

function fixture(fixtureId: keyof typeof hashes, tier: 'core-a' | 'challenge-b', duplicateGroup?: string): CadCorpusFixtureV2 {
  return {
    fixtureId, locator: { kind: 'path-fragments', fragments: ['corpus', `${fixtureId}.step`] },
    sha256: hashes[fixtureId], format: 'step', grade: tier === 'core-a' ? 'A' : 'B', tier,
    split: 'evaluation', assertions: ['geometry'],
    usage: { storage: 'local-only', redistribution: 'forbidden-until-proven', promptExample: false },
    holdoutGroup: `product-${fixtureId.toLowerCase()}`, duplicateGroup, bytes: 10, byteBudget: 100,
  };
}

function manifest(): CadCorpusManifestV2 {
  return {
    schema: 'nexyfab.cad-corpus-manifest.v2', lifecycle: 'frozen',
    byteBudget: { maxFixtureBytes: 100, maxRunBytes: 1000 },
    fixtures: [fixture('B01', 'challenge-b'), fixture('A03', 'core-a'), fixture('A01', 'core-a', 'similar'), fixture('A02', 'core-a', 'similar')],
  };
}

function evidence(fixtureId: keyof typeof hashes, status: EvidenceAssertionStatus = 'pass'): CadEvidenceIrV2 {
  return {
    schemaVersion: 2, scenarioId: fixtureId,
    input: { sha256: hashes[fixtureId], extension: 'step', sizeBytes: 10 },
    producer: { adapter: 'test', version: '1' }, status,
    assertions: [{ id: 'geometry', status, method: 'exact', criterion: { description: 'exact check' }, confidence: status === 'not_run' ? 0 : 1, reason: status, artifactHashes: [hashes[fixtureId]] }],
    artifacts: [{ sha256: hashes[fixtureId], role: 'input', sizeBytes: 10 }],
    sideEffects: { quoteCreated: false, rfqSent: false, sourceModified: false, additional: [] },
  };
}

function allShardResults(source = manifest()) {
  return [1, 2].map(index => {
    const spec = { index, total: 2 };
    return createCadCorpusShardResultV2(source, spec, assignCadCorpusShardV2(source, spec).map(item => ({
      fixtureId: item.fixtureId,
      evidence: evidence(item.fixtureId as keyof typeof hashes, item.fixtureId === 'A02' ? 'not_run' : item.fixtureId === 'B01' ? 'fail' : 'pass'),
    })));
  });
}

describe('CAD corpus deterministic shard/merge/report contract', () => {
  it('assigns sorted fixture ids by stable one-based round robin', () => {
    const source = manifest();
    expect(assignCadCorpusShardV2(source, { index: 1, total: 2 }).map(item => item.fixtureId)).toEqual(['A01', 'A03']);
    expect(assignCadCorpusShardV2(source, { index: 2, total: 2 }).map(item => item.fixtureId)).toEqual(['A02', 'B01']);
    source.fixtures.reverse();
    expect(assignCadCorpusShardV2(source, { index: 1, total: 2 }).map(item => item.fixtureId)).toEqual(['A01', 'A03']);
  });

  it('merges complete shards and reports duplicate groups as one worst-case scoring unit', () => {
    const source = manifest();
    const merged = mergeCadCorpusShardResultsV2(source, allShardResults(source).reverse());
    expect(merged.records.map(item => item.fixtureId)).toEqual(['A01', 'A02', 'A03', 'B01']);
    expect(merged.report).toMatchObject({
      fixtureCount: 4, scoringUnitCount: 3, releaseBlocking: true,
      fixtures: { pass: 2, fail: 1, notRun: 1, total: 4 },
      scoringUnits: { pass: 1, fail: 1, notRun: 1, total: 3 },
      tiers: { 'core-a': { pass: 2, fail: 0, notRun: 1, total: 3 }, 'challenge-b': { pass: 0, fail: 1, notRun: 0, total: 1 } },
      failedFixtureIds: ['B01'], notRunFixtureIds: ['A02'],
      duplicateGroups: [{ groupId: 'similar', fixtureIds: ['A01', 'A02'], status: 'not_run' }],
    });
    expect(JSON.stringify(merged.report)).not.toMatch(/corpus\/|\.step|CAD-BYTES/);
  });

  it('blocks missing and duplicate fixtures', () => {
    const source = manifest();
    const results = allShardResults(source);
    results[0]!.records.pop();
    expect(() => mergeCadCorpusShardResultsV2(source, results)).toThrow(expect.objectContaining({ code: 'MISSING_FIXTURE' }));

    const duplicate = allShardResults(source);
    duplicate[0]!.records.push(duplicate[0]!.records[0]!);
    expect(() => mergeCadCorpusShardResultsV2(source, duplicate)).toThrow(expect.objectContaining({ code: 'DUPLICATE_FIXTURE' }));
  });

  it('public summary builder rejects partial, duplicate, unknown, mismatched, and side-effect evidence', () => {
    const source = manifest();
    const complete = source.fixtures.map(item => ({ fixtureId: item.fixtureId, evidence: evidence(item.fixtureId as keyof typeof hashes) }));
    expect(buildCadCorpusSummaryReportV2(source, complete).releaseBlocking).toBe(false);
    expect(() => buildCadCorpusSummaryReportV2(source, complete.slice(1))).toThrow(expect.objectContaining({ code: 'MISSING_FIXTURE' }));
    expect(() => buildCadCorpusSummaryReportV2(source, [...complete, complete[0]!])).toThrow(expect.objectContaining({ code: 'DUPLICATE_FIXTURE' }));
    expect(() => buildCadCorpusSummaryReportV2(source, [...complete, { fixtureId: 'Z99', evidence: complete[0]!.evidence }])).toThrow(expect.objectContaining({ code: 'UNEXPECTED_FIXTURE' }));

    const mismatched = structuredClone(complete);
    mismatched[0]!.evidence.scenarioId = 'A01';
    expect(() => buildCadCorpusSummaryReportV2(source, mismatched)).toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE' }));
    const badHash = structuredClone(complete);
    badHash[0]!.evidence.input.sha256 = 'f'.repeat(64);
    expect(() => buildCadCorpusSummaryReportV2(source, badHash)).toThrow(expect.objectContaining({ code: 'HASH_MISMATCH' }));
    const sideEffect = structuredClone(complete);
    sideEffect[0]!.evidence.sideEffects.sourceModified = true;
    expect(() => buildCadCorpusSummaryReportV2(source, sideEffect)).toThrow(expect.objectContaining({ code: 'SIDE_EFFECT_DETECTED' }));
  });

  it('blocks manifest and fixture hash mismatches', () => {
    const source = manifest();
    const result = allShardResults(source);
    result[0]!.manifestSha256 = 'f'.repeat(64);
    expect(() => mergeCadCorpusShardResultsV2(source, result)).toThrow(expect.objectContaining({ code: 'HASH_MISMATCH' }));

    const evidenceMismatch = allShardResults(source);
    evidenceMismatch[0]!.records[0]!.evidence.input.sha256 = 'e'.repeat(64);
    expect(() => mergeCadCorpusShardResultsV2(source, evidenceMismatch)).toThrow(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });

  it('blocks wrong shard placement and duplicate shard ids', () => {
    const source = manifest();
    const results = allShardResults(source);
    results[0]!.records.push(results[1]!.records.shift()!);
    expect(() => mergeCadCorpusShardResultsV2(source, results)).toThrow(expect.objectContaining({ code: 'WRONG_SHARD' }));
    const duplicateShard = allShardResults(source);
    duplicateShard[1]!.shard.index = duplicateShard[0]!.shard.index;
    expect(() => mergeCadCorpusShardResultsV2(source, duplicateShard)).toThrow(expect.objectContaining({ code: 'DUPLICATE_SHARD' }));
  });

  it('requires explicit results for empty shards as well as populated shards', () => {
    const source = manifest();
    const results = [1, 2, 3, 4].map(index => {
      const shard = { index, total: 5 };
      return createCadCorpusShardResultV2(source, shard, assignCadCorpusShardV2(source, shard).map(item => ({
        fixtureId: item.fixtureId,
        evidence: evidence(item.fixtureId as keyof typeof hashes),
      })));
    });
    expect(() => mergeCadCorpusShardResultsV2(source, results)).toThrow(expect.objectContaining({ code: 'MISSING_SHARD' }));
  });

  it('blocks holdout leakage and forbidden side effects before reporting', () => {
    const leaked = manifest();
    leaked.fixtures[1]!.holdoutGroup = leaked.fixtures[0]!.holdoutGroup;
    leaked.fixtures[1]!.split = 'training';
    expect(() => assignCadCorpusShardV2(leaked, { index: 1, total: 2 })).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));

    const source = manifest();
    const results = allShardResults(source);
    results[0]!.records[0]!.evidence.sideEffects.rfqSent = true;
    expect(() => mergeCadCorpusShardResultsV2(source, results)).toThrow(expect.objectContaining({ code: 'SIDE_EFFECT_DETECTED' }));
  });

  it('uses a deterministic manifest hash and rejects invalid shard numbers', () => {
    const source = manifest();
    expect(hashCadCorpusManifestV2(source)).toBe(hashCadCorpusManifestV2(structuredClone(source)));
    expect(() => assignCadCorpusShardV2(source, { index: 0, total: 2 })).toThrow(expect.objectContaining({ code: 'INVALID_SHARD' }));
  });
});
