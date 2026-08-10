/**
 * Read-only audit for AI Hub 239 architectural drawing ZIPs.
 * ZIPs are never extracted or modified. Reports contain counts and bounded
 * issue samples only; source images and annotations are never copied out.
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import unzipper from 'unzipper';

export const TRACKS = ['OBJ', 'OCR', 'SPA', 'STR'];
const ISSUE_SAMPLE_LIMIT = 200;
const ISSUE_SAMPLE_PER_CODE = 20;

export function classify239Zip(filename) {
  const match = /^([TV])([SL])_(OBJ|OCR|SPA|STR)(?:_\d+)?\.zip$/i.exec(path.basename(filename));
  if (!match) return null;
  return {
    split: match[1].toUpperCase() === 'T' ? 'training' : 'validation',
    kind: match[2].toUpperCase() === 'S' ? 'source' : 'label',
    track: match[3].toUpperCase(),
  };
}

export function canonicalDrawingKey(filename) {
  return path.basename(filename).toUpperCase().replace(/\.(PNG|JPE?G)$/i, '').replace(/_(OBJ|OCR|SPA|STR)_/, '_TRACK_');
}

function finiteNumbers(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

export function validate239LabelDocument(value, expectedTrack) {
  const issues = [];
  if (!value || typeof value !== 'object') return { issues: ['root: expected object'], imageFileNames: [] };
  const categories = Array.isArray(value.categories) ? value.categories : [];
  const images = Array.isArray(value.images) ? value.images : [];
  const annotations = Array.isArray(value.annotations) ? value.annotations : [];
  if (!categories.length) issues.push('categories: empty or missing');
  if (!images.length) issues.push('images: empty or missing');
  if (!Array.isArray(value.annotations)) issues.push('annotations: missing');

  const categoryById = new Map();
  for (const [index, category] of categories.entries()) {
    if (!Number.isSafeInteger(category?.id) || typeof category?.name !== 'string' || !category.name.trim()) issues.push(`categories[${index}]: invalid id/name`);
    else if (categoryById.has(category.id)) issues.push(`categories[${index}]: duplicate id ${category.id}`);
    else categoryById.set(category.id, category.name);
  }
  const imageById = new Map();
  const imageFileNames = [];
  for (const [index, image] of images.entries()) {
    if (!Number.isSafeInteger(image?.id) || !Number.isFinite(image?.width) || image.width <= 0 || !Number.isFinite(image?.height) || image.height <= 0 || typeof image?.file_name !== 'string' || !image.file_name.trim()) {
      issues.push(`images[${index}]: invalid id/size/file_name`);
      continue;
    }
    if (imageById.has(image.id)) issues.push(`images[${index}]: duplicate id ${image.id}`);
    imageById.set(image.id, image);
    imageFileNames.push(image.file_name);
  }

  const annotationIds = new Set();
  for (const [index, annotation] of annotations.entries()) {
    if (!Number.isSafeInteger(annotation?.id) || annotationIds.has(annotation?.id)) issues.push(`annotations[${index}]: invalid or duplicate id`);
    else annotationIds.add(annotation.id);
    const image = imageById.get(annotation?.image_id);
    const categoryName = categoryById.get(annotation?.category_id);
    if (!image) issues.push(`annotations[${index}]: unknown image_id`);
    if (!categoryName) issues.push(`annotations[${index}]: unknown category_id`);
    if (!finiteNumbers(annotation?.bbox, 4) || annotation.bbox[2] < 0 || annotation.bbox[3] < 0) {
      issues.push(`annotations[${index}]: invalid bbox`);
    } else if (image && (annotation.bbox[0] < 0 || annotation.bbox[1] < 0 || annotation.bbox[0] + annotation.bbox[2] > image.width + 1 || annotation.bbox[1] + annotation.bbox[3] > image.height + 1)) {
      issues.push(`annotations[${index}]: bbox outside image`);
    }
    if (!Array.isArray(annotation?.segmentation)) issues.push(`annotations[${index}]: segmentation missing`);
    else for (const polygon of annotation.segmentation) if (!Array.isArray(polygon) || polygon.length < 6 || polygon.length % 2 !== 0 || !polygon.every(Number.isFinite)) issues.push(`annotations[${index}]: invalid polygon`);

    if (categoryName && categoryName !== 'background') {
      const expectedPrefix = expectedTrack === 'STR' ? '구조_' : expectedTrack === 'SPA' ? '공간_' : expectedTrack === 'OBJ' ? '객체_' : 'OCR';
      const matchesTrack = expectedTrack === 'OCR' ? categoryName === 'OCR' : categoryName.startsWith(expectedPrefix);
      if (!matchesTrack) issues.push(`track: annotations[${index}] category ${categoryName} does not belong to ${expectedTrack}`);
      if (expectedTrack === 'OCR' && typeof annotation?.attributes?.OCR !== 'string') issues.push(`annotations[${index}]: OCR text missing`);
    }
  }
  return { issues, imageFileNames };
}

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(fullPath));
    else found.push(fullPath);
  }
  return found;
}

function addIssue(target, code, detail, subject = detail) {
  target.counts[code] = (target.counts[code] ?? 0) + 1;
  target.subjects[code] ??= new Set();
  target.subjects[code].add(subject);
  const codeSamples = target.samples.filter(sample => sample.code === code).length;
  if (target.samples.length < ISSUE_SAMPLE_LIMIT && codeSamples < ISSUE_SAMPLE_PER_CODE) target.samples.push({ code, detail });
}

async function zipIdentity(zipPath) {
  const info = await stat(zipPath);
  return { path: zipPath, size: info.size, mtimeMs: info.mtimeMs };
}

export async function audit239DrawingCorpus({ root, out, maxLabelsPerZip = 0, split }) {
  const allPaths = await walk(root);
  const zips = allPaths.map(zipPath => ({ zipPath, meta: classify239Zip(zipPath) })).filter(item => item.meta && (!split || item.meta.split === split));
  const before = await Promise.all(zips.map(item => zipIdentity(item.zipPath)));
  const issues = { counts: {}, samples: [], subjects: {} };
  const sourceNames = new Map();
  const labelNames = new Map();
  const splitKeys = { training: new Set(), validation: new Set() };
  const splitTrackKeys = new Map();
  const archives = [];
  let labelsScanned = 0;
  let imagesReferenced = 0;

  for (const item of zips.filter(value => value.meta.kind === 'source')) {
    const directory = await unzipper.Open.file(item.zipPath);
    const key = `${item.meta.split}:${item.meta.track}`;
    const names = sourceNames.get(key) ?? new Set();
    let fileCount = 0;
    for (const entry of directory.files) {
      if (entry.type !== 'File') continue;
      fileCount++;
      const name = path.basename(entry.path).toLowerCase();
      if (names.has(name)) addIssue(issues, 'DUPLICATE_SOURCE_NAME', `${key}:${name}`);
      names.add(name);
    }
    sourceNames.set(key, names);
    archives.push({ path: path.relative(root, item.zipPath), ...item.meta, entryCount: fileCount });
  }

  for (const item of zips.filter(value => value.meta.kind === 'label')) {
    const directory = await unzipper.Open.file(item.zipPath);
    const key = `${item.meta.split}:${item.meta.track}`;
    const seenLabels = labelNames.get(key) ?? new Set();
    const entries = directory.files.filter(entry => entry.type === 'File' && entry.path.toLowerCase().endsWith('.json'));
    const selected = maxLabelsPerZip > 0 ? entries.slice(0, maxLabelsPerZip) : entries;
    archives.push({ path: path.relative(root, item.zipPath), ...item.meta, entryCount: entries.length, scannedCount: selected.length });
    for (const entry of selected) {
      const entryName = path.basename(entry.path).toLowerCase();
      if (seenLabels.has(entryName)) addIssue(issues, 'DUPLICATE_LABEL_NAME', `${key}:${entryName}`);
      seenLabels.add(entryName);
      labelsScanned++;
      let parsed;
      try { parsed = JSON.parse((await entry.buffer()).toString('utf8')); }
      catch { addIssue(issues, 'INVALID_JSON', `${key}:${entry.path}`); continue; }
      const checked = validate239LabelDocument(parsed, item.meta.track);
      for (const schemaIssue of checked.issues) addIssue(issues, schemaIssue.startsWith('track:') ? 'TRACK_CONTAMINATION' : 'SCHEMA_ERROR', `${key}:${entry.path}:${schemaIssue}`, `${key}:${entry.path}`);
      for (const fileName of checked.imageFileNames) {
        imagesReferenced++;
        const sourceKey = `${item.meta.split}:${item.meta.track}`;
        if (!sourceNames.get(sourceKey)?.has(path.basename(fileName).toLowerCase())) addIssue(issues, 'SOURCE_PAIR_MISSING', `${sourceKey}:${fileName}`);
        const drawingKey = canonicalDrawingKey(fileName);
        splitKeys[item.meta.split].add(drawingKey);
        const trackKeySet = splitTrackKeys.get(sourceKey) ?? new Set();
        trackKeySet.add(drawingKey);
        splitTrackKeys.set(sourceKey, trackKeySet);
      }
    }
    labelNames.set(key, seenLabels);
  }

  for (const key of splitKeys.training) if (splitKeys.validation.has(key)) addIssue(issues, 'TRAIN_VALIDATION_LEAKAGE', key);

  const after = await Promise.all(zips.map(item => zipIdentity(item.zipPath)));
  for (let index = 0; index < before.length; index++) {
    if (before[index].size !== after[index].size || before[index].mtimeMs !== after[index].mtimeMs) addIssue(issues, 'SOURCE_MUTATED', before[index].path);
  }

  const expectedArchiveCount = split === 'training' ? 12 : split === 'validation' ? 8 : 20;
  if (zips.length !== expectedArchiveCount) addIssue(issues, 'ARCHIVE_SET_INCOMPLETE', `expected ${expectedArchiveCount}, found ${zips.length}`);
  const complete = maxLabelsPerZip === 0;
  const fourTrackIntersections = Object.fromEntries(['training', 'validation'].map(splitName => {
    const sets = TRACKS.map(track => splitTrackKeys.get(`${splitName}:${track}`) ?? new Set());
    const intersection = [...sets[0]].filter(key => sets.slice(1).every(set => set.has(key)));
    return [splitName, intersection.sort()];
  }));
  const fourTrackIntersectionCounts = Object.fromEntries(Object.entries(fourTrackIntersections).map(([splitName, keys]) => [splitName, keys.length]));
  const report = {
    schema: 'nexyfab.aihub239-readonly-audit.v1',
    generatedAt: new Date().toISOString(),
    root,
    mode: complete ? 'full' : 'sample',
    split: split ?? 'all',
    sourcePolicy: { readOnly: true, extracted: false, copiedPayload: false, trainingAuthorized: false, commercialEvidenceAuthorized: false },
    summary: {
      archiveCount: zips.length,
      labelsScanned,
      imagesReferenced,
      complete,
      fourTrackIntersectionCounts,
      issueCounts: issues.counts,
      affectedSubjectCounts: Object.fromEntries(Object.entries(issues.subjects).map(([code, subjects]) => [code, subjects.size])),
      issueSampleCount: issues.samples.length,
    },
    archives,
    fourTrackIntersectionSamples: Object.fromEntries(Object.entries(fourTrackIntersections).map(([splitName, keys]) => [splitName, keys.slice(0, 20)])),
    issueSamples: issues.samples,
    pass: complete && Object.keys(issues.counts).length === 0,
  };
  if (out) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return report;
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const root = argValue(args, '--root');
  if (!root) throw new Error('usage: node scripts/reference/audit-239-drawing-corpus.mjs --root <directory> [--out report.json] [--max-labels-per-zip N] [--split training|validation]');
  const maxLabelsPerZip = Number(argValue(args, '--max-labels-per-zip') ?? 0);
  const split = argValue(args, '--split');
  if (!Number.isSafeInteger(maxLabelsPerZip) || maxLabelsPerZip < 0) throw new Error('--max-labels-per-zip must be a non-negative integer');
  if (split && split !== 'training' && split !== 'validation') throw new Error('--split must be training or validation');
  const report = await audit239DrawingCorpus({ root: path.resolve(root), out: argValue(args, '--out') ? path.resolve(argValue(args, '--out')) : undefined, maxLabelsPerZip, split });
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
  if (report.mode === 'full' && !report.pass) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error); process.exitCode = 1; });
