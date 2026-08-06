import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { OcctBridge } from '@/lib/occt/bridge';
import { analyzeCadReference } from './cadReferenceAnalyze';
import { validateCadCorpusManifestV2, type CadCorpusManifestV2, type CadCorpusTierV2 } from './cadCorpusManifestV2';
import { resolveCadCorpusFixtureV2 } from './cadCorpusManifestV2Resolver';
import { validateCadEvidenceIrV2, type CadEvidenceIrV2, type EvidenceAssertionStatus } from './cadEvidenceIrV2';
import type { CadLengthUnit, DeclaredSourceTolerance } from './cadTolerancePolicy';

export interface CadCorpusBatchRunnerOptions {
  corpusRoot: string;
  outputDir: string;
  manifest: CadCorpusManifestV2;
  bridge: OcctBridge;
  lengthUnit: CadLengthUnit;
  declaredSourceTolerance?: DeclaredSourceTolerance;
  tier?: CadCorpusTierV2;
  fixtureIds?: string[];
  shard?: { index: number; count: number };
  resume?: boolean;
  analyzerVersion?: string;
}

export interface CadCorpusBatchItemResult {
  fixtureId: string;
  status: EvidenceAssertionStatus | 'error';
  resumed: boolean;
  evidence?: CadEvidenceIrV2;
  error?: { code: string; message: string };
}

export interface CadCorpusBatchSummary {
  schema: 'nexyfab.cad-corpus-run.v2';
  signature: string;
  selected: number;
  counts: { pass: number; fail: number; not_run: number; error: number };
  results: CadCorpusBatchItemResult[];
}

interface Checkpoint {
  schema: 'nexyfab.cad-corpus-checkpoint.v2';
  signature: string;
  fixtureId: string;
  result: Omit<CadCorpusBatchItemResult, 'resumed'>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  const input = value as Record<string, unknown>, output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) if (input[key] !== undefined) output[key] = canonical(input[key]);
  return output;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, path);
}

function safeError(error: unknown): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'FIXTURE_ANALYSIS_ERROR',
    // Do not persist arbitrary fs/kernel exception text: it can contain absolute paths or source snippets.
    message: typeof candidate?.code === 'string' ? `Fixture processing failed (${candidate.code}).` : 'Fixture processing failed.',
  };
}

function parseCheckpoint(value: unknown, signature: string, fixtureId: string): Omit<CadCorpusBatchItemResult, 'resumed'> | null {
  if (typeof value !== 'object' || value === null) return null;
  const cp = value as Partial<Checkpoint>;
  if (cp.schema !== 'nexyfab.cad-corpus-checkpoint.v2' || cp.signature !== signature || cp.fixtureId !== fixtureId || typeof cp.result !== 'object' || cp.result === null) return null;
  const result = cp.result;
  if (result.fixtureId !== fixtureId || !['pass', 'fail', 'not_run', 'error'].includes(result.status)) return null;
  if (result.status !== 'error' && (!result.evidence || !validateCadEvidenceIrV2(result.evidence).ok)) return null;
  if (result.status === 'error' && (!result.error || typeof result.error.code !== 'string')) return null;
  return result;
}

