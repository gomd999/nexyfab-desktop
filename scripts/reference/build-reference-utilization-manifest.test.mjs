import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildReferenceUtilizationManifest,
  parseSourceSpec,
  validateReferenceUtilizationManifest,
} from './build-reference-utilization-manifest.mjs';
import {
  buildReferenceUtilizationQueues,
  validateReferenceUtilizationQueues,
} from './build-reference-utilization-queues.mjs';

const tempRoots = [];

async function fixture(prefix = 'nexyfab-reference-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function file(root, relativePath, contents = 'fixture') {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

test.after(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })));
});

test('preserves the single-root v1 API and queues every assigned artifact', async () => {
  const root = await fixture();
  await file(root, 'part.step', 'step');
  await file(root, 'notes.txt', 'notes');
  await file(root, '.env', 'secret');

  const manifest = await buildReferenceUtilizationManifest(root);
  assert.equal(manifest.rootLabel, path.basename(root));
  assert.equal(manifest.sources, undefined);
  assert.deepEqual(manifest.summary, {
    discoveredFiles: 3,
    assignedFiles: 2,
    securityExcludedFiles: 1,
    discoveredBytes: 15,
    assignedBytes: 9,
    securityExcludedBytes: 6,
    hashedFiles: 2,
    hashedBytes: 9,
    lineages: 2,
    byLane: { document_reference: 1, exact_exchange_regression: 1 },
    byExtension: { step: 1, txt: 1 },
  });
  assert.equal(validateReferenceUtilizationManifest(manifest).ok, true);
  const queues = buildReferenceUtilizationQueues(manifest);
  assert.equal(queues.summary.queued, 2);
  assert.equal(validateReferenceUtilizationQueues(queues).ok, true);
});

test('aggregates roots with qualified source paths and exact security-inclusive counts', async () => {
  const exampleRoot = await fixture('nexyfab-example-');
  const manualsRoot = await fixture('nexyfab-manuals-');
  await file(exampleRoot, 'same.step', 'sample');
  await file(exampleRoot, '.env', 'secret');
  await file(manualsRoot, 'same.step', 'sample');
  await file(manualsRoot, '.env', 'secret');

  const manifest = await buildReferenceUtilizationManifest(undefined, {
    sources: [
      { id: 'example73', root: exampleRoot },
      { id: 'manuals', root: manualsRoot },
    ],
  });
  assert.equal(manifest.rootLabel, 'aggregate');
  assert.deepEqual(manifest.summary, {
    discoveredFiles: 4,
    assignedFiles: 2,
    securityExcludedFiles: 2,
    discoveredBytes: 24,
    assignedBytes: 12,
    securityExcludedBytes: 12,
    hashedFiles: 2,
    hashedBytes: 12,
    lineages: 2,
    byLane: { exact_exchange_regression: 2 },
    byExtension: { step: 2 },
  });
  assert.deepEqual(manifest.sources, [
    { sourceId: 'example73', discoveredFiles: 2, assignedFiles: 1, securityExcludedFiles: 1, discoveredBytes: 12, assignedBytes: 6, securityExcludedBytes: 6, hashedFiles: 1, hashedBytes: 6 },
    { sourceId: 'manuals', discoveredFiles: 2, assignedFiles: 1, securityExcludedFiles: 1, discoveredBytes: 12, assignedBytes: 6, securityExcludedBytes: 6, hashedFiles: 1, hashedBytes: 6 },
  ]);
  assert.deepEqual(manifest.artifacts.map(item => [item.relativePath, item.sourceId, item.sourceRelativePath]), [
    ['example73/same.step', 'example73', 'same.step'],
    ['manuals/same.step', 'manuals', 'same.step'],
  ]);
  assert.equal(validateReferenceUtilizationManifest(manifest).ok, true);
  const queues = buildReferenceUtilizationQueues(manifest);
  assert.equal(queues.summary.queued, 2);
  assert.deepEqual(queues.automated.map(item => item.sourceId), ['example73', 'manuals']);
  assert.equal(validateReferenceUtilizationQueues(queues).ok, true);
});

test('rejects unsafe IDs, duplicate IDs, and overlapping roots', async () => {
  const root = await fixture();
  const child = path.join(root, 'child');
  await mkdir(child);
  await assert.rejects(
    () => buildReferenceUtilizationManifest(undefined, { sources: [{ id: 'A', root }, { id: 'a', root: child }] }),
    /SOURCE_ID_DUPLICATE/,
  );
  await assert.rejects(
    () => buildReferenceUtilizationManifest(undefined, { sources: [{ id: 'parent', root }, { id: 'child', root: child }] }),
    /SOURCE_ROOT_OVERLAP/,
  );
  await assert.rejects(
    () => buildReferenceUtilizationManifest(undefined, { sources: [{ id: '../escape', root: child }] }),
    /SOURCE_ID_INVALID/,
  );
  assert.deepEqual(parseSourceSpec(`docs=${root}`), { id: 'docs', root });
  assert.throws(() => parseSourceSpec(`../docs=${root}`), /SOURCE_ID_INVALID/);
  assert.throws(() => parseSourceSpec('docs=relative/path'), /SOURCE_PATH_NOT_ABSOLUTE/);
});

test('rejects symlink escapes when the host permits symlink fixtures', async t => {
  const root = await fixture();
  const outside = await fixture('nexyfab-outside-');
  await file(outside, 'outside.step', 'outside');
  try {
    await symlink(outside, path.join(root, 'linked-directory'), 'junction');
  } catch (error) {
    t.skip(`symlink fixture unavailable: ${error.code ?? error.message}`);
    return;
  }
  await assert.rejects(() => buildReferenceUtilizationManifest(root), /SYMLINK_NOT_ALLOWED|PATH_ESCAPE/);
});

test('rejects manifest and queue tampering instead of silently dropping artifacts', async () => {
  const root = await fixture();
  await file(root, 'part.step', 'step');
  await file(root, 'notes.txt', 'notes');
  const manifest = await buildReferenceUtilizationManifest(root);

  const pathTampered = structuredClone(manifest);
  pathTampered.artifacts[0].relativePath = '../wrong.step';
  assert.equal(validateReferenceUtilizationManifest(pathTampered).ok, false);

  const countTampered = structuredClone(manifest);
  countTampered.summary.discoveredFiles++;
  assert.equal(validateReferenceUtilizationManifest(countTampered).ok, false);

  const lineageTampered = structuredClone(manifest);
  lineageTampered.lineages[0].bytes++;
  assert.equal(validateReferenceUtilizationManifest(lineageTampered).ok, false);

  const extensionTampered = structuredClone(manifest);
  extensionTampered.summary.byExtension.txt++;
  assert.equal(validateReferenceUtilizationManifest(extensionTampered).ok, false);

  const laneTampered = structuredClone(manifest);
  laneTampered.artifacts[0].lane = 'unindexed_future_lane';
  laneTampered.summary.byLane.unindexed_future_lane = 1;
  delete laneTampered.summary.byLane.document_reference;
  assert.throws(() => buildReferenceUtilizationQueues(laneTampered), /manifest_invalid|queue_coverage_mismatch/);

  const queues = buildReferenceUtilizationQueues(manifest);
  const queueTampered = structuredClone(queues);
  queueTampered.automated[0].relativePath = 'different.step';
  assert.equal(validateReferenceUtilizationQueues(queueTampered).ok, false);

  const queueSummaryTampered = structuredClone(queues);
  queueSummaryTampered.summary.automated++;
  assert.equal(validateReferenceUtilizationQueues(queueSummaryTampered).ok, false);
});
