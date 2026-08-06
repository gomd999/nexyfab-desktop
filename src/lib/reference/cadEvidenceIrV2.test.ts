import { describe, expect, it } from 'vitest';
import type { CadCorpusEvidence } from './cadCorpusEvidence';
import { hashCadEvidenceCanonical, migrateCadCorpusEvidenceV1, serializeCadEvidenceCanonical, validateCadEvidenceIrV2, type CadEvidenceIrV2 } from './cadEvidenceIrV2';

const digest = 'a'.repeat(64);
const validEvidence = (): CadEvidenceIrV2 => ({
  schemaVersion: 2, scenarioId: 'unit-box',
  input: { sha256: digest, extension: 'step', sizeBytes: 42 },
  producer: { adapter: 'occt', version: '1.0.0' }, status: 'pass',
  assertions: [{ id: 'volume', status: 'pass', method: 'OCCT GProp', criterion: { description: 'Volume is within tolerance.', operator: 'within', expected: 1, tolerance: 0.001, toleranceUnit: 'mm3' }, measured: 1, unit: 'mm3', confidence: 1, reason: 'Exact B-rep measurement.', artifactHashes: [digest] }],
  artifacts: [{ sha256: digest, role: 'input', mediaType: 'model/step', sizeBytes: 42 }],
  sideEffects: { quoteCreated: false, rfqSent: false, sourceModified: false, additional: [] },
  generatedAt: '2026-08-05T01:02:03.000Z',
});

describe('CadEvidenceIrV2', () => {
  it('validates governed fields and assertion-level pass/fail/not_run', () => {
    const evidence = validEvidence();
    evidence.status = 'not_run';
    evidence.assertions[0] = { ...evidence.assertions[0]!, status: 'not_run', confidence: 0 };
    expect(validateCadEvidenceIrV2(evidence)).toEqual({ ok: true, value: evidence, issues: [] });
    evidence.assertions.push({ ...evidence.assertions[0]!, id: 'invalid', status: 'fail' });
    const result = validateCadEvidenceIrV2(evidence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ path: 'status' }));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite numbers: %s', bad => {
    const measured = validEvidence(); measured.assertions[0]!.measured = bad;
    expect(validateCadEvidenceIrV2(measured).ok).toBe(false);
    const tolerance = validEvidence(); tolerance.assertions[0]!.criterion.tolerance = bad;
    expect(validateCadEvidenceIrV2(tolerance).ok).toBe(false);
  });

  it('serializes deterministically and excludes informational timestamps from the default hash', () => {
    const first = validEvidence();
    const second = { ...validEvidence(), generatedAt: '2027-01-01T00:00:00.000Z' };
    expect(hashCadEvidenceCanonical(first)).toBe(hashCadEvidenceCanonical(second));
    expect(hashCadEvidenceCanonical(first, { includeTimestamp: true })).not.toBe(hashCadEvidenceCanonical(second, { includeTimestamp: true }));
    expect(serializeCadEvidenceCanonical(first)).not.toContain('generatedAt');
    expect(serializeCadEvidenceCanonical(first).indexOf('artifacts')).toBeLessThan(serializeCadEvidenceCanonical(first).indexOf('schemaVersion'));
  });

  it('migrates v1 without mutation or pretending not_run ran', () => {
    const legacy: CadCorpusEvidence = { schemaVersion: 1, scenarioId: 'legacy', input: { sha256: digest, extension: 'step', sizeBytes: 12 }, importer: 'step_v1', status: 'not_run', assertions: [{ assertion: 'mate', status: 'not_run', reason: 'No adapter.' }], sideEffects: { quoteCreated: false, rfqSent: false, sourceModified: false } };
    const before = JSON.stringify(legacy);
    const migrated = migrateCadCorpusEvidenceV1(legacy, '2026-08-05T00:00:00Z');
    expect(JSON.stringify(legacy)).toBe(before);
    expect(migrated).toMatchObject({ schemaVersion: 2, status: 'not_run', producer: { adapter: 'step_v1', version: 'v1-migration' } });
    expect(migrated.assertions[0]).toMatchObject({ id: 'mate', status: 'not_run', confidence: 0, artifactHashes: [digest] });
    expect(validateCadEvidenceIrV2(migrated).ok).toBe(true);
  });

  it('rejects malformed hashes and duplicate assertion ids', () => {
    const evidence = validEvidence(); evidence.input.sha256 = 'bad'; evidence.assertions.push({ ...evidence.assertions[0]! });
    const result = validateCadEvidenceIrV2(evidence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(item => item.path)).toEqual(expect.arrayContaining(['input.sha256', 'assertions[1].id']));
  });
});
