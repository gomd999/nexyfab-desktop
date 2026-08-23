#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReferenceArtifact, extensionOf, isSecretLikePath, referenceLineage } from './reference-utilization-policy.mjs';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const options = name => process.argv.filter(arg => arg.startsWith(`--${name}=`)).map(arg => arg.slice(name.length + 3));
const rootInput = option('root') ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
const sourceInputs = options('source');
const outputInput = option('output');
const validateInput = option('validate');
const hashPolicy = option('hash') ?? 'all';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const SOURCE_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function normalizedKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function parseSourceSpec(value) {
  if (typeof value !== 'string') fail('SOURCE_ARGUMENT_INVALID', String(value));
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) fail('SOURCE_ARGUMENT_INVALID', value);
  const id = value.slice(0, separator);
  const root = value.slice(separator + 1);
  if (!SOURCE_ID.test(id)) fail('SOURCE_ID_INVALID', id);
  if (!path.isAbsolute(root)) fail('SOURCE_PATH_NOT_ABSOLUTE', id);
  return { id, root: path.resolve(root) };
}

async function normalizeSources({ root, sources } = {}) {
  if (Array.isArray(sources) && root !== undefined) fail('ROOT_AND_SOURCES_MUTUALLY_EXCLUSIVE');
  if (root === undefined && (!Array.isArray(sources) || sources.length === 0)) fail('SOURCE_REQUIRED');
  const explicitSources = Array.isArray(sources) && sources.length > 0;
  const input = explicitSources
    ? sources.map(source => ({ id: source?.id ?? source?.sourceId, root: source?.root }))
    : [{ id: undefined, root }];
  const normalized = [], ids = new Set();
  for (const source of input) {
    if (typeof source.root !== 'string' || (explicitSources && !path.isAbsolute(source.root))) fail('SOURCE_PATH_NOT_ABSOLUTE', source.id ?? 'root');
    const id = source.id ?? path.basename(path.resolve(source.root));
    if (!SOURCE_ID.test(id)) fail('SOURCE_ID_INVALID', id);
    const idKey = id.toLowerCase();
    if (ids.has(idKey)) fail('SOURCE_ID_DUPLICATE', id);
    ids.add(idKey);
    const configuredRoot = path.resolve(source.root);
    let rootStats;
    try { rootStats = await lstat(configuredRoot); } catch { fail('reference_corpus_root_missing', id); }
    if (rootStats.isSymbolicLink()) fail('SOURCE_SYMLINK_NOT_ALLOWED', id);
    if (!rootStats.isDirectory()) fail('SOURCE_NOT_DIRECTORY', id);
    let realRoot;
    try { realRoot = await realpath(configuredRoot); } catch { fail('SOURCE_UNREADABLE', id); }
    const realKey = normalizedKey(realRoot);
    for (const previous of normalized) {
      if (realKey === normalizedKey(previous.realRoot)
        || isWithin(previous.realRoot, realRoot)
        || isWithin(realRoot, previous.realRoot)) fail('SOURCE_ROOT_OVERLAP', `${previous.id}:${id}`);
    }
    normalized.push({ id, configuredRoot, realRoot });
  }
  if (normalized.length === 0) fail('SOURCE_REQUIRED');
  return normalized;
}

async function assertContained(root, candidate, relativePath) {
  let targetStats;
  try { targetStats = await lstat(candidate); } catch { fail('FILE_UNREADABLE', relativePath); }
  if (targetStats.isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED', relativePath);
  let targetReal;
  try { targetReal = await realpath(candidate); } catch { fail('FILE_UNREADABLE', relativePath); }
  if (!isWithin(root, targetReal)) fail('PATH_ESCAPE', relativePath);
  return targetStats;
}

async function measureExcluded(directory, root) {
  let files = 0, bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/');
    const stats = await assertContained(root, absolutePath, relativePath);
    if (stats.isDirectory()) { const nested = await measureExcluded(absolutePath, root); files += nested.files; bytes += nested.bytes; }
    else if (stats.isFile()) { files++; bytes += stats.size; }
    else fail('FILE_TYPE_UNSUPPORTED', relativePath);
  }
  return { files, bytes };
}

