import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OcctBridge, OcctDetailedShapeInspection } from '@/lib/occt/bridge';
import type { OcctShape } from '@/lib/occt/types';
import type { CadCorpusFixtureV2, CadCorpusManifestV2 } from './cadCorpusManifestV2';
import { runCadCorpusBatchV2 } from './cadCorpusBatchRunnerV2';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const digest = (data: string) => createHash('sha256').update(data).digest('hex');
const details: OcctDetailedShapeInspection = {
  valid: true, solidCount: 1, faceCount: 6, edgeCount: 12,
  shapeTypeCounts: { compound: 0, compsolid: 0, solid: 1, shell: 1 },
  productOccurrences: { status: 'available', count: 1 },
  bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, absoluteVolume: 1, surfaceArea: 6,
  centroid: { x: .5, y: .5, z: .5 }, inertia: { status: 'available', units: 'mm^5', about: 'centroid', matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  surfaceTypes: { status: 'available', counts: { plane: 6 } }, curveTypes: { status: 'available', counts: { line: 12 } },
  faceAdjacency: { status: 'available', faceCount: 6, uniqueEdgeCount: 12, boundaryEdgeCount: 0, manifoldEdgeCount: 12, nonManifoldEdgeCount: 0, faceDegreeHistogram: { '4': 6 } },
};

function fixture(fixtureId: 'A01' | 'B01', name: string, source: string): CadCorpusFixtureV2 {
  return { fixtureId, locator: { kind: 'path-fragments', fragments: ['product', name] }, sha256: digest(source), format: 'step', grade: fixtureId[0] as 'A' | 'B', tier: fixtureId[0] === 'A' ? 'core-a' : 'challenge-b', split: 'evaluation', assertions: ['geometry_baseline'], usage: { storage: 'local-only', redistribution: 'forbidden-until-proven', promptExample: false }, holdoutGroup: `holdout-${fixtureId}`, bytes: Buffer.byteLength(source), byteBudget: 1024 };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'cad-corpus-')); roots.push(root);
  const corpusRoot = join(root, 'corpus'), outputDir = join(root, 'run');
  await mkdir(join(corpusRoot, 'product'), { recursive: true });
  const good = 'ISO-10303-21;GOOD;END-ISO-10303-21;', bad = 'ISO-10303-21;BAD;END-ISO-10303-21;';
  await writeFile(join(corpusRoot, 'product', 'good.step'), good); await writeFile(join(corpusRoot, 'product', 'bad.step'), bad);
  const manifest: CadCorpusManifestV2 = { schema: 'nexyfab.cad-corpus-manifest.v2', lifecycle: 'frozen', byteBudget: { maxFixtureBytes: 1024, maxRunBytes: 2048 }, fixtures: [fixture('A01', 'good.step', good), fixture('B01', 'bad.step', bad)] };
  const importSTEP = vi.fn(async (source: string) => {
    if (source.includes('BAD')) throw new Error(`private source must not leak: ${source}`);
    return { ok: true, shape: { id: 's', kind: 'solid' } as OcctShape, warnings: [] };
  });
  const bridge = { importSTEP, inspectShapeDetailed: vi.fn(async () => details), release: vi.fn() } as unknown as OcctBridge;
  return { root, corpusRoot, outputDir, manifest, bridge, importSTEP, good, bad };
}

describe('runCadCorpusBatchV2', () => {
  it('isolates fixture failure, writes sanitized atomic outputs, and never persists source/path', async () => {
    const env = await setup();
    const result = await runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: env.outputDir, manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'mm' } });
    expect(result.counts).toEqual({ pass: 1, fail: 0, not_run: 0, error: 1 });
    expect(result.results.map(item => item.fixtureId)).toEqual(['A01', 'B01']);
    const persisted = await Promise.all(['manifest.snapshot.json', 'summary.json', 'checkpoints/A01.json', 'checkpoints/B01.json', 'evidence/A01.json'].map(file => readFile(join(env.outputDir, file), 'utf8')));
    const combined = persisted.join('\n');
    expect(combined).not.toContain(env.corpusRoot);
    expect(combined).not.toContain(env.good);
    expect(combined).not.toContain(env.bad);
    expect(JSON.parse(persisted[3]!).result.error).toEqual({ code: 'FIXTURE_ANALYSIS_ERROR', message: 'Fixture processing failed.' });
  });

  it('resumes valid completed checkpoints without re-reading or re-analyzing fixtures', async () => {
    const env = await setup();
    await runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: env.outputDir, manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'mm' } });
    env.importSTEP.mockClear();
    const resumed = await runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: env.outputDir, manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'mm' }, resume: true });
    expect(env.importSTEP).not.toHaveBeenCalled();
    expect(resumed.results.every(item => item.resumed)).toBe(true);
    expect(resumed.counts).toEqual({ pass: 1, fail: 0, not_run: 0, error: 1 });
  });

  it('rejects a checkpoint from a different run signature', async () => {
    const env = await setup();
    await runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: env.outputDir, manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'mm' } });
    const snapshotBefore = await readFile(join(env.outputDir, 'manifest.snapshot.json'), 'utf8');
    await expect(runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: env.outputDir, manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'scale-to-mm', scaleToMm: 10 }, resume: true })).rejects.toMatchObject({ code: 'CHECKPOINT_SIGNATURE_MISMATCH' });
    expect(await readFile(join(env.outputDir, 'manifest.snapshot.json'), 'utf8')).toBe(snapshotBefore);
  });

  it('isolates source drift and preserves its machine-readable code in summary', async () => {
    const env = await setup();
    await writeFile(join(env.corpusRoot, 'product', 'good.step'), 'changed after freeze');
    const result = await runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: env.outputDir, manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'mm' }, tier: 'core-a' });
    expect(result.counts).toEqual({ pass: 0, fail: 0, not_run: 0, error: 1 });
    expect(result.results[0]).toMatchObject({ fixtureId: 'A01', status: 'error', error: { code: 'SOURCE_CHANGED' } });
  });

  it('supports deterministic tier and one-based shard selection', async () => {
    const env = await setup();
    const tier = await runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: join(env.root, 'tier'), manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'mm' }, tier: 'core-a' });
    expect(tier.results.map(item => item.fixtureId)).toEqual(['A01']);
    const shard = await runCadCorpusBatchV2({ corpusRoot: env.corpusRoot, outputDir: join(env.root, 'shard'), manifest: env.manifest, bridge: env.bridge, lengthUnit: { kind: 'mm' }, shard: { index: 2, count: 2 } });
    expect(shard.results.map(item => item.fixtureId)).toEqual(['B01']);
  });
});