export async function runCadCorpusBatchV2(options: CadCorpusBatchRunnerOptions): Promise<CadCorpusBatchSummary> {
  const issues = validateCadCorpusManifestV2(options.manifest);
  if (options.manifest.lifecycle !== 'frozen' || issues.length > 0) throw new TypeError(`A valid frozen Manifest v2 is required${issues[0] ? `: ${issues[0].message}` : '.'}`);
  const shard = options.shard;
  if (shard && (!Number.isSafeInteger(shard.index) || !Number.isSafeInteger(shard.count) || shard.count < 1 || shard.index < 1 || shard.index > shard.count)) throw new TypeError('Shard must use a one-based index within its positive count.');
  const requested = options.fixtureIds ? new Set(options.fixtureIds) : null;
  if (requested && requested.size !== options.fixtureIds!.length) throw new TypeError('fixtureIds must be unique.');
  const known = new Set(options.manifest.fixtures.map(item => item.fixtureId));
  if (requested && [...requested].some(id => !known.has(id))) throw new TypeError('fixtureIds contains an id outside the frozen manifest.');
  let fixtures = options.manifest.fixtures
    .filter(item => (!options.tier || item.tier === options.tier) && (!requested || requested.has(item.fixtureId)))
    .sort((a, b) => a.fixtureId.localeCompare(b.fixtureId, 'en'));
  if (shard) fixtures = fixtures.filter((_item, index) => index % shard.count === shard.index - 1);

  const signature = hashJson({
    schema: options.manifest.schema,
    fixtures: fixtures.map(item => ({ fixtureId: item.fixtureId, sha256: item.sha256, bytes: item.bytes, format: item.format })),
    lengthUnit: options.lengthUnit, declaredSourceTolerance: options.declaredSourceTolerance,
    analyzerVersion: options.analyzerVersion ?? 'cad-reference-analysis/6', shard: shard ?? null,
  });
  const snapshotPath = resolve(options.outputDir, 'manifest.snapshot.json');
  try {
    const prior = JSON.parse(await readFile(snapshotPath, 'utf8')) as { signature?: unknown };
    if (prior.signature !== signature) {
      throw Object.assign(new Error('Run snapshot signature mismatch.'), { code: 'CHECKPOINT_SIGNATURE_MISMATCH' });
    }
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'CHECKPOINT_SIGNATURE_MISMATCH') throw error;
    if ((error as { code?: unknown })?.code !== 'ENOENT') {
      throw Object.assign(new Error('Existing run snapshot is unreadable.'), { code: 'CHECKPOINT_SIGNATURE_MISMATCH' });
    }
    // No snapshot: this is a new output directory.
  }
  await mkdir(resolve(options.outputDir, 'checkpoints'), { recursive: true });
  await mkdir(resolve(options.outputDir, 'evidence'), { recursive: true });
  await atomicJson(snapshotPath, {
    schema: options.manifest.schema, lifecycle: 'frozen', signature,
    fixtures: fixtures.map(item => ({ fixtureId: item.fixtureId, sha256: item.sha256, bytes: item.bytes, format: item.format, tier: item.tier })),
  });

  const results: CadCorpusBatchItemResult[] = [];
  for (const fixture of fixtures) {
    const checkpointPath = resolve(options.outputDir, 'checkpoints', `${fixture.fixtureId}.json`);
    if (options.resume) {
      try {
        const rawCheckpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as Partial<Checkpoint>;
        if (rawCheckpoint.schema === 'nexyfab.cad-corpus-checkpoint.v2' && rawCheckpoint.fixtureId === fixture.fixtureId && rawCheckpoint.signature !== signature) {
          throw Object.assign(new Error('Checkpoint signature mismatch.'), { code: 'CHECKPOINT_SIGNATURE_MISMATCH' });
        }
        const checkpoint = parseCheckpoint(rawCheckpoint, signature, fixture.fixtureId);
        if (checkpoint) { results.push({ ...checkpoint, resumed: true }); continue; }
      } catch (error) {
        if ((error as { code?: unknown })?.code === 'CHECKPOINT_SIGNATURE_MISMATCH') throw error;
        // Absent or malformed checkpoint is safely recomputed.
      }
    }
    let result: Omit<CadCorpusBatchItemResult, 'resumed'>;
    try {
      const resolvedFixture = await resolveCadCorpusFixtureV2(options.corpusRoot, fixture, options.manifest.byteBudget.maxFixtureBytes);
      if (resolvedFixture.sha256 !== fixture.sha256 || resolvedFixture.bytes !== fixture.bytes) throw Object.assign(new Error('source changed'), { code: 'SOURCE_CHANGED' });
      const bytes = await readFile(resolve(options.corpusRoot, resolvedFixture.relativePath));
      if (bytes.byteLength !== fixture.bytes || createHash('sha256').update(bytes).digest('hex') !== fixture.sha256) throw Object.assign(new Error('source changed'), { code: 'SOURCE_CHANGED' });
      const analysis = await analyzeCadReference({
        format: fixture.format, source: bytes.toString('utf8'), scenarioId: fixture.fixtureId,
        lengthUnit: options.lengthUnit,
        ...(options.declaredSourceTolerance === undefined ? {} : { declaredSourceTolerance: options.declaredSourceTolerance }),
      }, options.bridge);
      result = { fixtureId: fixture.fixtureId, status: analysis.evidence.status, evidence: analysis.evidence };
      await atomicJson(resolve(options.outputDir, 'evidence', `${fixture.fixtureId}.json`), analysis.evidence);
    } catch (error) {
      result = { fixtureId: fixture.fixtureId, status: 'error', error: safeError(error) };
    }
    await atomicJson(checkpointPath, { schema: 'nexyfab.cad-corpus-checkpoint.v2', signature, fixtureId: fixture.fixtureId, result } satisfies Checkpoint);
    results.push({ ...result, resumed: false });
  }
  const counts = { pass: 0, fail: 0, not_run: 0, error: 0 };
  for (const item of results) counts[item.status]++;
  const summary: CadCorpusBatchSummary = { schema: 'nexyfab.cad-corpus-run.v2', signature, selected: fixtures.length, counts, results };
  await atomicJson(resolve(options.outputDir, 'summary.json'), summary);
  return summary;
}