async function walk(root, realRoot, directory = root, files = [], securityExcluded = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/');
    const stats = await assertContained(realRoot, absolutePath, relativePath);
    if (isSecretLikePath(relativePath)) {
      const measured = stats.isDirectory() ? await measureExcluded(absolutePath, realRoot, relativePath) : { files: 1, bytes: stats.size };
      securityExcluded.push({ pathHash: createHash('sha256').update(relativePath).digest('hex'), ...measured });
      continue;
    }
    if (stats.isDirectory()) await walk(root, realRoot, absolutePath, files, securityExcluded);
    else if (stats.isFile()) files.push({ absolutePath, relativePath });
    else fail('FILE_TYPE_UNSUPPORTED', relativePath);
  }
  return { files, securityExcluded };
}

const increment = (record, key, amount = 1) => { record[key] = (record[key] ?? 0) + amount; };

export async function buildReferenceUtilizationManifest(root, { hash = 'all', sources } = {}) {
  if (!['all', 'cad', 'none'].includes(hash)) throw new Error('invalid_hash_policy');
  const normalizedSources = await normalizeSources({ root, sources });
  const aggregate = normalizedSources.length > 1 || (Array.isArray(sources) && sources.length > 0);
  const discovered = [];
  for (const source of normalizedSources) {
    const sourceDiscovered = await walk(source.configuredRoot, source.realRoot);
    discovered.push({ source, ...sourceDiscovered });
  }
  for (const item of discovered) item.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const artifacts = [], byLane = {}, byExtension = {}, byLineage = new Map();
  let totalBytes = 0, hashedFiles = 0, hashedBytes = 0;
  let processed = 0;
  const sourceSummaries = [];
  for (const entry of discovered) {
    let sourceTotalBytes = 0, sourceAssignedFiles = 0, sourceAssignedBytes = 0, sourceHashedFiles = 0, sourceHashedBytes = 0;
    for (const file of entry.files) {
    const info = await stat(file.absolutePath);
    const classification = classifyReferenceArtifact(file.relativePath);
    const extension = extensionOf(file.relativePath) || '(none)';
    const localLineageId = referenceLineage(file.relativePath);
    const lineageId = aggregate ? `${entry.source.id}:${localLineageId}` : localLineageId;
    const shouldHash = hash === 'all' || (hash === 'cad' && [
      'exact_exchange_regression', 'governed_automated_regression', 'bounded_geometry_regression',
      'native_semantics_review_queue', 'derived_ir_reuse',
    ].includes(classification.lane));
    const digest = shouldHash ? await sha256(file.absolutePath) : null;
    if (digest) { hashedFiles++; hashedBytes += info.size; }
    if (digest) { sourceHashedFiles++; sourceHashedBytes += info.size; }
    totalBytes += info.size;
    sourceTotalBytes += info.size;
    sourceAssignedFiles++;
    sourceAssignedBytes += info.size;
    increment(byLane, classification.lane);
    increment(byExtension, extension);
    const lineage = byLineage.get(lineageId) ?? { lineageId, files: 0, bytes: 0, lanes: new Set(), formats: new Set() };
    lineage.files++; lineage.bytes += info.size; lineage.lanes.add(classification.lane); lineage.formats.add(extension); byLineage.set(lineageId, lineage);
    const qualifiedPath = aggregate ? `${entry.source.id}/${file.relativePath}` : file.relativePath;
    artifacts.push({
      ...(aggregate ? { sourceId: entry.source.id, sourceRelativePath: file.relativePath } : {}),
      relativePath: qualifiedPath,
      lineageId,
      extension,
      sizeBytes: info.size,
      sha256: digest,
      ...classification,
    });
    processed++;
    if (processed % 250 === 0) process.stderr.write(`[reference-utilization] ${processed}/${discovered.reduce((sum, item) => sum + item.files.length, 0)}\n`);
    }
    const excluded = entry.securityExcluded.reduce((sum, item) => sum + item.files, 0);
    const excludedBytes = entry.securityExcluded.reduce((sum, item) => sum + item.bytes, 0);
    sourceSummaries.push({ sourceId: entry.source.id, discoveredFiles: sourceAssignedFiles + excluded, assignedFiles: sourceAssignedFiles, securityExcludedFiles: excluded, discoveredBytes: sourceTotalBytes + excludedBytes, assignedBytes: sourceAssignedBytes, securityExcludedBytes: excludedBytes, hashedFiles: sourceHashedFiles, hashedBytes: sourceHashedBytes });
  }
  const lineages = [...byLineage.values()].map(item => ({ ...item, lanes: [...item.lanes].sort(), formats: [...item.formats].sort() }))
    .sort((a, b) => a.lineageId.localeCompare(b.lineageId));
  const assignedFiles = Object.values(byLane).reduce((sum, value) => sum + value, 0);
  const securityExcluded = discovered.flatMap(entry => entry.securityExcluded.map(item => aggregate ? { sourceId: entry.source.id, ...item } : item));
  const securityExcludedFiles = securityExcluded.reduce((sum, item) => sum + item.files, 0);
  const securityExcludedBytes = securityExcluded.reduce((sum, item) => sum + item.bytes, 0);
  const sourcesMetadata = aggregate ? sourceSummaries : undefined;
  return {
    schema: 'nexyfab.reference-utilization-manifest.v1',
    generatedAt: new Date().toISOString(),
    ...(aggregate ? { rootLabel: 'aggregate', sources: sourcesMetadata } : { rootLabel: path.basename(normalizedSources[0].configuredRoot) }),
    policy: {
      sourceReadOnly: true,
      sourceBytesCopied: false,
      sourceArchivesExtractedInPlace: false,
      everyNonSecretFileAssigned: assignedFiles === artifacts.length,
      localEvaluationOnlyUntilLicenseReview: true,
      trainingUseAllowed: false,
      commercialScoreRequiresApproval: true,
      derivedResultsAreNotIndependentGroundTruth: true,
      nativeSemanticsMustNotBeGuessed: true,
      endUserExternalCadRequired: false,
      hashPolicy: hash,
    },
    summary: {
      discoveredFiles: artifacts.length + securityExcludedFiles,
      assignedFiles,
      securityExcludedFiles,
      discoveredBytes: totalBytes + securityExcludedBytes,
      assignedBytes: totalBytes,
      securityExcludedBytes,
      hashedFiles,
      hashedBytes,
      lineages: lineages.length,
      byLane: Object.fromEntries(Object.entries(byLane).sort(([a], [b]) => a.localeCompare(b))),
      byExtension: Object.fromEntries(Object.entries(byExtension).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    },
    securityExcluded,
    lineages,
    artifacts,
  };
}

export function validateReferenceUtilizationManifest(value) {
  const errors = [];
  if (value?.schema !== 'nexyfab.reference-utilization-manifest.v1') errors.push('schema_invalid');
  if (value?.policy?.sourceReadOnly !== true || value?.policy?.sourceBytesCopied !== false) errors.push('read_only_policy_invalid');
  if (value?.policy?.trainingUseAllowed !== false || value?.policy?.commercialScoreRequiresApproval !== true) errors.push('license_boundary_invalid');
  const aggregate = Array.isArray(value?.sources) || value?.rootLabel === 'aggregate';
  const sourceIds = new Set();
  if (aggregate) {
    if (!Array.isArray(value?.sources) || value.sources.length === 0) errors.push('sources_missing');
    for (const source of Array.isArray(value?.sources) ? value.sources : []) {
      const sourceId = String(source?.sourceId ?? '');
      const key = sourceId.toLowerCase();
      if (!SOURCE_ID.test(sourceId) || sourceIds.has(key)) errors.push(`source_invalid:${sourceId || 'unknown'}`);
      sourceIds.add(key);
      for (const field of ['discoveredFiles', 'assignedFiles', 'securityExcludedFiles', 'discoveredBytes', 'assignedBytes', 'securityExcludedBytes', 'hashedFiles', 'hashedBytes']) {
        if (!Number.isSafeInteger(source?.[field]) || source[field] < 0) errors.push(`source_summary_invalid:${sourceId || 'unknown'}:${field}`);
      }
    }
  }
  const artifacts = Array.isArray(value?.artifacts) ? value.artifacts : [];
  const paths = new Set(), lanes = {}, extensions = {}, lineageTotals = new Map();
  const sourceTotals = new Map([...sourceIds].map(sourceId => [sourceId, {
    assignedFiles: 0, assignedBytes: 0, securityExcludedFiles: 0, securityExcludedBytes: 0, hashedFiles: 0, hashedBytes: 0,
  }]));
  let assignedBytes = 0, hashedFiles = 0, hashedBytes = 0;
  for (const item of artifacts) {
    if (!item?.relativePath || paths.has(item.relativePath)) errors.push('artifact_path_missing_or_duplicate');
    paths.add(item?.relativePath);
    const relativeSegments = String(item?.relativePath ?? '').replaceAll('\\', '/').split('/');
    if (!item?.relativePath || path.isAbsolute(item.relativePath) || relativeSegments.some(segment => !segment || segment === '..' || segment === '.')) errors.push(`artifact_path_invalid:${item?.relativePath ?? 'unknown'}`);
    if (aggregate) {
      const sourceId = String(item?.sourceId ?? '');
      const sourceRelativePath = String(item?.sourceRelativePath ?? '');
      const segments = sourceRelativePath.replaceAll('\\', '/').split('/');
      if (!SOURCE_ID.test(sourceId) || !sourceIds.has(sourceId.toLowerCase()) || !sourceRelativePath || path.isAbsolute(sourceRelativePath) || segments.some(segment => !segment || segment === '..' || segment === '.')) errors.push(`artifact_source_binding_invalid:${item?.relativePath ?? 'unknown'}`);
      if (item?.relativePath !== `${sourceId}/${sourceRelativePath}`) errors.push(`artifact_qualified_path_invalid:${item?.relativePath ?? 'unknown'}`);
    } else if (item?.sourceId !== undefined || item?.sourceRelativePath !== undefined) errors.push(`single_root_source_binding_unexpected:${item?.relativePath ?? 'unknown'}`);
    if (!item?.lane || !Array.isArray(item?.roles) || item.roles.length === 0) errors.push(`artifact_unassigned:${item?.relativePath ?? 'unknown'}`);
    increment(lanes, item?.lane ?? '');
    increment(extensions, item?.extension ?? '');
    if (item?.commercialScoreEligible !== false || item?.trainingEligible !== false) errors.push(`artifact_boundary_invalid:${item?.relativePath ?? 'unknown'}`);
    if (!Number.isSafeInteger(item?.sizeBytes) || item.sizeBytes < 0) errors.push(`artifact_size_invalid:${item?.relativePath ?? 'unknown'}`);
    if (item?.sha256 !== null && !SHA256.test(String(item?.sha256 ?? ''))) errors.push(`artifact_hash_invalid:${item?.relativePath ?? 'unknown'}`);
    if (Number.isSafeInteger(item?.sizeBytes) && item.sizeBytes >= 0) {
      assignedBytes += item.sizeBytes;
      if (item.sha256) { hashedFiles++; hashedBytes += item.sizeBytes; }
      if (aggregate) {
        const totals = sourceTotals.get(String(item.sourceId).toLowerCase());
        if (totals) {
          totals.assignedFiles++;
          totals.assignedBytes += item.sizeBytes;
          if (item.sha256) { totals.hashedFiles++; totals.hashedBytes += item.sizeBytes; }
        }
      }
    }
    const lineageId = String(item?.lineageId ?? '');
    if (!lineageId) errors.push(`artifact_lineage_missing:${item?.relativePath ?? 'unknown'}`);
    const lineage = lineageTotals.get(lineageId) ?? { files: 0, bytes: 0, lanes: new Set(), formats: new Set() };
    lineage.files++;
    if (Number.isSafeInteger(item?.sizeBytes) && item.sizeBytes >= 0) lineage.bytes += item.sizeBytes;
    lineage.lanes.add(item?.lane);
    lineage.formats.add(item?.extension);
    lineageTotals.set(lineageId, lineage);
  }
  const securityExcluded = Array.isArray(value?.securityExcluded) ? value.securityExcluded : [];
  let securityExcludedFiles = 0, securityExcludedBytes = 0;
  for (const item of securityExcluded) {
    if (!SHA256.test(String(item?.pathHash ?? '')) || !Number.isSafeInteger(item?.files) || item.files < 0
      || !Number.isSafeInteger(item?.bytes) || item.bytes < 0) errors.push('security_exclusion_invalid');
    if (Number.isSafeInteger(item?.files) && item.files >= 0) securityExcludedFiles += item.files;
    if (Number.isSafeInteger(item?.bytes) && item.bytes >= 0) securityExcludedBytes += item.bytes;
  }
  if (aggregate) {
    for (const item of securityExcluded) {
      if (!sourceIds.has(String(item?.sourceId ?? '').toLowerCase()) || !SHA256.test(String(item?.pathHash ?? '')) || !Number.isSafeInteger(item?.files) || item.files < 0 || !Number.isSafeInteger(item?.bytes) || item.bytes < 0) errors.push('security_exclusion_invalid');
      const totals = sourceTotals.get(String(item?.sourceId ?? '').toLowerCase());
      if (totals && Number.isSafeInteger(item?.files) && item.files >= 0 && Number.isSafeInteger(item?.bytes) && item.bytes >= 0) {
        totals.securityExcludedFiles += item.files;
        totals.securityExcludedBytes += item.bytes;
      }
    }
    for (const source of Array.isArray(value?.sources) ? value.sources : []) {
      const totals = sourceTotals.get(String(source.sourceId).toLowerCase());
      for (const field of ['assignedFiles', 'assignedBytes', 'securityExcludedFiles', 'securityExcludedBytes', 'hashedFiles', 'hashedBytes']) {
        if (totals?.[field] !== source[field]) errors.push(`source_summary_mismatch:${source.sourceId}:${field}`);
      }
      if (totals && (totals.assignedFiles + totals.securityExcludedFiles !== source.discoveredFiles
        || totals.assignedBytes + totals.securityExcludedBytes !== source.discoveredBytes)) errors.push(`source_summary_mismatch:${source.sourceId}:discovered`);
    }
  }
  const assigned = Object.values(lanes).reduce((sum, count) => sum + count, 0);
  if (assigned !== value?.summary?.assignedFiles || assigned !== artifacts.length) errors.push('assigned_count_mismatch');
  if (securityExcludedFiles !== value?.summary?.securityExcludedFiles
    || assigned + securityExcludedFiles !== value?.summary?.discoveredFiles) errors.push('discovery_count_mismatch');
  if (value?.summary?.assignedBytes !== undefined
    && (assignedBytes !== value.summary.assignedBytes || securityExcludedBytes !== value.summary.securityExcludedBytes
      || assignedBytes + securityExcludedBytes !== value.summary.discoveredBytes)) errors.push('byte_summary_mismatch');
  if (value?.summary?.hashedFiles !== undefined
    && (hashedFiles !== value.summary.hashedFiles || hashedBytes !== value.summary.hashedBytes)) errors.push('hash_summary_mismatch');
  if (JSON.stringify(lanes) !== JSON.stringify(value?.summary?.byLane ?? {})) {
    const sorted = Object.fromEntries(Object.entries(lanes).sort(([a], [b]) => a.localeCompare(b)));
    if (JSON.stringify(sorted) !== JSON.stringify(value?.summary?.byLane ?? {})) errors.push('lane_summary_mismatch');
  }
  const sortedExtensions = Object.fromEntries(Object.entries(extensions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  if (JSON.stringify(sortedExtensions) !== JSON.stringify(value?.summary?.byExtension ?? {})) errors.push('extension_summary_mismatch');
  const lineages = Array.isArray(value?.lineages) ? value.lineages : [];
  const lineageIds = new Set();
  for (const item of lineages) {
    const lineageId = String(item?.lineageId ?? '');
    if (!lineageId || lineageIds.has(lineageId)) errors.push('lineage_missing_or_duplicate');
    lineageIds.add(lineageId);
    const actual = lineageTotals.get(lineageId);
    if (!actual || item?.files !== actual.files || item?.bytes !== actual.bytes
      || JSON.stringify(item?.lanes) !== JSON.stringify([...actual.lanes].sort())
      || JSON.stringify(item?.formats) !== JSON.stringify([...actual.formats].sort())) errors.push(`lineage_summary_mismatch:${lineageId || 'unknown'}`);
  }
  if (lineages.length !== lineageTotals.size || lineages.length !== value?.summary?.lineages
    || [...lineageTotals.keys()].some(lineageId => !lineageIds.has(lineageId))) errors.push('lineage_count_mismatch');
  return { ok: errors.length === 0, errors, artifacts: artifacts.length, lineages: Array.isArray(value?.lineages) ? value.lineages.length : 0 };
}

async function main() {
  if (validateInput) {
    const value = JSON.parse(await readFile(path.resolve(validateInput), 'utf8'));
    const result = validateReferenceUtilizationManifest(value);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 5;
    return;
  }
  if ((!rootInput && sourceInputs.length === 0) || !outputInput) throw new Error('usage: --root=PATH | --source=ID=PATH [--source=ID=PATH ...] --output=PATH [--hash=all|cad|none]');
  if (rootInput && sourceInputs.length > 0) throw new Error('ROOT_AND_SOURCES_MUTUALLY_EXCLUSIVE');
  const manifest = sourceInputs.length > 0
    ? await buildReferenceUtilizationManifest(undefined, { hash: hashPolicy, sources: sourceInputs.map(parseSourceSpec) })
    : await buildReferenceUtilizationManifest(rootInput, { hash: hashPolicy });
  const validation = validateReferenceUtilizationManifest(manifest);
  if (!validation.ok) throw new Error(`manifest_invalid:${validation.errors.join(',')}`);
  const output = path.resolve(outputInput);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, ...manifest.summary, validation })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
